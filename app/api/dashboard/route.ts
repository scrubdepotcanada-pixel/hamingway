import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { isDashboardAuthorized } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  activityLog,
  approvalEmails,
  contentDrafts,
  contentIdeas,
  projects,
  publications,
  scheduleState,
} from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  if (!isDashboardAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const action = req.nextUrl.searchParams.get('action') ?? 'status';

  try {
    switch (action) {
      case 'status': {
        const [state] = await db
          .select()
          .from(scheduleState)
          .where(eq(scheduleState.id, 'singleton'))
          .limit(1);

        let currentProject = null;
        if (state?.currentProjectId) {
          const [p] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, state.currentProjectId))
            .limit(1);
          currentProject = p ?? null;
        }

        let currentIdeas: unknown[] = [];
        let currentDrafts: unknown[] = [];
        let currentApproval = null;
        if (state?.currentCycleId) {
          currentIdeas = await db
            .select()
            .from(contentIdeas)
            .where(eq(contentIdeas.cycleId, state.currentCycleId));
          currentDrafts = await db
            .select()
            .from(contentDrafts)
            .where(eq(contentDrafts.cycleId, state.currentCycleId))
            .orderBy(desc(contentDrafts.version));
          const [a] = await db
            .select()
            .from(approvalEmails)
            .where(eq(approvalEmails.cycleId, state.currentCycleId))
            .limit(1);
          currentApproval = a ?? null;
        }

        return NextResponse.json({
          ok: true,
          state,
          currentProject,
          currentIdeas,
          currentDrafts,
          currentApproval,
        });
      }

      case 'history': {
        // Last 10 cycles by grouping approval_emails (one per cycle)
        const recent = await db
          .select()
          .from(approvalEmails)
          .orderBy(desc(approvalEmails.sentAt))
          .limit(10);

        const enriched = await Promise.all(
          recent.map(async (a) => {
            const [p] = await db
              .select()
              .from(projects)
              .where(eq(projects.id, a.projectId))
              .limit(1);
            const ideas = await db
              .select()
              .from(contentIdeas)
              .where(eq(contentIdeas.cycleId, a.cycleId));
            const drafts = await db
              .select()
              .from(contentDrafts)
              .where(eq(contentDrafts.cycleId, a.cycleId))
              .orderBy(desc(contentDrafts.version));
            return { approval: a, project: p, ideas, drafts };
          }),
        );

        return NextResponse.json({ ok: true, cycles: enriched });
      }

      case 'logs': {
        const rows = await db
          .select()
          .from(activityLog)
          .orderBy(desc(activityLog.createdAt))
          .limit(100);
        return NextResponse.json({ ok: true, logs: rows });
      }

      case 'draft': {
        const id = req.nextUrl.searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        const [d] = await db
          .select()
          .from(contentDrafts)
          .where(eq(contentDrafts.id, id))
          .limit(1);
        if (!d) return NextResponse.json({ error: 'not found' }, { status: 404 });
        const pubs = await db
          .select()
          .from(publications)
          .where(eq(publications.draftId, id));
        return NextResponse.json({ ok: true, draft: d, publications: pubs });
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
