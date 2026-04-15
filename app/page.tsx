'use client';

import { useEffect, useState, useCallback } from 'react';

type TabKey = 'status' | 'history' | 'projects' | 'logs';

const STORAGE_KEY = 'hemingway_password';

export default function HomePage() {
  const [password, setPassword] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) setPassword(stored);
  }, []);

  if (!password) {
    return <Login onAuth={(pw) => setPassword(pw)} />;
  }
  return <Dashboard password={password} onLogout={() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setPassword(null);
  }} />;
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
    <div className="page">
      <form className="login" onSubmit={submit}>
        <h2>Hemingway</h2>
        <p className="muted small">Content agent for The Web Guys.</p>
        <input
          type="password"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
        />
        <div style={{ marginTop: 10 }}>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Enter'}
          </button>
        </div>
        {err && <p style={{ color: '#c0392b' }} className="small">{err}</p>}
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
    <div className="page">
      <div className="header">
        <div className="brand">
          <div className="brand-name">Hemingway</div>
          <div className="brand-tag">Content agent for The Web Guys</div>
        </div>
        <button onClick={onLogout}>Log out</button>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'status' ? 'active' : ''}`} onClick={() => setTab('status')}>Status</button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>History</button>
        <button className={`tab ${tab === 'projects' ? 'active' : ''}`} onClick={() => setTab('projects')}>Projects</button>
        <button className={`tab ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>Logs</button>
      </div>

      {tab === 'status' && <StatusTab authedFetch={authedFetch} />}
      {tab === 'history' && <HistoryTab authedFetch={authedFetch} />}
      {tab === 'projects' && <ProjectsTab authedFetch={authedFetch} />}
      {tab === 'logs' && <LogsTab authedFetch={authedFetch} />}
    </div>
  );
}

/* ------------------------ Status ------------------------ */

function StatusTab({ authedFetch }: { authedFetch: (u: string, i?: RequestInit) => Promise<Response> }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await authedFetch('/api/dashboard?action=status');
    setData(await res.json());
  }, [authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: string) {
    setBusy(action);
    setMsg(null);
    try {
      const res = await authedFetch(`/api/pipeline?action=${action}`, { method: 'POST' });
      const body = await res.json();
      setMsg(JSON.stringify(body, null, 2));
      await load();
    } catch (err: any) {
      setMsg(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <p>Loading…</p>;
  const state = data.state;
  const project = data.currentProject;

  return (
    <div>
      <div className="card">
        <div className="row">
          <div>
            <div className="muted small">Current step</div>
            <div><span className={`badge ${badgeClass(state?.currentStep)}`}>{state?.currentStep ?? '—'}</span></div>
          </div>
          <div>
            <div className="muted small">Active project</div>
            <div><strong>{project?.name ?? '—'}</strong></div>
            <div className="muted small">{project?.domain ?? ''}</div>
          </div>
          <div>
            <div className="muted small">Cycle ID</div>
            <div className="mono">{state?.currentCycleId ?? '—'}</div>
          </div>
          <div>
            <div className="muted small">Last run</div>
            <div className="small">{state?.lastRunAt ?? '—'}</div>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <button className="primary" disabled={!!busy} onClick={() => run('advance')}>
          {busy === 'advance' ? 'Running…' : 'Advance pipeline'}
        </button>
        <button disabled={!!busy} onClick={() => run('start')}>Force start cycle</button>
        <button disabled={!!busy} onClick={() => run('poll-approval')}>Poll approvals</button>
        <button disabled={!!busy} onClick={() => run('create')}>Create content</button>
        <button disabled={!!busy} onClick={() => run('review')}>Run review</button>
        <button disabled={!!busy} onClick={() => run('publish')}>Publish</button>
        <button disabled={!!busy} onClick={() => run('reset')}>Reset to IDLE</button>
        <button disabled={!!busy} onClick={load}>Refresh</button>
      </div>

      {msg && <pre className="card mono" style={{ whiteSpace: 'pre-wrap' }}>{msg}</pre>}

      {Array.isArray(data.currentIdeas) && data.currentIdeas.length > 0 && (
        <div className="card">
          <h3>Ideas for current cycle</h3>
          <table>
            <thead>
              <tr><th>#</th><th>Title</th><th>Keyword</th><th>Selected</th></tr>
            </thead>
            <tbody>
              {data.currentIdeas.map((i: any) => (
                <tr key={i.id}>
                  <td>{i.optionNumber}</td>
                  <td>{i.title}<div className="muted small">{i.pitch}</div></td>
                  <td>{i.targetKeyword}</td>
                  <td>{i.isSelected ? <span className="badge green">selected</span> : <span className="badge gray">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {Array.isArray(data.currentDrafts) && data.currentDrafts.length > 0 && (
        <div className="card">
          <h3>Drafts in flight</h3>
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
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <strong>{draft.title || '(untitled)'}</strong>
          <div className="muted small">v{draft.version} · {draft.status} · score {draft.reviewScore ?? '—'}</div>
        </div>
        <button onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'View'}</button>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div className="small muted">Meta description</div>
          <p>{draft.metaDescription}</p>
          <div className="small muted">Body</div>
          <div className="draft-body" dangerouslySetInnerHTML={{ __html: draft.bodyHtml ?? '' }} />
          <div className="small muted" style={{ marginTop: 10 }}>LinkedIn</div>
          <div className="social-block">{draft.socialLinkedin}</div>
          <div className="small muted" style={{ marginTop: 10 }}>Twitter</div>
          <div className="social-block">{draft.socialTwitter}</div>
          <div className="small muted" style={{ marginTop: 10 }}>Facebook</div>
          <div className="social-block">{draft.socialFacebook}</div>
          <div className="small muted" style={{ marginTop: 10 }}>Instagram</div>
          <div className="social-block">{draft.socialInstagram}</div>
          {draft.reviewFeedback && (
            <>
              <div className="small muted" style={{ marginTop: 10 }}>Review feedback</div>
              <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{draft.reviewFeedback}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function badgeClass(step: string | undefined): string {
  switch (step) {
    case 'COMPLETE': return 'green';
    case 'PENDING_APPROVAL': return 'yellow';
    case 'PUBLISHING': return 'blue';
    case 'REVIEWING': return 'blue';
    case 'EXPIRED':
    case 'FAILED': return 'red';
    default: return 'gray';
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

  if (!data) return <p>Loading…</p>;

  return (
    <div>
      {data.cycles?.length === 0 && <p className="muted">No cycles yet.</p>}
      {data.cycles?.map((c: any) => (
        <div className="card" key={c.approval.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <strong>{c.project?.name ?? 'Unknown project'}</strong>{' '}
              <span className={`badge ${c.approval.status === 'replied' ? 'green' : c.approval.status === 'expired' ? 'red' : 'yellow'}`}>
                {c.approval.status}
              </span>
            </div>
            <div className="muted small">{c.approval.sentAt}</div>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>Cycle: {c.approval.cycleId}</div>
          <div style={{ marginTop: 10 }}>
            {c.ideas?.map((i: any) => (
              <div key={i.id} className="small">
                <span className="mono">#{i.optionNumber}</span>{' '}
                {i.isSelected ? <strong>{i.title}</strong> : i.title}
                {i.isSelected ? <span className="badge green" style={{ marginLeft: 6 }}>chosen</span> : null}
              </div>
            ))}
          </div>
          {c.drafts?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="muted small">Drafts: {c.drafts.length} (latest v{c.drafts[0].version}, {c.drafts[0].status})</div>
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
      <div className="toolbar">
        <button className="primary" onClick={() => setEditing({
          name: '',
          domain: '',
          rotationOrder: (projects[projects.length - 1]?.rotationOrder ?? 0) + 1,
          platforms: [],
          config: { industry: '', voice: '', keywords: [] },
          isActive: 1,
        })}>Add project</button>
      </div>

      <table>
        <thead>
          <tr><th>Order</th><th>Name</th><th>Domain</th><th>Platforms</th><th>Active</th><th></th></tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td>{p.rotationOrder}</td>
              <td>{p.name}</td>
              <td>{p.domain}</td>
              <td>{JSON.parse(p.platforms || '[]').join(', ')}</td>
              <td>{p.isActive ? 'yes' : 'no'}</td>
              <td>
                <button onClick={() => setEditing({
                  ...p,
                  platforms: JSON.parse(p.platforms || '[]'),
                  config: JSON.parse(p.config || '{}'),
                })}>Edit</button>{' '}
                <button onClick={() => remove(p.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && <ProjectEditor value={editing} onSave={save} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function ProjectEditor({ value, onSave, onCancel }: { value: any; onSave: (v: any) => void; onCancel: () => void }) {
  const [v, setV] = useState<any>(value);
  const update = (k: string, x: any) => setV({ ...v, [k]: x });
  const updateConfig = (k: string, x: any) => setV({ ...v, config: { ...v.config, [k]: x } });

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3>{v.id ? 'Edit project' : 'New project'}</h3>
      <div className="row">
        <div>
          <div className="small muted">Name</div>
          <input value={v.name ?? ''} onChange={(e) => update('name', e.target.value)} />
        </div>
        <div>
          <div className="small muted">Domain</div>
          <input value={v.domain ?? ''} onChange={(e) => update('domain', e.target.value)} />
        </div>
        <div>
          <div className="small muted">Rotation order</div>
          <input type="number" value={v.rotationOrder ?? 0} onChange={(e) => update('rotationOrder', e.target.value)} />
        </div>
        <div>
          <div className="small muted">Active</div>
          <select value={v.isActive ? '1' : '0'} onChange={(e) => update('isActive', e.target.value === '1' ? 1 : 0)}>
            <option value="1">yes</option>
            <option value="0">no</option>
          </select>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="small muted">Platforms (comma separated: blog, linkedin, twitter, facebook, instagram)</div>
        <input
          value={(v.platforms ?? []).join(', ')}
          onChange={(e) => update('platforms', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
        />
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="small muted">Industry</div>
        <input value={v.config?.industry ?? ''} onChange={(e) => updateConfig('industry', e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="small muted">Voice</div>
        <input value={v.config?.voice ?? ''} onChange={(e) => updateConfig('voice', e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="small muted">Keywords (comma separated)</div>
        <input
          value={(v.config?.keywords ?? []).join(', ')}
          onChange={(e) => updateConfig('keywords', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
        />
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button className="primary" onClick={() => onSave(v)}>Save</button>
        <button onClick={onCancel}>Cancel</button>
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
    <div>
      <table>
        <thead>
          <tr><th>Time</th><th>Action</th><th>Cycle</th><th>Details</th></tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td className="small">{l.createdAt}</td>
              <td><span className="badge gray">{l.action}</span></td>
              <td className="mono small">{l.cycleId ?? '—'}</td>
              <td className="mono small">{l.details}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
