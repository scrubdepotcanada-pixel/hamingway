# Hemingway

Automated content agent for **The Web Guys** (Vancouver AI/web agency). Hemingway rotates through client projects every 3 days, generates 3 SEO-focused content ideas with Claude, emails the CEO for approval, writes a full blog + social variants from the approved idea, cross-checks it with OpenAI, and publishes to each project's platforms.

Deployed as a standalone Next.js app on Vercel Hobby — free tier compatible.

- Generation: **Anthropic Claude** (`claude-sonnet-4-20250514`)
- Review: **OpenAI** (`gpt-4o-mini`)
- Database: **Turso** (libSQL, free)
- Email: **Gmail API** via OAuth refresh token
- Deploy: **Vercel Hobby**

## Architecture

Vercel Hobby caps serverless functions at 10s and 12 total. Hemingway handles this with a database-backed state machine: each pipeline step reads `schedule_state.current_step`, performs one action, writes the next state, and returns. A twice-daily cron advances the pipeline by one step per tick.

### Steps

```
IDLE ─► GENERATING ─► IDEAS_READY ─► PENDING_APPROVAL ─► APPROVED ─► REVIEWING ─► PUBLISHING ─► COMPLETE
                                            └─► EXPIRED (48h no reply)
```

Every transition is a single short handler (one DB write, one LLM call, or
one Gmail call). The dashboard's "Force start cycle" and "Run to next stop"
buttons auto-chain `/api/pipeline?action=advance` HTTP calls client-side
until the state machine lands on a human-wait step (`PENDING_APPROVAL`,
`COMPLETE`, etc). Each HTTP call stays well under the Vercel timeout.

### API routes (6 total — under the 12 function limit)

- `POST /api/auth` — password check for the dashboard
- `GET/POST /api/pipeline?action=...` — advance / start / generate-ideas / send-approval / poll-approval / create / review / publish / reset
- `GET/POST /api/projects?action=list|create|update|delete`
- `GET /api/dashboard?action=status|history|logs|draft`
- `GET /api/cron/pipeline` — cron-only: advance one step
- `GET /api/cron/approvals` — cron-only: poll Gmail for CEO replies

## Setup

### 1. Turso

```bash
turso db create hamingway
turso db tokens create hamingway    # save as TURSO_AUTH_TOKEN
turso db show hamingway --url       # save as TURSO_DATABASE_URL
```

### 2. Gmail OAuth

One-time OAuth consent to get a refresh token. Use Google Cloud Console:

1. Create a project, enable Gmail API.
2. Create OAuth 2.0 Client ID (Web app). Add redirect `https://developers.google.com/oauthplayground`.
3. In [OAuth Playground](https://developers.google.com/oauthplayground), click the gear → "Use your own OAuth credentials" → paste client ID/secret.
4. Authorize `https://www.googleapis.com/auth/gmail.modify`.
5. Exchange auth code for tokens → save the refresh token.

### 3. Env vars

Copy `.env.example` to `.env.local` (dev) or paste into Vercel env (prod):

```
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_USER_EMAIL=oreekoblentz@gmail.com
CEO_EMAIL=oreekoblentz@gmail.com
CRON_SECRET=...                # random string, used to verify cron + manual triggers
DASHBOARD_PASSWORD=scrubdepot2026
```

### 4. Install, migrate, seed

```bash
npm install
npm run db:migrate
npm run db:seed
```

### 5. Dev

```bash
npm run dev
# http://localhost:3000
```

### 6. Deploy

```bash
vercel link
vercel env pull .env.local
vercel deploy --prod
```

Point `content.thewebguys.ca` at the Vercel project.

## Cron Schedule

Hobby restricts cron to ~1/day. `vercel.json` sets:

- `0 9 * * *` — daily pipeline tick (rotation, create, review, publish)
- `0 21 * * *` — daily approval poll (Gmail reply check)

For finer-grained polling during an approval window, trigger manually from the dashboard or hit `/api/pipeline?action=poll-approval&key=$CRON_SECRET`.

## Pipeline overview

1. **Start cycle**: daily cron checks if 3 days have passed since the last run. If yes, advances the rotation pointer, asks Claude for 3 ideas, sends an approval email to the CEO (via Gmail), stores the thread ID.
2. **Poll approvals**: scans the Gmail thread for a reply containing `1`, `2`, or `3`. When found, marks the selected idea and advances state.
3. **Create content**: Claude writes the full blog post + social variants from the approved idea.
4. **Review**: OpenAI scores the draft. If overall < 7 (and < 2 revisions done), Claude is asked for a revision using the feedback.
5. **Publish**: writes `publications` rows for each platform. Real platform APIs are stubs in this phase — they mark the publication as `pending_manual` so the CEO can copy-paste until OAuth with each platform is wired up.

## Brand voice per project

Each project row holds a `config` JSON with `industry`, `voice`, and `keywords`. Seed includes Scrub Depot, Nursing Shoes, The Web Guys, and Size Agent / Stitch. Edit these via the dashboard → Projects tab.

## Dashboard

Visit `/` and enter the password. Tabs:

- **Status** — current step, active project, cycle in flight, manual trigger buttons.
- **History** — last 10 cycles, drafts produced, approval status.
- **Projects** — manage rotation.
- **Logs** — last 100 activity events.

## Reply parsing

The agent looks for a digit `1`, `2`, or `3` in the body of the reply, tolerating patterns like `Option 2`, `pick 2`, `#2`. Quoted reply history (`> …`) is stripped. If no digit is found we stay in `PENDING_APPROVAL` and try again on the next poll.

## Recovering from stuck states

If a pipeline step crashes mid-flight the `current_step` may be stuck at `GENERATING` or `CREATING`. From the dashboard click **Reset to IDLE** to start a new cycle. The existing artifacts in the database are preserved for audit.

## File map

```
app/
  layout.tsx / page.tsx / globals.css   -- dashboard UI
  api/
    auth/route.ts                       -- password check
    pipeline/route.ts                   -- advance/start/create/review/publish/reset
    projects/route.ts                   -- CRUD for rotation
    dashboard/route.ts                  -- status/history/logs/draft
    cron/
      pipeline/route.ts                 -- daily rotation/pipeline cron
      approvals/route.ts                -- daily approval poll cron
lib/
  db/{client,schema}.ts                 -- drizzle + libsql
  ai/{anthropic,openai,ideas,content,review}.ts
  gmail.ts                              -- send, thread get, reply parse
  pipeline/{state,rotation,steps,advance}.ts
  publish.ts                            -- phase 2 stubs
  auth.ts / log.ts
scripts/
  migrate.ts  seed.ts
vercel.json                             -- crons
```
