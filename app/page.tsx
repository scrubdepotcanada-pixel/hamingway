'use client';

import { useEffect, useState, useCallback } from 'react';

type TabKey = 'status' | 'history' | 'projects' | 'logs';

const STORAGE_KEY = 'hemingway_password';

/**
 * TWG agent nav. Update `href` values as each sub-app's subdomain comes online.
 * Ordered alphabetically (except Hemingway which is marked current).
 */
const AGENTS: Array<{ name: string; href: string; tag?: string }> = [
  { name: 'Stitch', href: 'https://stitch.thewebguys.ca', tag: 'size' },
  { name: 'Maya', href: 'https://pricecompare.thewebguys.ca', tag: 'price' },
  { name: 'Goldman', href: 'https://goldman.thewebguys.ca', tag: 'finance' },
  { name: 'Sherlock', href: 'https://seo.thewebguys.ca', tag: 'seo' },
  { name: 'Watson', href: 'https://winback.thewebguys.ca', tag: 'retention' },
  { name: 'Franklin', href: 'https://franklin.thewebguys.ca', tag: 'research' },
  { name: 'Hemingway', href: 'https://hemingway.thewebguys.ca', tag: 'content' },
];
const CURRENT_AGENT = 'Hemingway';

export default function HomePage() {
  const [password, setPassword] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) setPassword(stored);
  }, []);

  const onLogout = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setPassword(null);
  };

  return (
    <SiteShell showLogout={!!password} onLogout={onLogout}>
      {!password ? (
        <Login onAuth={(pw) => setPassword(pw)} />
      ) : (
        <Dashboard password={password} onLogout={onLogout} />
      )}
    </SiteShell>
  );
}

/* ------------------------ Site shell (header + footer) ------------------------ */

function SiteShell({
  children,
  showLogout,
  onLogout,
}: {
  children: React.ReactNode;
  showLogout: boolean;
  onLogout: () => void;
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="hw-shell">
      <header className="hw-header">
        <div className="hw-header-inner">
          <div className="hw-logo">
            <span className="hw-logo-mark">W</span>
            <a href="https://thewebguys.ca" target="_blank" rel="noreferrer" className="hw-logo-text">
              The Web Guys
              <small>AI Agent Platform</small>
            </a>
          </div>

          <div className="hw-agent-label">
            <span className="hw-agent-name">Hemingway</span>
            <span className="hw-agent-tag">Content Agent</span>
          </div>

          <button
            className="hw-hamburger"
            onClick={() => setNavOpen((o) => !o)}
            aria-label="Toggle navigation"
            aria-expanded={navOpen}
          >
            ☰
          </button>

          <nav className={`hw-nav ${navOpen ? 'is-open' : ''}`} onClick={() => setNavOpen(false)}>
            {AGENTS.map((a) => (
              <a
                key={a.name}
                href={a.href}
                className={`hw-nav-link ${a.name === CURRENT_AGENT ? 'is-current' : ''}`}
                target={a.name === CURRENT_AGENT ? undefined : '_blank'}
                rel={a.name === CURRENT_AGENT ? undefined : 'noreferrer'}
              >
                {a.name}
              </a>
            ))}
          </nav>

          {showLogout && (
            <div className="hw-header-actions">
              <button className="hw-logout-btn" onClick={onLogout}>Log out</button>
            </div>
          )}
        </div>
      </header>

      <main className="hw-main">
        <div className="hw-container">{children}</div>
      </main>

      <footer className="hw-footer">
        © 2026 <a href="https://thewebguys.ca" target="_blank" rel="noreferrer">The Web Guys</a> · Hemingway runs on Vercel, Turso, Claude & GPT.
      </footer>
    </div>
  );
}

function Login({ onAuth }: { onAuth: (pw: string) => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    setBusy(false);
    if (res.ok) {
      sessionStorage.setItem(STORAGE_KEY, pw);
      onAuth(pw);
    } else {
      setErr('Wrong password.');
    }
  }

  return (
    <div className="hw-login-wrap">
      <form className="hw-login" onSubmit={submit}>
        <h2>Sign in</h2>
        <p className="hw-muted hw-small">Enter the Hemingway dashboard password.</p>
        <div style={{ marginTop: 12 }}>
          <div className="hw-field-label">Password</div>
          <input
            className="hw-input"
            type="password"
            placeholder="••••••••"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
          />
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="hw-btn hw-btn--primary" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Enter dashboard'}
          </button>
        </div>
        {err && <p style={{ color: '#c0392b', marginTop: 10 }} className="hw-small">{err}</p>}
      </form>
    </div>
  );
}

function Dashboard({ password, onLogout }: { password: string; onLogout: () => void }) {
  const [tab, setTab] = useState<TabKey>('status');

  const authedFetch = useCallback(
    async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set('x-dashboard-password', password);
      if (init?.body && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      const res = await fetch(url, { ...init, headers });
      if (res.status === 401) {
        onLogout();
        throw new Error('unauthorized');
      }
      return res;
    },
    [password, onLogout],
  );

  return (
    <div>
      <div className="hw-page-title">
        <h1>Dashboard</h1>
        <span className="hw-page-sub">
          Rotating through client projects every 3 days · Claude generates, GPT reviews, Hemingway publishes.
        </span>
      </div>

      <div className="hw-tabs" role="tablist">
        <button className={`hw-tab ${tab === 'status' ? 'is-active' : ''}`} onClick={() => setTab('status')}>Status</button>
        <button className={`hw-tab ${tab === 'history' ? 'is-active' : ''}`} onClick={() => setTab('history')}>History</button>
        <button className={`hw-tab ${tab === 'projects' ? 'is-active' : ''}`} onClick={() => setTab('projects')}>Projects</button>
        <button className={`hw-tab ${tab === 'logs' ? 'is-active' : ''}`} onClick={() => setTab('logs')}>Logs</button>
      </div>

      {tab === 'status' && <StatusTab authedFetch={authedFetch} />}
      {tab === 'history' && <HistoryTab authedFetch={authedFetch} />}
      {tab === 'projects' && <ProjectsTab authedFetch={authedFetch} />}
      {tab === 'logs' && <LogsTab authedFetch={authedFetch} />}
    </div>
  );
}

/* ------------------------ Status ------------------------ */

// States where we should STOP auto-advancing (waiting on human or terminal).
const HUMAN_WAIT_STEPS = new Set([
  'PENDING_APPROVAL', 'COMPLETE', 'EXPIRED', 'FAILED', 'IDLE',
]);

function StatusTab({ authedFetch }: { authedFetch: (u: string, i?: RequestInit) => Promise<Response> }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  // Manual URL analysis state
  const [manualUrl, setManualUrl] = useState('');
  const [manualProjectId, setManualProjectId] = useState('');
  const [projectsList, setProjectsList] = useState<any[]>([]);

  const load = useCallback(async () => {
    const res = await authedFetch('/api/dashboard?action=status');
    setData(await res.json());
  }, [authedFetch]);

  const loadProjects = useCallback(async () => {
    const res = await authedFetch('/api/projects?action=list');
    const body = await res.json();
    const list = body.projects ?? [];
    setProjectsList(list);
    if (!manualProjectId && list.length > 0) setManualProjectId(list[0].id);
  }, [authedFetch, manualProjectId]);

  useEffect(() => {
    load();
    loadProjects();
  }, [load, loadProjects]);

  async function callAction(action: string) {
    const res = await authedFetch(`/api/pipeline?action=${action}`, { method: 'POST' });
    return res.json();
  }

  async function callActionPost(action: string, body: unknown) {
    const res = await authedFetch(`/api/pipeline?action=${action}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return res.json();
  }

  /**
   * Manual URL analysis chain:
   *  manual-start (saves URL + project, sets GENERATING)
   *  → advance (fetches site + Claude analyzes + ideas)
   *  → advance (sends approval email)
   *  → stops at PENDING_APPROVAL (you pick 1/2/3 via email)
   */
  async function runManualChain() {
    if (!manualUrl.trim() || !manualProjectId) return;
    setBusy('manual');
    setMsg(null);
    const responses: any[] = [];
    try {
      setProgress('Starting manual cycle — saving URL…');
      responses.push(await callActionPost('manual-start', { projectId: manualProjectId, url: manualUrl.trim() }));
      await load();

      for (let i = 0; i < 6; i++) {
        const step = await fetchStep();
        if (!step || HUMAN_WAIT_STEPS.has(step)) break;
        const label = step === 'GENERATING'
          ? 'Fetching website + running SEO/AEO analysis…'
          : `Advancing from ${step}…`;
        setProgress(label);
        responses.push(await callAction('advance'));
        await load();
      }
      setProgress(null);
      setMsg(JSON.stringify(responses, null, 2));
      setManualUrl('');
    } catch (err: any) {
      setProgress(null);
      setMsg(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  }

  async function fetchStep(): Promise<string | undefined> {
    const res = await authedFetch('/api/dashboard?action=status');
    const body = await res.json();
    return body?.state?.currentStep;
  }

  async function run(action: string) {
    setBusy(action);
    setMsg(null);
    setProgress(null);
    try {
      const body = await callAction(action);
      setMsg(JSON.stringify(body, null, 2));
      await load();
    } catch (err: any) {
      setMsg(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Chain: start + advance + advance ... until we land in PENDING_APPROVAL
   * (or any human-wait state). Each HTTP call stays within the 60s limit.
   */
  async function runStartChain() {
    setBusy('start-chain');
    setMsg(null);
    const responses: any[] = [];

    try {
      setProgress('Starting cycle…');
      responses.push(await callAction('start'));
      await load();

      // After start, state is GENERATING. Advance through GENERATING -> IDEAS_READY -> PENDING_APPROVAL.
      for (let i = 0; i < 6; i++) {
        const step = await fetchStep();
        if (!step || HUMAN_WAIT_STEPS.has(step)) break;
        setProgress(`Advancing from ${step}…`);
        responses.push(await callAction('advance'));
        await load();
      }
      setProgress(null);
      setMsg(JSON.stringify(responses, null, 2));
    } catch (err: any) {
      setProgress(null);
      setMsg(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Chain: repeatedly call advance until we hit a human-wait state.
   * Useful after the CEO replies (APPROVED -> REVIEWING -> PUBLISHING -> COMPLETE).
   */
  async function runAdvanceChain() {
    setBusy('advance-chain');
    setMsg(null);
    const responses: any[] = [];
    try {
      for (let i = 0; i < 8; i++) {
        const step = await fetchStep();
        if (!step || HUMAN_WAIT_STEPS.has(step)) break;
        setProgress(`Advancing from ${step}…`);
        responses.push(await callAction('advance'));
        await load();
      }
      setProgress(null);
      setMsg(JSON.stringify(responses, null, 2));
    } catch (err: any) {
      setProgress(null);
      setMsg(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <p className="hw-muted">Loading…</p>;
  const state = data.state;
  const project = data.currentProject;

  return (
    <div>
      <div className="hw-card">
        <div className="hw-card-title">Pipeline status</div>
        <div className="hw-row">
          <div className="hw-col">
            <div className="hw-field-label">Current step</div>
            <div><span className={`hw-badge ${badgeClass(state?.currentStep)}`}>{state?.currentStep ?? '—'}</span></div>
          </div>
          <div className="hw-col">
            <div className="hw-field-label">Active project</div>
            <div><strong>{project?.name ?? '—'}</strong></div>
            <div className="hw-muted hw-small">{project?.domain ?? ''}</div>
          </div>
          <div className="hw-col">
            <div className="hw-field-label">Cycle ID</div>
            <div className="hw-mono">{state?.currentCycleId ?? '—'}</div>
          </div>
          <div className="hw-col">
            <div className="hw-field-label">Last run</div>
            <div className="hw-small">{state?.lastRunAt ?? '—'}</div>
          </div>
        </div>
      </div>

      {/* Manual URL analysis card */}
      <div className="hw-card">
        <div className="hw-card-title">Analyze a website</div>
        <p className="hw-muted hw-small" style={{ margin: '0 0 12px 0' }}>
          Enter any URL and pick a project. Claude will fetch the site, audit its SEO &amp; AEO readiness,
          find keyword gaps, and generate 3 tailored content ideas. You approve one via email, then the
          full pipeline runs automatically.
        </p>
        <div className="hw-row">
          <div className="hw-col" style={{ flex: 3, minWidth: 260 }}>
            <div className="hw-field-label">Website URL</div>
            <input
              className="hw-input"
              placeholder="e.g. scrubdepot.ca or https://nursingshoes.ca/collections"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              disabled={!!busy}
            />
          </div>
          <div className="hw-col" style={{ flex: 1, minWidth: 180 }}>
            <div className="hw-field-label">Project</div>
            <select
              className="hw-select"
              value={manualProjectId}
              onChange={(e) => setManualProjectId(e.target.value)}
              disabled={!!busy}
            >
              {projectsList.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="hw-col" style={{ flex: 0, minWidth: 'auto', display: 'flex', alignItems: 'flex-end' }}>
            <button
              className="hw-btn hw-btn--primary"
              disabled={!!busy || !manualUrl.trim() || !manualProjectId}
              onClick={runManualChain}
            >
              {busy === 'manual' ? 'Analyzing…' : 'Analyze & generate ideas'}
            </button>
          </div>
        </div>
      </div>

      {/* Site analysis results (if current cycle has one) */}
      {state?.analysisData && (() => {
        const analysis = safeJson<any>(state.analysisData);
        if (!analysis) return null;
        return (
          <div className="hw-card">
            <div className="hw-card-title">Site analysis — {analysis.url ?? state.analysisUrl}</div>
            <p className="hw-small" style={{ margin: '0 0 10px 0' }}>{analysis.summary}</p>
            {analysis.current_strengths?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="hw-field-label">Strengths</div>
                <ul className="hw-small" style={{ margin: 0, paddingLeft: 18 }}>
                  {analysis.current_strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            {analysis.seo_gaps?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="hw-field-label">SEO gaps</div>
                <ul className="hw-small" style={{ margin: 0, paddingLeft: 18 }}>
                  {analysis.seo_gaps.map((s: string, i: number) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            {analysis.aeo_gaps?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="hw-field-label">AEO gaps (AI search readiness)</div>
                <ul className="hw-small" style={{ margin: 0, paddingLeft: 18 }}>
                  {analysis.aeo_gaps.map((s: string, i: number) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
        );
      })()}

      <div className="hw-toolbar">
        <button className="hw-btn hw-btn--primary" disabled={!!busy} onClick={runStartChain}>
          {busy === 'start-chain' ? 'Starting…' : 'Force start cycle'}
        </button>
        <button className="hw-btn hw-btn--secondary" disabled={!!busy} onClick={runAdvanceChain}>
          {busy === 'advance-chain' ? 'Advancing…' : 'Run to next stop'}
        </button>
        <button className="hw-btn" disabled={!!busy} onClick={() => run('advance')}>Advance one step</button>
        <button className="hw-btn" disabled={!!busy} onClick={() => run('generate-ideas')}>Generate ideas</button>
        <button className="hw-btn" disabled={!!busy} onClick={() => run('send-approval')}>Send approval email</button>
        <button className="hw-btn" disabled={!!busy} onClick={() => run('poll-approval')}>Poll approvals</button>
        <button className="hw-btn" disabled={!!busy} onClick={() => run('create')}>Create content</button>
        <button className="hw-btn" disabled={!!busy} onClick={() => run('review')}>Run review</button>
        <button className="hw-btn" disabled={!!busy} onClick={() => run('publish')}>Publish</button>
        <button className="hw-btn hw-btn--danger" disabled={!!busy} onClick={() => run('reset')}>Reset to IDLE</button>
        <button className="hw-btn hw-btn--ghost" disabled={!!busy} onClick={load}>Refresh</button>
      </div>

      {progress && <div className="hw-progress">{progress}</div>}

      {msg && <pre className="hw-log-pre">{msg}</pre>}

      {Array.isArray(data.currentIdeas) && data.currentIdeas.length > 0 && (
        <div className="hw-card">
          <div className="hw-card-title">Ideas for current cycle</div>
          <table className="hw-table">
            <thead>
              <tr><th>#</th><th>Title</th><th>Keyword</th><th>Selected</th></tr>
            </thead>
            <tbody>
              {data.currentIdeas.map((i: any) => (
                <tr key={i.id}>
                  <td>{i.optionNumber}</td>
                  <td>{i.title}<div className="hw-muted hw-small">{i.pitch}</div></td>
                  <td>{i.targetKeyword}</td>
                  <td>{i.isSelected ? <span className="hw-badge hw-badge--green">selected</span> : <span className="hw-badge hw-badge--gray">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {Array.isArray(data.currentDrafts) && data.currentDrafts.length > 0 && (
        <div className="hw-card">
          <div className="hw-card-title">Drafts in flight</div>
          {data.currentDrafts.map((d: any) => (
            <DraftViewer key={d.id} draft={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftViewer({ draft }: { draft: any }) {
  const [open, setOpen] = useState(false);

  const images = safeJson<any[]>(draft.images) ?? [];
  const feedback = safeJson<any>(draft.reviewFeedback);
  const review = feedback?.review ?? feedback?.based_on_review ?? null;
  const decisions: any[] = Array.isArray(feedback?.decisions) ? feedback.decisions : [];

  return (
    <div style={{ marginBottom: 18, borderBottom: '1px solid #eee', paddingBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <strong>{draft.title || '(untitled)'}</strong>
          <div className="hw-muted hw-small">
            v{draft.version} · {draft.status} · score {draft.reviewScore ?? '—'}
            {images.length > 0 && <> · {images.length} image{images.length === 1 ? '' : 's'}</>}
            {decisions.length > 0 && <> · {decisions.length} review decision{decisions.length === 1 ? '' : 's'}</>}
          </div>
        </div>
        <button className="hw-btn hw-btn--ghost" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'View'}</button>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          <div className="hw-field-label">Meta description</div>
          <p className="hw-small">{draft.metaDescription}</p>

          <div className="hw-field-label">Body</div>
          <div className="hw-draft-body" dangerouslySetInnerHTML={{ __html: draft.bodyHtml ?? '' }} />

          <div className="hw-field-label" style={{ marginTop: 12 }}>LinkedIn</div>
          <div className="hw-social-block">{draft.socialLinkedin}</div>
          <div className="hw-field-label" style={{ marginTop: 12 }}>Twitter</div>
          <div className="hw-social-block">{draft.socialTwitter}</div>
          <div className="hw-field-label" style={{ marginTop: 12 }}>Facebook</div>
          <div className="hw-social-block">{draft.socialFacebook}</div>
          <div className="hw-field-label" style={{ marginTop: 12 }}>Instagram</div>
          <div className="hw-social-block">{draft.socialInstagram}</div>

          {images.length > 0 && (
            <>
              <div className="hw-field-label" style={{ marginTop: 12 }}>Images ({images.length})</div>
              <div className="hw-card" style={{ padding: 12, margin: 0 }}>
                {images.map((img: any, idx: number) => (
                  <div key={idx} style={{ marginBottom: 6 }} className="hw-small">
                    <span className="hw-mono">{img.query}</span> —{' '}
                    <a href={img.unsplashUrl} target="_blank" rel="noreferrer">photo</a>
                    {' by '}
                    <a href={img.photographerUrl} target="_blank" rel="noreferrer">{img.photographerName}</a>
                  </div>
                ))}
              </div>
            </>
          )}

          {decisions.length > 0 && (
            <>
              <div className="hw-field-label" style={{ marginTop: 12 }}>Revision decisions (Claude vs GPT suggestions)</div>
              <div className="hw-card" style={{ padding: 14, margin: 0 }}>
                {decisions.map((d: any, idx: number) => (
                  <div key={idx} style={{ marginBottom: 12 }}>
                    <span className={`hw-badge ${verdictBadge(d.verdict)}`}>{d.verdict}</span>{' '}
                    <span className="hw-small"><strong>Suggestion:</strong> {d.suggestion}</span>
                    <div className="hw-muted hw-small" style={{ marginTop: 3 }}>
                      <em>{d.reasoning}</em>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {review && (
            <>
              <div className="hw-field-label" style={{ marginTop: 12 }}>GPT review</div>
              <pre className="hw-log-pre">{JSON.stringify(review, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function safeJson<T>(raw: unknown): T | null {
  if (typeof raw !== 'string' || !raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function verdictBadge(verdict: string | undefined): string {
  switch (verdict) {
    case 'accept': return 'hw-badge--green';
    case 'modify': return 'hw-badge--yellow';
    case 'reject': return 'hw-badge--gray';
    default: return 'hw-badge--gray';
  }
}

function badgeClass(step: string | undefined): string {
  switch (step) {
    case 'COMPLETE':
    case 'APPROVED':
      return 'hw-badge--green';
    case 'PENDING_APPROVAL':
      return 'hw-badge--yellow';
    case 'GENERATING':
    case 'IDEAS_READY':
    case 'REVIEWING':
      return 'hw-badge--orange';
    case 'PUBLISHING':
    case 'CREATING':
      return 'hw-badge--blue';
    case 'IDLE':
      return 'hw-badge--blue';
    case 'EXPIRED':
    case 'FAILED':
      return 'hw-badge--red';
    default:
      return 'hw-badge--gray';
  }
}

/* ------------------------ History ------------------------ */

function HistoryTab({ authedFetch }: { authedFetch: (u: string, i?: RequestInit) => Promise<Response> }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const res = await authedFetch('/api/dashboard?action=history');
      setData(await res.json());
    })();
  }, [authedFetch]);

  if (!data) return <p className="hw-muted">Loading…</p>;

  return (
    <div>
      {data.cycles?.length === 0 && <p className="hw-muted">No cycles yet.</p>}
      {data.cycles?.map((c: any) => (
        <div className="hw-card" key={c.approval.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong>{c.project?.name ?? 'Unknown project'}</strong>{' '}
              <span className={`hw-badge ${c.approval.status === 'replied' ? 'hw-badge--green' : c.approval.status === 'expired' ? 'hw-badge--red' : 'hw-badge--yellow'}`}>
                {c.approval.status}
              </span>
            </div>
            <div className="hw-muted hw-small">{c.approval.sentAt}</div>
          </div>
          <div className="hw-muted hw-small" style={{ marginTop: 6 }}>Cycle: <span className="hw-mono">{c.approval.cycleId}</span></div>
          <div style={{ marginTop: 10 }}>
            {c.ideas?.map((i: any) => (
              <div key={i.id} className="hw-small" style={{ marginBottom: 3 }}>
                <span className="hw-mono">#{i.optionNumber}</span>{' '}
                {i.isSelected ? <strong>{i.title}</strong> : i.title}
                {i.isSelected ? <span className="hw-badge hw-badge--green" style={{ marginLeft: 6 }}>chosen</span> : null}
              </div>
            ))}
          </div>
          {c.drafts?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="hw-muted hw-small">Drafts: {c.drafts.length} (latest v{c.drafts[0].version}, {c.drafts[0].status})</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------ Projects ------------------------ */

function ProjectsTab({ authedFetch }: { authedFetch: (u: string, i?: RequestInit) => Promise<Response> }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);

  const load = useCallback(async () => {
    const res = await authedFetch('/api/projects?action=list');
    const body = await res.json();
    setProjects(body.projects ?? []);
  }, [authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(p: any) {
    const isNew = !p.id;
    const body: any = {
      name: p.name,
      domain: p.domain,
      rotationOrder: Number(p.rotationOrder),
      platforms: p.platforms,
      config: p.config,
      isActive: p.isActive !== 0,
    };
    if (!isNew) body.id = p.id;
    await authedFetch(`/api/projects?action=${isNew ? 'create' : 'update'}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setEditing(null);
    load();
  }

  async function remove(id: string) {
    if (!confirm('Remove this project from rotation?')) return;
    await authedFetch('/api/projects?action=delete', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    load();
  }

  return (
    <div>
      <div className="hw-toolbar">
        <button className="hw-btn hw-btn--primary" onClick={() => setEditing({
          name: '',
          domain: '',
          rotationOrder: (projects[projects.length - 1]?.rotationOrder ?? 0) + 1,
          platforms: [],
          config: { industry: '', voice: '', keywords: [] },
          isActive: 1,
        })}>Add project</button>
      </div>

      <div className="hw-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="hw-table">
          <thead>
            <tr><th>Order</th><th>Name</th><th>Domain</th><th>Platforms</th><th>Active</th><th></th></tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>{p.rotationOrder}</td>
                <td><strong>{p.name}</strong></td>
                <td className="hw-mono">{p.domain}</td>
                <td className="hw-small">{JSON.parse(p.platforms || '[]').join(', ')}</td>
                <td>
                  {p.isActive
                    ? <span className="hw-badge hw-badge--green">yes</span>
                    : <span className="hw-badge hw-badge--gray">no</span>}
                </td>
                <td>
                  <button className="hw-btn hw-btn--ghost" onClick={() => setEditing({
                    ...p,
                    platforms: JSON.parse(p.platforms || '[]'),
                    config: JSON.parse(p.config || '{}'),
                  })}>Edit</button>{' '}
                  <button className="hw-btn hw-btn--danger" onClick={() => remove(p.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <ProjectEditor value={editing} onSave={save} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function ProjectEditor({ value, onSave, onCancel }: { value: any; onSave: (v: any) => void; onCancel: () => void }) {
  const [v, setV] = useState<any>(value);
  const update = (k: string, x: any) => setV({ ...v, [k]: x });
  const updateConfig = (k: string, x: any) => setV({ ...v, config: { ...v.config, [k]: x } });

  return (
    <div className="hw-card" style={{ marginTop: 20 }}>
      <div className="hw-card-title">{v.id ? 'Edit project' : 'New project'}</div>
      <div className="hw-row">
        <div className="hw-col">
          <div className="hw-field-label">Name</div>
          <input className="hw-input" value={v.name ?? ''} onChange={(e) => update('name', e.target.value)} />
        </div>
        <div className="hw-col">
          <div className="hw-field-label">Domain</div>
          <input className="hw-input" value={v.domain ?? ''} onChange={(e) => update('domain', e.target.value)} />
        </div>
        <div className="hw-col">
          <div className="hw-field-label">Rotation order</div>
          <input className="hw-input" type="number" value={v.rotationOrder ?? 0} onChange={(e) => update('rotationOrder', e.target.value)} />
        </div>
        <div className="hw-col">
          <div className="hw-field-label">Active</div>
          <select className="hw-select" value={v.isActive ? '1' : '0'} onChange={(e) => update('isActive', e.target.value === '1' ? 1 : 0)}>
            <option value="1">yes</option>
            <option value="0">no</option>
          </select>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="hw-field-label">Platforms (comma separated: blog, linkedin, twitter, facebook, instagram)</div>
        <input
          className="hw-input"
          value={(v.platforms ?? []).join(', ')}
          onChange={(e) => update('platforms', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
        />
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="hw-field-label">Industry</div>
        <input className="hw-input" value={v.config?.industry ?? ''} onChange={(e) => updateConfig('industry', e.target.value)} />
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="hw-field-label">Voice</div>
        <input className="hw-input" value={v.config?.voice ?? ''} onChange={(e) => updateConfig('voice', e.target.value)} />
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="hw-field-label">Keywords (comma separated)</div>
        <input
          className="hw-input"
          value={(v.config?.keywords ?? []).join(', ')}
          onChange={(e) => updateConfig('keywords', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
        />
      </div>
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="hw-btn hw-btn--primary" onClick={() => onSave(v)}>Save</button>
        <button className="hw-btn hw-btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ------------------------ Logs ------------------------ */

function LogsTab({ authedFetch }: { authedFetch: (u: string, i?: RequestInit) => Promise<Response> }) {
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const res = await authedFetch('/api/dashboard?action=logs');
      const body = await res.json();
      setLogs(body.logs ?? []);
    })();
  }, [authedFetch]);

  return (
    <div className="hw-card" style={{ padding: 0, overflow: 'hidden' }}>
      <table className="hw-table">
        <thead>
          <tr><th style={{ width: 180 }}>Time</th><th style={{ width: 220 }}>Action</th><th>Cycle</th><th>Details</th></tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td className="hw-small hw-mono">{l.createdAt}</td>
              <td><span className={`hw-badge ${logActionBadge(l.action)}`}>{l.action}</span></td>
              <td className="hw-mono hw-small">{l.cycleId ?? '—'}</td>
              <td className="hw-mono hw-small" style={{ wordBreak: 'break-word' }}>{l.details}</td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr><td colSpan={4} className="hw-muted" style={{ textAlign: 'center', padding: 20 }}>No activity yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function logActionBadge(action: string): string {
  if (/error|expired|failed/i.test(action)) return 'hw-badge--red';
  if (/complete|approved|received|published/i.test(action)) return 'hw-badge--green';
  if (/revised|reviewed|revision/i.test(action)) return 'hw-badge--orange';
  if (/sent|email|approval/i.test(action)) return 'hw-badge--yellow';
  if (/started|created|generated|reset/i.test(action)) return 'hw-badge--blue';
  return 'hw-badge--gray';
}
