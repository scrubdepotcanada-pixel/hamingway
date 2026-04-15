import { NextRequest } from 'next/server';

export function isCronRequest(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  // Vercel cron sets Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${expected}`) return true;
  // Also allow ?key= query param for manual triggering
  const key = req.nextUrl.searchParams.get('key');
  return key === expected;
}

export function isDashboardAuthorized(req: NextRequest): boolean {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  const header = req.headers.get('x-dashboard-password');
  if (header === expected) return true;
  const body = req.nextUrl.searchParams.get('password');
  return body === expected;
}
