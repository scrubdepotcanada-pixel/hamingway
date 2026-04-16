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
import { analyzeSiteAndGenerateIdeas } from '../ai/analyze';
import { fetchSiteSnapshot } from '../web/fetch';
import { generateContent, reviseContent, type GeneratedContent } from '../ai/content';
import { reviewContent } from '../ai/review';
import { sendApprovalEmail, getThread, extractPlainText, parseOptionFromReply } from '../gmail';
import { publishDraft, type Platform } from '../publish';
import { logActivity } from '../log';
import {
  fetchImagesForQueries,
  insertImagesIntoBody,
  type UnsplashImage,
} from '../images/unsplash';

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
    analysisUrl: null,
    analysisData: null,
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
 * STEP 1a-manual: Start a cycle from a URL you want analyzed.
 * Instead of rotating to the next project, you pick a project AND a URL.
 * Claude will fetch the URL, analyze SEO/AEO, and produce 3 ideas tailored
 * to that website's gaps.
 *
 * Like stepStartCycle, this only writes state — NO LLM calls. The actual
 * analysis + idea generation happen in stepGenerateIdeas (which checks
 * for analysis_url in state).
 */
export async function stepManualStart(opts: {
  projectId: string;
  url: string;
}) {
  const state = await getState();
  const startable =
    state.currentStep === 'IDLE' ||
    state.currentStep === 'COMPLETE' ||
    state.currentStep === 'EXPIRED' ||
    state.currentStep === 'FAILED';

  if (!startable) {
    return { ok: false, reason: `state is ${state.currentStep}, cannot start` };
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, opts.projectId)).limit(1);
  if (!project) return { ok: false, reason: 'project not found' };

  const cycleId = uuid();
  await setStep('GENERATING', {
    currentCycleId: cycleId,
    currentProjectId: project.id,
    lastRunAt: new Date().toISOString(),
    analysisUrl: opts.url,
    analysisData: null,
  });
  await logActivity({
    action: 'manual_cycle_started',
    cycleId,
    projectId: project.id,
    details: { project: project.name, url: opts.url },
  });

  return { ok: true, cycleId, projectId: project.id, projectName: project.name, url: opts.url, step: 'GENERATING' };
}

/**
 * STEP 1b: Generate ideas via Claude. Transitions GENERATING -> IDEAS_READY.
 * Idempotent: if ideas already exist for the cycle, skips the LLM call.
 *
 * Two modes:
 *  - Standard (no analysis_url): uses the project config to brainstorm ideas.
 *  - Manual/URL (analysis_url is set): fetches the URL, runs a full SEO/AEO
 *    analysis, then generates 3 gap-filling ideas. Stores the analysis in
 *    schedule_state.analysis_data so the dashboard can display it.
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

  const analysisUrl = state.analysisUrl ?? null;
  let ideas: { title: string; target_keyword: string; pitch: string; search_volume_rationale: string }[];
  let analysisJson: string | null = null;

  if (analysisUrl) {
    // URL mode: fetch the site, analyze SEO/AEO, produce ideas from gaps
    const snapshot = await fetchSiteSnapshot(analysisUrl);
    const cfg = safeParseJson<Record<string, string>>(project.config) ?? {};
    const analysis = await analyzeSiteAndGenerateIdeas(snapshot, project.name, cfg.voice);
    ideas = analysis.ideas;
    analysisJson = JSON.stringify({
      summary: analysis.summary,
      current_strengths: analysis.current_strengths,
      seo_gaps: analysis.seo_gaps,
      aeo_gaps: analysis.aeo_gaps,
      url: analysisUrl,
      fetchedAt: snapshot.fetchedAt,
    });
    await logActivity({
      action: 'site_analyzed',
      cycleId,
      projectId,
      details: {
        url: analysisUrl,
        strengths: analysis.current_strengths.length,
        seoGaps: analysis.seo_gaps.length,
        aeoGaps: analysis.aeo_gaps.length,
      },
    });
  } else {
    // Standard mode: brainstorm ideas from project config
    ideas = await generateIdeas(project);
  }

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
  await setStep('IDEAS_READY', {
    analysisData: analysisJson,
  });
  await logActivity({
    action: analysisUrl ? 'ideas_generated_from_analysis' : 'ideas_generated',
    cycleId,
    projectId,
    details: { count: 3, url: analysisUrl },
  });

  return { ok: true, count: 3, step: 'IDEAS_READY', mode: analysisUrl ? 'url-analysis' : 'standard' };
}

/**
 * STEP 1b-manual: Select an idea directly (no email).
 * Used in manual mode — the user clicks a button in the dashboard instead
 * of replying to an email. Transitions from IDEAS_READY -> APPROVED.
 */
export async function stepSelectIdea(ideaId: string) {
  const state = await getState();
  if (state.currentStep !== 'IDEAS_READY') {
    return { ok: false, reason: `state is ${state.currentStep}, need IDEAS_READY` };
  }
  const cycleId = state.currentCycleId;
  const projectId = state.currentProjectId;
  if (!cycleId || !projectId) return { ok: false, reason: 'missing cycle or project id' };

  const [idea] = await db.select().from(contentIdeas).where(eq(contentIdeas.id, ideaId)).limit(1);
  if (!idea) return { ok: false, reason: 'idea not found' };
  if (idea.cycleId !== cycleId) return { ok: false, reason: 'idea does not belong to current cycle' };

  await db.update(contentIdeas).set({ isSelected: 1 }).where(eq(contentIdeas.id, ideaId));
  await setStep('APPROVED');
  await logActivity({
    action: 'idea_selected_manually',
    cycleId,
    projectId,
    details: { ideaId, title: idea.title, option: idea.optionNumber },
  });

  return { ok: true, ideaId, title: idea.title, step: 'APPROVED' };
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
 *
 * Also fetches Unsplash images based on Claude's image_queries and embeds
 * them into body_html after each H2. Best-effort: if UNSPLASH_ACCESS_KEY is
 * missing or the API fails, the draft still saves without images.
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

  // Fetch images and embed them. Best-effort: never fails the step.
  let images: UnsplashImage[] = [];
  try {
    images = await fetchImagesForQueries(content.image_queries ?? []);
  } catch (err) {
    await logActivity({
      action: 'unsplash_error',
      cycleId,
      projectId,
      details: { message: err instanceof Error ? err.message : String(err) },
    });
    images = [];
  }
  const bodyWithImages = insertImagesIntoBody(content.body_html ?? '', images);

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
    bodyHtml: bodyWithImages,
    excerpt: content.excerpt,
    socialLinkedin: content.social_linkedin,
    socialTwitter: content.social_twitter,
    socialFacebook: content.social_facebook,
    socialInstagram: content.social_instagram,
    images: JSON.stringify(images),
    status: 'draft',
  });

  await setStep('REVIEWING');
  await logActivity({
    action: 'content_created',
    cycleId,
    projectId,
    details: { draftId, version: 1, imageCount: images.length, imageQueries: content.image_queries },
  });

  return { ok: true, draftId, imageCount: images.length };
}

/**
 * STEP 4: Review + autonomous revise.
 *
 * Two LLM passes maximum happen on this step within ONE cron tick:
 *   a) GPT reviews the latest draft (scores + issues + suggestions).
 *   b) If overall >= 7: approve, advance to PUBLISHING. No revision.
 *   c) If < 7 and version < 3 (max 2 revision cycles): Claude evaluates each
 *      suggestion (accept/reject/modify with reasoning), produces a revised
 *      draft, inserts as v+1. Images are refetched and re-embedded.
 *      State STAYS in REVIEWING so the next tick re-reviews the new draft.
 *   d) If < 7 and already at v3 (two revisions done): publish anyway and
 *      flag it with a `content_published_below_threshold` log entry.
 *
 * Every decision Claude makes is stored under `review_feedback` on the
 * resulting revised draft as `{ review, decisions }`.
 */
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

  // Preserve previous image_queries so the revised draft can reuse them if
  // Claude doesn't propose new ones.
  let previousImageQueries: string[] = [];
  try {
    const parsed = latest.reviewFeedback ? JSON.parse(latest.reviewFeedback) : null;
    if (parsed?.imageQueries && Array.isArray(parsed.imageQueries)) {
      previousImageQueries = parsed.imageQueries;
    }
  } catch {
    // ignore
  }

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
    image_queries: previousImageQueries,
  };

  // (a) GPT review
  const review = await reviewContent(project, idea, latestContent);
  const overall = review.scores?.overall ?? 0;
  const currentVersion = latest.version ?? 1;
  const MAX_REVISIONS = 2;
  const atMaxVersion = currentVersion >= MAX_REVISIONS + 1; // v3 is the last allowed

  // Persist review on the draft that was just reviewed.
  const existingFeedback = safeParseJson<Record<string, unknown>>(latest.reviewFeedback) ?? {};
  await db
    .update(contentDrafts)
    .set({
      reviewScore: overall,
      reviewFeedback: JSON.stringify({ ...existingFeedback, review }),
      status: 'reviewed',
    })
    .where(eq(contentDrafts.id, latest.id));

  await logActivity({
    action: 'content_reviewed',
    cycleId,
    projectId,
    details: { version: currentVersion, overall, needsRevision: review.needs_revision },
  });

  // (b) Score good enough — approve and advance.
  if (overall >= 7) {
    await db
      .update(contentDrafts)
      .set({ status: 'approved' })
      .where(eq(contentDrafts.id, latest.id));
    await setStep('PUBLISHING');
    await logActivity({
      action: 'content_approved',
      cycleId,
      projectId,
      details: { draftId: latest.id, overall, version: currentVersion },
    });
    return { ok: true, approved: true, overall, draftId: latest.id };
  }

  // (d) Score too low but we've already revised twice — publish anyway, flagged.
  if (atMaxVersion) {
    await db
      .update(contentDrafts)
      .set({ status: 'approved' })
      .where(eq(contentDrafts.id, latest.id));
    await setStep('PUBLISHING');
    await logActivity({
      action: 'content_published_below_threshold',
      cycleId,
      projectId,
      details: { draftId: latest.id, overall, version: currentVersion, note: 'Max 2 revisions reached' },
    });
    return { ok: true, approvedBelowThreshold: true, overall, draftId: latest.id };
  }

  // (c) Revise autonomously. Claude decides accept/reject/modify per suggestion.
  const { decisions, revised_draft: revised } = await reviseContent(
    project,
    idea,
    latestContent,
    review,
  );

  // Refetch Unsplash images for the revised draft (in case image_queries changed).
  let images: UnsplashImage[] = [];
  try {
    images = await fetchImagesForQueries(revised.image_queries ?? previousImageQueries);
  } catch (err) {
    await logActivity({
      action: 'unsplash_error',
      cycleId,
      projectId,
      details: { message: err instanceof Error ? err.message : String(err), phase: 'revision' },
    });
    images = [];
  }
  const bodyWithImages = insertImagesIntoBody(revised.body_html ?? '', images);

  const newDraftId = uuid();
  const newVersion = currentVersion + 1;
  await db.insert(contentDrafts).values({
    id: newDraftId,
    ideaId: idea.id,
    projectId,
    cycleId,
    version: newVersion,
    title: revised.title,
    slug: revised.slug,
    metaDescription: revised.meta_description,
    bodyHtml: bodyWithImages,
    excerpt: revised.excerpt,
    socialLinkedin: revised.social_linkedin,
    socialTwitter: revised.social_twitter,
    socialFacebook: revised.social_facebook,
    socialInstagram: revised.social_instagram,
    images: JSON.stringify(images),
    // Keep review + decisions attached so the dashboard can show both.
    reviewFeedback: JSON.stringify({
      based_on_review: review,
      decisions,
      imageQueries: revised.image_queries ?? previousImageQueries,
    }),
    status: 'revised',
  });

  const accepted = decisions.filter((d) => d.verdict === 'accept').length;
  const modified = decisions.filter((d) => d.verdict === 'modify').length;
  const rejected = decisions.filter((d) => d.verdict === 'reject').length;

  await logActivity({
    action: 'content_revised',
    cycleId,
    projectId,
    details: {
      newDraftId,
      version: newVersion,
      priorOverall: overall,
      decisionCounts: { accepted, modified, rejected, total: decisions.length },
    },
  });

  // Stay in REVIEWING so the next tick re-reviews the new draft.
  return {
    ok: true,
    revised: true,
    newDraftId,
    version: newVersion,
    priorOverall: overall,
    decisionCounts: { accepted, modified, rejected },
  };
}

function safeParseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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
