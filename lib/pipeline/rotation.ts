import { db } from '../db/client';
import { projects } from '../db/schema';
import { eq, asc } from 'drizzle-orm';

/**
 * Return the next project in rotation given the id of the last project used.
 * If lastId is null or not found, return the first active project.
 */
export async function pickNextProject(lastId: string | null) {
  const active = await db
    .select()
    .from(projects)
    .where(eq(projects.isActive, 1))
    .orderBy(asc(projects.rotationOrder));

  if (active.length === 0) return null;
  if (!lastId) return active[0];

  const idx = active.findIndex((p) => p.id === lastId);
  if (idx === -1) return active[0];
  return active[(idx + 1) % active.length];
}
