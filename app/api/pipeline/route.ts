import { NextRequest, NextResponse } from 'next/server';
import { isDashboardAuthorized, isCronRequest } from '@/lib/auth';
import { advanceOnce } from '@/lib/pipeline/advance';
import {
  stepStartCycle,
  stepPollApproval,
  stepCreateContent,
  stepReviewContent,
  stepPublish,
} from '@/lib/pipeline/steps';
import { setStep } from '@/lib/pipeline/state';
import { logActivity } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

/**
 * Consolidated pipeline API.
 * Query params:
 *   ?action=advance           -> run one state machine tick
 *   ?action=start             -> force start a cycle (bypass rotation gate)
 *   ?action=poll-approval     -> force approval poll
 *   ?action=create            -> force create content step
 *   ?action=review            -> force review step
 *   ?action=publish           -> force publish step
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
        // Bypass rotation gate by clearing lastRunAt temporarily
        const result = await stepStartCycle();
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
        await setStep('IDLE', { currentCycleId: null, currentProjectId: null });
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
