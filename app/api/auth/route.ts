import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Minimal password check. Returns 200 if the password matches
 * DASHBOARD_PASSWORD so the UI can unlock without exposing the password to
 * the client bundle.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: 'DASHBOARD_PASSWORD not configured' }, { status: 500 });
  }
  let password = '';
  try {
    const body = await req.json();
    password = String(body?.password ?? '');
  } catch {
    password = '';
  }
  if (password !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
