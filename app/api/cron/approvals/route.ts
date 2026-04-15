import { NextRequest, NextResponse } from 'next/server';
import { isCronRequest } from '@/lib/auth';
import { getState } from '@/lib/pipeline/state';
import { stepPollApproval } from '@/lib/pipeline/steps';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const state = await getState();
  if (state.currentStep !== 'PENDING_APPROVAL') {
    return NextResponse.json({ ok: true, skipped: true, step: state.currentStep });
  }

  const result = await stepPollApproval();
  return NextResponse.json({ ok: true, result });
}
