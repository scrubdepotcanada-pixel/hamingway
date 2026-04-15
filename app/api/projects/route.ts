import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import { asc, eq } from 'drizzle-orm';
import { isDashboardAuthorized } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { projects } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  if (!isDashboardAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const action = req.nextUrl.searchParams.get('action') ?? 'list';

  try {
    switch (action) {
      case 'list': {
        const rows = await db
          .select()
          .from(projects)
          .orderBy(asc(projects.rotationOrder));
        return NextResponse.json({ ok: true, projects: rows });
      }
      case 'create': {
        const body = await req.json();
        const id = uuid();
        await db.insert(projects).values({
          id,
          name: String(body.name ?? ''),
          domain: body.domain ?? null,
          rotationOrder: Number(body.rotationOrder ?? 999),
          platforms: JSON.stringify(body.platforms ?? []),
          config: JSON.stringify(body.config ?? {}),
          isActive: body.isActive === false ? 0 : 1,
        });
        return NextResponse.json({ ok: true, id });
      }
      case 'update': {
        const body = await req.json();
        const id = String(body.id ?? '');
        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        const updates: Record<string, unknown> = {};
        if (body.name !== undefined) updates.name = body.name;
        if (body.domain !== undefined) updates.domain = body.domain;
        if (body.rotationOrder !== undefined) updates.rotationOrder = Number(body.rotationOrder);
        if (body.platforms !== undefined) updates.platforms = JSON.stringify(body.platforms);
        if (body.config !== undefined) updates.config = JSON.stringify(body.config);
        if (body.isActive !== undefined) updates.isActive = body.isActive ? 1 : 0;
        await db.update(projects).set(updates).where(eq(projects.id, id));
        return NextResponse.json({ ok: true });
      }
      case 'delete': {
        const body = await req.json();
        const id = String(body.id ?? '');
        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        await db.delete(projects).where(eq(projects.id, id));
        return NextResponse.json({ ok: true });
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
