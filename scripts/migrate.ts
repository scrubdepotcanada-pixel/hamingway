/**
 * Raw SQL migration runner. Uses libsql directly so we don't depend on
 * drizzle-kit generated migrations (keeps the deploy path simple).
 *
 * Run with:  pnpm tsx scripts/migrate.ts     (after setting .env)
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';

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

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL is not set');

  const client = createClient({ url, authToken });
  for (const stmt of DDL) {
    await client.execute(stmt);
  }
  console.log(`Applied ${DDL.length} statements.`);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
