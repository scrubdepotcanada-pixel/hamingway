import { v4 as uuid } from 'uuid';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import {
  projects,
  contentIdeas,
  contentDrafts,
  approvalEmails,
} from '../db/schema';
import { getState, setStep, APPROVAL_TIMEOUT_HOURS, ROTATION_INTERVAL_DAYS } from './state';
import { pickNextProject } from './rotation';
import { generateIdeas } from '../ai/ideas';
import { generateContent, reviseContent, type GeneratedContent } from '../ai/content';
import { reviewContent } from '../ai/review';
import { sendApprovalEmail, getThread, extractPlainText, parseOptionFromReply } from '../gmail';
import { publishDraft, type Platform } from '../publish';
import { logActivity } from '../log';

const CEO_EMAIL = () => process.env.CEO_EMAIL || 'oreekoblentz@gmail.com';

/**
 * STEP 1a: Start a cycle (DB-only, fast).
 *   - Rotation gate (skippable with force=true)
 *   - Picks the next project
 *   - Sets state to GENERATING with new cycle_id / project_id
 *   - NO LLM calls, NO emails — returns in < 1s
 * A subsequent `advance` call will generate ideas, then another will send the
 * approval email. This keeps every function invocation comfortably under the
 * Vercel Hobby timeout.
 */
export async function stepStartCycle(opts: { force?: boolean } = {}) {
  const state = await getState();
  const startable =
    state.currentStep === 'IDLE' ||
    state.currentStep === 'COMPLETE' ||
    state.currentStep === 'EXPIRED' ||
    state.currentStep === 'FAILED';

  if (!startable) {
    return { ok: false, reason: `state is ${state.currentStep}, cannot start` };
  }

  if (!opts.force && state.lastRunAt) {
    const last = new Date(state.lastRunAt).getTime();
    const now = Date.now();
    const days = (now - last) / (1000 * 60 * 60 * 24);
    if (days < ROTATION_INTERVAL_DAYS) {
      return { ok: false, reason: `only ${days.toFixed(1)} days since last run` };
    }
  }

  const project = await pickNextProject(state.lastProjectId ?? null);
  if (!project) return { ok: false, reason: 'no active projects' };

  const cycleId = uuid();
  await setStep('GENERATING', {
    currentCycleId: cycleId,
    currentProjectId: project.id,
    lastRunAt: new Date().toISOString(),
  });
  await logActivity({
    action: 'cycle_started',
    cycleId,
    projectId: project.id,
    details: { project: project.name, forced: !!opts.force },
  });

  return { ok: true, cycleId, projectId: project.id, projectName: project.name, step: 'GENERATING' };
}

/**
 * STEP 1b: Generate ideas via Claude. Transitions GENERATING -> IDEAS_READY.
 * Idempotent: if ideas already exist for the cycle, skips the LLM call.
 */
export async function stepGenerateIdeas() {
  const state = await getState();
  if (state.currentStep !== 'GENERATING') {
    return { ok: false, reason: `state is ${state.currentStep}` };
  }
  const cycleId = state.currentCycleId;
  const projectId = state.currentProjectId;
  if (!cycleId || !projectId) return { ok: false, reason: 'missing cycle or project id' };

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return { ok: false, reason: 'project not found' };

  // Idempotency: if we already have ideas for this cycle, just advance.
  const existing = await db.select().from(contentIdeas).where(eq(contentIdeas.cycleId, cycleId));
  if (existing.length >= 3) {
    await setStep('IDEAS_READY');
    return { ok: true, skipped: true, count: existing.length };
  }

  const ideas = await generateIdeas(project);
  for (let i = 0; i < 3; i++) {
    const idea = ideas[i];
    await db.insert(contentIdeas).values({
      id: uuid(),
      projectId: project.id,
      cycleId,
      optionNumber: i + 1,
      title: idea.title,
      targetKeyword: idea.target_keyword,
      pitch: idea.pitch,
      searchVolumeRationale: idea.search_volume_rationale,
    });
  }
  await setStep('IDEAS_READY');
  await logActivity({ action: 'ideas_generated', cycleId, projectId, details: { count: 3 } });

  return { ok: true, count: 3, step: 'IDEAS_READY' };
}

/**
 * STEP 1c: Send the approval email. Transitions IDEAS_READY -> PENDING_APPROVAL.
 * Idempotent: if an approval_emails row already exists for the cycle, skips the send.
 */
export async function stepSendApprovalEmail() {
  const state = await getState();
  if (state.currentStep !== 'IDEAS_READY') {
    return { ok: false, reason: `state is ${state.currentStep}` };
  }
  const cycleId = state.currentCycleId;
  const projectId = state.currentProjectId;
  if (!cycleId || !projectId) return { ok: false, reason: 'missing cycle or project id' };

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return { ok: false, reason: 'project not found' };

  const existingApproval = await db
    .select()
    .from(approvalEmails)
    .where(eq(approvalEmails.cycleId, cycleId))
    .limit(1);
  if (existingApproval.length > 0) {
    await setStep('PENDING_APPROVAL', { lastProjectId: project.id });
    return { ok: true, skipped: true };
  }

  const ideas = await db
    .select()
    .from(contentIdeas)
    .where(eq(contentIdeas.cycleId, cycleId));
  if (ideas.length < 3) return { ok: false, reason: 'ideas missing for cycle' };

  const mapped = ideas
    .sort((a, b) => a.optionNumber - b.optionNumber)
    .map((i) => ({
      title: i.title,
      target_keyword: i.targetKeyword ?? '',
      pitch: i.pitch ?? '',
      search_volume_rationale: i.searchVolumeRationale ?? '',
    }));

  const { subject, html, text } = buildApprovalEmail(project.name, mapped);
  const { threadId, messageId } = await sendApprovalEmail({
    to: CEO_EMAIL(),
    subject,
    html,
    text,
  });

  await db.insert(approvalEmails).values({
    id: uuid(),
    cycleId,
    projectId: project.id,
    gmailThreadId: threadId,
    gmailMessageId: messageId,
    sentAt: new Date().toISOString(),
    status: 'sent',
  });

  await setStep('PENDING_APPROVAL', { lastProjectId: project.id });
  await logActivity({ action: 'approval_email_sent', cycleId, projectId, details: { threadId } });

  return { ok: true, threadId, step: 'PENDING_APPROVAL' };
}

/**
 * STEP 2: Poll approval. Returns the selected option number if a reply was
 * detected. Transitions state to APPROVED or EXPIRED.
 */
export async function stepPollApproval() {
  const state = await getState();
  if (state.currentStep !== 'PENDING_APPROVAL') {
    return { ok: false, reason: `state is ${state.currentStep}` };
  }
  const cycleId = state.currentCycleId;
  const projectId = state.currentProjectId;
  if (!cycleId || !projectId) {
    return { ok: false, reason: 'missing cycle or project id' };
  }

  const [approval] = await db
    .select()
    .from(approvalEmails)
    .where(eq(approvalEmails.cycleId, cycleId))
    .orderBy(desc(approvalEmails.sentAt))
    .limit(1);

  if (!approval || !approval.gmailThreadId) {
    return { ok: false, reason: 'no approval email recorded' };
  }

  // Expiration check
  if (approval.sentAt) {
    const sent = new Date(approval.sentAt).getTime();
    const hrs = (Date.now() - sent) / (1000 * 60 * 60);
    if (hrs >= APPROVAL_TIMEOUT_HOURS) {
      await db
        .update(approvalEmails)
        .set({ status: 'expired' })
        .where(eq(approvalEmails.id, approval.id));
      await setStep('EXPIRED');
      await logActivity({ action: 'approval_expired', cycleId, projectId });
      return { ok: true, expired: true };
    }
  }

  // Fetch thread
  const thread = await getThread(approval.gmailThreadId);
  const messages = thread.messages ?? [];
  if (messages.length <= 1) {
    return { ok: true, waiting: true };
  }

  // Find a reply from the CEO (any message other than our send)
  const ceoEmail = CEO_EMAIL().toLowerCase();
  const replies = messages
    .slice(1)
    .filter((m) => {
      const headers = m.payload?.headers ?? [];
      const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value ?? '';
      return from.toLowerCase().includes(ceoEmail);
    });

  if (replies.length === 0) {
    return { ok: true, waiting: true };
  }

  // Parse the most recent reply
  const latest = replies[replies.length - 1];
  const body = extractPlainText(latest);
  const option = parseOptionFromReply(body);

  if (!option) {
    await logActivity({
      action: 'approval_reply_unparseable',
      cycleId,
      projectId,
      details: { preview: body.slice(0, 200) },
    });
    return { ok: true, waiting: true, note: 'reply present but no option detected' };
  }

  // Mark the selected idea
  const ideas = await db
    .select()
    .from(contentIdeas)
    .where(eq(contentIdeas.cycleId, cycleId));

  const selected = ideas.find((i) => i.optionNumber === option);
  if (!selected) {
    return { ok: false, reason: `option ${option} not found for cycle` };
  }
  await db
    .update(contentIdeas)
    .set({ isSelected: 1 })
    .where(eq(contentIdeas.id, selected.id));

  await db
    .update(approvalEmails)
    .set({
      status: 'replied',
      replyReceivedAt: new Date().toISOString(),
      selectedOption: option,
    })
    .where(eq(approvalEmails.id, approval.id));

  await setStep('APPROVED');
  await logActivity({ action: 'approval_received', cycleId, projectId, details: { option } });

  return { ok: true, option, selectedIdeaId: selected.id };
}

/**
 * STEP 3: Create content from selected idea.
 * Idempotent: if a v1 draft already exists for this cycle, skip the LLM call.
 * We don't flip to CREATING before the call — if the function times out, the
 * next advance tick retries from APPROVED.
 */
export async function stepCreateContent() {
  const state = await getState();
  if (state.currentStep !== 'APPROVED') {
    return { ok: false, reason: `state is ${state.currentStep}` };
  }
  const cycleId = state.currentCycleId!;
  const projectId = state.currentProjectId!;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const [idea] = await db
    .select()
    .from(contentIdeas)
    .where(and(eq(contentIdeas.cycleId, cycleId), eq(contentIdeas.isSelected, 1)))
    .limit(1);

  if (!project || !idea) return { ok: false, reason: 'project or idea missing' };

  // Idempotency: if a draft already exists for this cycle, advance and exit.
  const existingDrafts = await db
    .select()
    .from(contentDrafts)
    .where(eq(contentDrafts.cycleId, cycleId));
  if (existingDrafts.length > 0) {
    await setStep('REVIEWING');
    return { ok: true, skipped: true, draftId: existingDrafts[0].id };
  }

  const content = await generateContent(project, idea);

  const draftId = uuid();
  await db.insert(contentDrafts).values({
    id: draftId,
    ideaId: idea.id,
    projectId,
    cycleId,
    version: 1,
    title: content.title,
    slug: content.slug,
    metaDescription: content.meta_description,
    bodyHtml: content.body_html,
    excerpt: content.excerpt,
    socialLinkedin: content.social_linkedin,
    socialTwitter: content.social_twitter,
    socialFacebook: content.social_facebook,
    socialInstagram: content.social_instagram,
    status: 'draft',
  });

  await setStep('REVIEWING');
  await logActivity({ action: 'content_created', cycleId, projectId, details: { draftId, version: 1 } });

  return { ok: true, draftId };
}

/** STEP 4: Review with OpenAI. If score < 7 and revisions < 2, revise. Otherwise move to PUBLISHING. */
export async function stepReviewContent() {
  const state = await getState();
  if (state.currentStep !== 'REVIEWING') {
    return { ok: false, reason: `state is ${state.currentStep}` };
  }
  const cycleId = state.currentCycleId!;
  const projectId = state.currentProjectId!;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const [idea] = await db
    .select()
    .from(contentIdeas)
    .where(and(eq(contentIdeas.cycleId, cycleId), eq(contentIdeas.isSelected, 1)))
    .limit(1);

  const drafts = await db
    .select()
    .from(contentDrafts)
    .where(eq(contentDrafts.cycleId, cycleId))
    .orderBy(desc(contentDrafts.version));

  if (!project || !idea || drafts.length === 0) {
    return { ok: false, reason: 'missing data' };
  }
  const latest = drafts[0];
  const latestContent: GeneratedContent = {
    title: latest.title ?? '',
    slug: latest.slug ?? '',
    meta_description: latest.metaDescription ?? '',
    body_html: latest.bodyHtml ?? '',
    excerpt: latest.excerpt ?? '',
    social_linkedin: latest.socialLinkedin ?? '',
    social_twitter: latest.socialTwitter ?? '',
    social_facebook: latest.socialFacebook ?? '',
    social_instagram: latest.socialInstagram ?? '',
  };

  const review = await reviewContent(project, idea, latestContent);
  const overall = review.scores?.overall ?? 0;

  await db
    .update(contentDrafts)
    .set({
      reviewScore: overall,
      reviewFeedback: JSON.stringify(review),
      status: 'reviewed',
    })
    .where(eq(contentDrafts.id, latest.id));

  await logActivity({
    action: 'content_reviewed',
    cycleId,
    projectId,
    details: { version: latest.version, overall, needsRevision: review.needs_revision },
  });

  const maxRevisions = 2;
  const currentVersion = latest.version ?? 1;

  if (review.needs_revision && currentVersion < maxRevisions + 1) {
    // Revise
    const revised = await reviseContent(project, idea, latestContent, review);
    const newDraftId = uuid();
    await db.insert(contentDrafts).values({
      id: newDraftId,
      ideaId: idea.id,
      projectId,
      cycleId,
      version: currentVersion + 1,
      title: revised.title,
      slug: revised.slug,
      metaDescription: revised.meta_description,
      bodyHtml: revised.body_html,
      excerpt: revised.excerpt,
      socialLinkedin: revised.social_linkedin,
      socialTwitter: revised.social_twitter,
      socialFacebook: revised.social_facebook,
      socialInstagram: revised.social_instagram,
      status: 'revised',
    });
    await logActivity({ action: 'content_revised', cycleId, projectId, details: { newDraftId, version: currentVersion + 1 } });
    // stay in REVIEWING so the next cron tick reviews the new draft
    return { ok: true, revised: true, newDraftId };
  }

  // Approve and move to publishing
  await db
    .update(contentDrafts)
    .set({ status: 'approved' })
    .where(eq(contentDrafts.id, latest.id));
  await setStep('PUBLISHING');
  await logActivity({ action: 'content_approved', cycleId, projectId, details: { draftId: latest.id } });

  return { ok: true, approved: true, draftId: latest.id };
}

/** STEP 5: Publish latest approved draft to project platforms. */
export async function stepPublish() {
  const state = await getState();
  if (state.currentStep !== 'PUBLISHING') {
    return { ok: false, reason: `state is ${state.currentStep}` };
  }
  const cycleId = state.currentCycleId!;
  const projectId = state.currentProjectId!;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const drafts = await db
    .select()
    .from(contentDrafts)
    .where(eq(contentDrafts.cycleId, cycleId))
    .orderBy(desc(contentDrafts.version));
  const latest = drafts[0];
  if (!project || !latest) return { ok: false, reason: 'missing project or draft' };

  let platforms: Platform[] = [];
  try {
    platforms = JSON.parse(project.platforms ?? '[]') as Platform[];
  } catch {
    platforms = [];
  }

  const results = await publishDraft(latest.id, platforms);

  await db
    .update(contentDrafts)
    .set({ status: 'published' })
    .where(eq(contentDrafts.id, latest.id));

  await setStep('COMPLETE');
  await logActivity({ action: 'cycle_complete', cycleId, projectId, details: { platforms, results } });

  return { ok: true, results };
}

/** Utility: build the approval email body. */
function buildApprovalEmail(projectName: string, ideas: {
  title: string;
  target_keyword: string;
  pitch: string;
  search_volume_rationale: string;
}[]) {
  const subject = `[Hemingway] Approve content idea for ${projectName}`;
  const text = [
    `Hi,`,
    ``,
    `Hemingway has 3 content ideas for ${projectName}. Reply with a single digit — 1, 2, or 3 — to approve one.`,
    ``,
    ...ideas.flatMap((idea, i) => [
      `Option ${i + 1}: ${idea.title}`,
      `  Target keyword: ${idea.target_keyword}`,
      `  Pitch: ${idea.pitch}`,
      `  Volume rationale: ${idea.search_volume_rationale}`,
      ``,
    ]),
    `Just reply with 1, 2, or 3 in the body of the email. If we don't hear back within 48 hours this cycle will expire.`,
    ``,
    `— Hemingway`,
  ].join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#222;">
      <h2 style="color:#2B4C9B;margin-top:0;">Content idea approval for ${escapeHtml(projectName)}</h2>
      <p>Hemingway has 3 blog ideas ready. <strong>Reply with a single digit — 1, 2, or 3</strong> to approve one.</p>
      ${ideas
        .map(
          (idea, i) => `
        <div style="border:1px solid #e4e4e4;border-radius:8px;padding:16px;margin:16px 0;background:#fafafa;">
          <div style="font-size:12px;color:#3EA843;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Option ${i + 1}</div>
          <div style="font-size:18px;font-weight:700;margin:6px 0 10px 0;">${escapeHtml(idea.title)}</div>
          <div style="font-size:13px;color:#555;margin-bottom:8px;"><strong>Target keyword:</strong> ${escapeHtml(idea.target_keyword)}</div>
          <div style="font-size:14px;color:#333;margin-bottom:8px;">${escapeHtml(idea.pitch)}</div>
          <div style="font-size:12px;color:#777;font-style:italic;">${escapeHtml(idea.search_volume_rationale)}</div>
        </div>
      `,
        )
        .join('')}
      <p style="font-size:13px;color:#777;">Reply with just the digit. If we don't hear back within 48 hours this cycle will expire.</p>
    </div>
  `;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
