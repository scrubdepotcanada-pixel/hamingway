import { db } from '../db/client';
import { scheduleState } from '../db/schema';
import { eq } from 'drizzle-orm';

export type Step =
  | 'IDLE'
  | 'GENERATING'
  | 'IDEAS_READY'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'CREATING'
  | 'REVIEWING'
  | 'PUBLISHING'
  | 'COMPLETE'
  | 'EXPIRED'
  | 'FAILED';

export const ROTATION_INTERVAL_DAYS = 3;
export const APPROVAL_TIMEOUT_HOURS = 48;

export async function getState() {
  let rows = await db
    .select()
    .from(scheduleState)
    .where(eq(scheduleState.id, 'singleton'))
    .limit(1);
  if (rows.length === 0) {
    await db.insert(scheduleState).values({ id: 'singleton', currentStep: 'IDLE' });
    rows = await db
      .select()
      .from(scheduleState)
      .where(eq(scheduleState.id, 'singleton'))
      .limit(1);
  }
  return rows[0];
}

export async function setStep(step: Step, extra: Partial<{
  lastRunAt: string;
  nextRunAt: string;
  lastProjectId: string;
  currentCycleId: string | null;
  currentProjectId: string | null;
}> = {}) {
  const now = new Date().toISOString();
  await db
    .update(scheduleState)
    .set({
      currentStep: step,
      updatedAt: now,
      ...extra,
    })
    .where(eq(scheduleState.id, 'singleton'));
}
