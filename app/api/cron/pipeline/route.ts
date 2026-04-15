import { NextRequest, NextResponse } from 'next/server';
import { isCronRequest } from '@/lib/auth';
import { advanceOnce } from '@/lib/pipeline/advance';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await advanceOnce();
  return NextResponse.json({ ok: true, result });
}
