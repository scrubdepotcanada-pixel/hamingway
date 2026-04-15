import { v4 as uuid } from 'uuid';
import { db } from './db/client';
import { activityLog } from './db/schema';

export async function logActivity(opts: {
  action: string;
  cycleId?: string | null;
  projectId?: string | null;
  details?: unknown;
}) {
  try {
    await db.insert(activityLog).values({
      id: uuid(),
      cycleId: opts.cycleId ?? null,
      projectId: opts.projectId ?? null,
      action: opts.action,
      details: opts.details ? JSON.stringify(opts.details) : null,
    });
  } catch (err) {
    // logging should never throw
    console.error('logActivity failed', err);
  }
}
