import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import { createClient } from '@libsql/client';
import { isCronRequest } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * One-shot admin endpoint: create tables + seed rotation projects.
 * Call it after first deploy with:
 *
 *   curl -X POST "https://<your-domain>/api/admin?action=migrate&key=$CRON_SECRET"
 *   curl -X POST "https://<your-domain>/api/admin?action=seed&key=$CRON_SECRET"
 *
 * Both are idempotent — safe to run multiple times.
 */

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT,
    rotation_order INTEGER NOT NULL,
    platforms TEXT DEFAULT '[]',
    config TEXT DEFAULT '{}',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );`,
  `CREATE TABLE IF NOT EXISTS schedule_state (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    last_project_id TEXT,
    last_run_at TEXT,
    next_run_at TEXT,
    current_step TEXT DEFAULT 'IDLE',
    current_cycle_id TEXT,
    current_project_id TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );`,
  `CREATE TABLE IF NOT EXISTS content_ideas (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    cycle_id TEXT NOT NULL,
    option_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    target_keyword TEXT,
    pitch TEXT,
    search_volume_rationale TEXT,
    is_selected INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );`,
  `CREATE TABLE IF NOT EXISTS content_drafts (
    id TEXT PRIMARY KEY,
    idea_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    cycle_id TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    title TEXT,
    slug TEXT,
    meta_description TEXT,
    body_html TEXT,
    excerpt TEXT,
    social_linkedin TEXT,
    social_twitter TEXT,
    social_facebook TEXT,
    social_instagram TEXT,
    review_score REAL,
    review_feedback TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now'))
  );`,
  `CREATE TABLE IF NOT EXISTS publications (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    platform_post_id TEXT,
    published_url TEXT,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    published_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );`,
  `CREATE TABLE IF NOT EXISTS approval_emails (
    id TEXT PRIMARY KEY,
    cycle_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    gmail_thread_id TEXT,
    gmail_message_id TEXT,
    sent_at TEXT,
    reminder_sent_at TEXT,
    reply_received_at TEXT,
    selected_option INTEGER,
    status TEXT DEFAULT 'sent'
  );`,
  `CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    cycle_id TEXT,
    project_id TEXT,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );`,
  `INSERT OR IGNORE INTO schedule_state (id, current_step) VALUES ('singleton', 'IDLE');`,
];

const SEEDS = [
  {
    name: 'Scrub Depot',
    domain: 'scrubdepot.ca',
    rotationOrder: 1,
    platforms: ['blog', 'facebook', 'instagram'],
    config: {
      industry: 'medical scrubs and uniforms',
      voice: 'professional but approachable, practical',
      keywords: ['medical scrubs Canada', 'nursing uniforms Vancouver', 'healthcare workwear'],
    },
  },
  {
    name: 'Nursing Shoes',
    domain: 'nursingshoes.ca',
    rotationOrder: 2,
    platforms: ['blog', 'facebook', 'instagram'],
    config: {
      industry: 'nursing and healthcare footwear',
      voice: 'caring, expert, comfort-focused',
      keywords: ['nursing shoes Canada', 'comfortable healthcare shoes', 'slip-resistant nursing footwear'],
    },
  },
  {
    name: 'The Web Guys',
    domain: 'thewebguys.ca',
    rotationOrder: 3,
    platforms: ['blog', 'linkedin', 'twitter'],
    config: {
      industry: 'AI-powered ecommerce tools and web development',
      voice: 'technical but accessible, innovative, confident',
      keywords: ['AI ecommerce tools', 'AI chatbot for ecommerce', 'AI size recommendation'],
    },
  },
  {
    name: 'Size Agent / Stitch',
    domain: 'thewebguys.ca/stitch',
    rotationOrder: 4,
    platforms: ['blog', 'linkedin', 'twitter'],
    config: {
      industry: 'AI size recommendation for online apparel',
      voice: 'data-driven, reducing returns, improving fit',
      keywords: ['AI size chart', 'reduce ecommerce returns', 'virtual fitting room'],
    },
  },
];

function makeClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL is not set');
  return createClient({ url, authToken });
}

async function handle(req: NextRequest) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const action = req.nextUrl.searchParams.get('action') ?? 'migrate';
  const client = makeClient();

  try {
    if (action === 'migrate') {
      for (const stmt of DDL) {
        await client.execute(stmt);
      }
      return NextResponse.json({ ok: true, applied: DDL.length });
    }

    if (action === 'seed') {
      const results: string[] = [];
      for (const p of SEEDS) {
        const existing = await client.execute({
          sql: 'SELECT id FROM projects WHERE name = ?',
          args: [p.name],
        });
        const platformsJson = JSON.stringify(p.platforms);
        const configJson = JSON.stringify(p.config);

        if (existing.rows.length > 0) {
          const id = existing.rows[0].id as string;
          await client.execute({
            sql: `UPDATE projects SET domain = ?, rotation_order = ?, platforms = ?, config = ?, is_active = 1 WHERE id = ?`,
            args: [p.domain, p.rotationOrder, platformsJson, configJson, id],
          });
          results.push(`updated:${p.name}`);
        } else {
          await client.execute({
            sql: `INSERT INTO projects (id, name, domain, rotation_order, platforms, config, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
            args: [uuid(), p.name, p.domain, p.rotationOrder, platformsJson, configJson],
          });
          results.push(`inserted:${p.name}`);
        }
      }
      await client.execute({
        sql: `INSERT OR IGNORE INTO schedule_state (id, current_step) VALUES ('singleton', 'IDLE')`,
        args: [],
      });
      return NextResponse.json({ ok: true, results });
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.close();
  }
}

export const GET = handle;
export const POST = handle;
