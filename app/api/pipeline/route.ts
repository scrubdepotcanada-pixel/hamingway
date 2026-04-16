import { NextRequest, NextResponse } from 'next/server';
import { isDashboardAuthorized, isCronRequest } from '@/lib/auth';
import { advanceOnce } from '@/lib/pipeline/advance';
import {
  stepStartCycle,
  stepManualStart,
  stepGenerateIdeas,
  stepSendApprovalEmail,
  stepPollApproval,
  stepCreateContent,
  stepReviewContent,
  stepPublish,
} from '@/lib/pipeline/steps';
import { setStep } from '@/lib/pipeline/state';
import { logActivity } from '@/lib/log';

export const runtime = 'nodejs';
/**
 * Vercel Hobby allows up to 60s. Individual steps are still small (DB write
 * or a single LLM call), but we give them headroom so content generation
 * (blog + 4 social variants) has room to breathe.
 */
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Consolidated pipeline API.
 *   ?action=advance           -> run one state machine tick
 *   ?action=start             -> force-start a cycle (bypasses 3-day gate).
 *                                Fast: just picks project + writes state.
 *                                Does NOT call Claude or send email.
 *   ?action=manual-start      -> start from a URL you want analyzed.
 *                                Requires POST body: { projectId, url }.
 *                                Claude will inspect the URL for SEO/AEO
 *                                gaps and produce targeted ideas.
 *   ?action=generate-ideas    -> LLM call: generate 3 ideas (GENERATING -> IDEAS_READY)
 *   ?action=send-approval     -> Gmail send (IDEAS_READY -> PENDING_APPROVAL)
 *   ?action=poll-approval     -> Gmail thread poll
 *   ?action=create            -> LLM call: blog + socials (APPROVED -> REVIEWING)
 *   ?action=review            -> LLM call: review (REVIEWING -> PUBLISHING or revise)
 *   ?action=publish           -> publish to platforms (PUBLISHING -> COMPLETE)
 *   ?action=reset             -> reset state to IDLE (recovery)
 */
async function handle(req: NextRequest) {
  if (!isDashboardAuthorized(req) && !isCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const action = req.nextUrl.searchParams.get('action') ?? 'advance';

  try {
    switch (action) {
      case 'advance': {
        const result = await advanceOnce();
        return NextResponse.json({ ok: true, result });
      }
      case 'start': {
        const result = await stepStartCycle({ force: true });
        return NextResponse.json({ ok: true, result });
      }
      case 'manual-start': {
        let body: { projectId?: string; url?: string } = {};
        try { body = await req.json(); } catch { /* empty body */ }
        if (!body.projectId || !body.url) {
          return NextResponse.json({ error: 'projectId and url are required' }, { status: 400 });
        }
        const result = await stepManualStart({ projectId: body.projectId, url: body.url });
        return NextResponse.json({ ok: true, result });
      }
      case 'generate-ideas': {
        const result = await stepGenerateIdeas();
        return NextResponse.json({ ok: true, result });
      }
      case 'send-approval': {
        const result = await stepSendApprovalEmail();
        return NextResponse.json({ ok: true, result });
      }
      case 'poll-approval': {
        const result = await stepPollApproval();
        return NextResponse.json({ ok: true, result });
      }
      case 'create': {
        const result = await stepCreateContent();
        return NextResponse.json({ ok: true, result });
      }
      case 'review': {
        const result = await stepReviewContent();
        return NextResponse.json({ ok: true, result });
      }
      case 'publish': {
        const result = await stepPublish();
        return NextResponse.json({ ok: true, result });
      }
      case 'reset': {
        await setStep('IDLE', { currentCycleId: null, currentProjectId: null, analysisUrl: null, analysisData: null });
        await logActivity({ action: 'pipeline_reset' });
        return NextResponse.json({ ok: true, reset: true });
      }
      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
