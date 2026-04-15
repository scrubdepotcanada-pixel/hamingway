/**
 * Phase 2 publishing. For now these are stubs that mark publications as
 * "pending_manual" in the DB so a human can copy/paste. Swap in real platform
 * API calls once OAuth + approvals are obtained.
 */

import { v4 as uuid } from 'uuid';
import { db } from './db/client';
import { publications, contentDrafts } from './db/schema';
import { eq } from 'drizzle-orm';

export type Platform =
  | 'blog'
  | 'linkedin'
  | 'twitter'
  | 'facebook'
  | 'instagram';

export interface PublishResult {
  platform: Platform;
  status: 'pending_manual' | 'published' | 'failed';
  url?: string;
  postId?: string;
  error?: string;
}

async function publishStub(
  draftId: string,
  projectId: string,
  platform: Platform,
): Promise<PublishResult> {
  // No real API calls yet — record as pending_manual so the dashboard can
  // surface the content for copy/paste.
  await db.insert(publications).values({
    id: uuid(),
    draftId,
    projectId,
    platform,
    status: 'pending_manual',
    publishedAt: null,
  });

  return { platform, status: 'pending_manual' };
}

export async function publishDraft(
  draftId: string,
  platforms: Platform[],
): Promise<PublishResult[]> {
  const [draft] = await db
    .select()
    .from(contentDrafts)
    .where(eq(contentDrafts.id, draftId))
    .limit(1);

  if (!draft) throw new Error(`Draft ${draftId} not found`);

  const results: PublishResult[] = [];
  for (const platform of platforms) {
    try {
      const res = await publishStub(draftId, draft.projectId, platform);
      results.push(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.insert(publications).values({
        id: uuid(),
        draftId,
        projectId: draft.projectId,
        platform,
        status: 'failed',
        errorMessage: msg,
      });
      results.push({ platform, status: 'failed', error: msg });
    }
  }

  return results;
}
