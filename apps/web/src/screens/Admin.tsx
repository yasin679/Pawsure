/**
 * Operations console (/admin). Staff sign in with OTP; the server decides what each role can open and logs every view.
 * The section list below only mirrors the server matrix so staff aren't shown doors they can't open.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, session } from '../api';
import { Icon } from '../ui';

type Section = 'overview' | 'service' | 'release' | 'queues' | 'households' | 'mix' | 'signals' | 'ff' | 'flags' | 'rewards' | 'rights' | 'audit' | 'breach';
const SECTIONS: [Section, string, string][] = [['overview', 'Pilot overview', 'home'], ['service', 'Service health', 'bell'], ['release', 'Pilot readiness', 'check'], ['queues', 'Queues', 'bell'], ['households', 'Households', 'paw'], ['mix', 'Method mix', 'list'], ['signals', 'Signals', 'check'], ['ff', 'Friend Finder', 'friends'], ['flags', 'Switches', 'shield'], ['rewards', 'Rewards holds', 'star'], ['rights', 'Rights requests', 'user'], ['audit', 'Audit log', 'card'], ['breach', 'Breach runbook', 'alert']];
const ROLE_SECTIONS: Record<string, Section[]> = {
  ops: ['overview', 'service', 'queues', 'households', 'mix', 'signals', 'ff'],
  ops_lead: ['overview', 'service', 'release', 'queues', 'households', 'mix', 'signals', 'ff', 'flags', 'rewards', 'audit', 'breach'],
  privacy_lead: ['overview', 'service', 'release', 'households', 'mix', 'signals', 'flags', 'rights', 'audit', 'breach'],
  tech_lead: ['overview', 'service', 'release', 'queues', 'mix', 'signals', 'ff', 'flags', 'audit', 'breach'],
  auditor: ['overview', 'service', 'queues', 'mix', 'signals', 'audit']
};
const ROLE_LABEL: Record<string, string> = { ops: 'Ops on shift', ops_lead: 'Ops lead', privacy_lead: 'Privacy lead', tech_lead: 'Tech lead', auditor: 'Auditor' };
const when = (s: string) => new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function AdminApp() {
  const [role, setRole] = useState<string | null>(null); const [checked, setChecked] = useState(false);
  const [sec, setSec] = useState<Section>('overview');
  const check = () => api<{ role: string }>('/admin/me').then(r => setRole(r.role)).catch(() => setRole(null)).finally(() => setChecked(true));
  useEffect(() => { if (session.get()) check(); else setChecked(true); }, []);
  const signOut = () => { session.set(null); setRole(null); };
  if (!checked) return <div className="console-shell"><div className="empty">Loading…</div></div>;
  if (!role) return <StaffSignIn onDone={check} notStaff={!!session.get()} onSignOut={signOut} />;
  const allowed = ROLE_SECTIONS[role] ?? [];
  return <div className="console">
    <aside className="console-nav" aria-label="Console sections">
      <div className="console-brand"><b>Pawsure</b> <span className="tag">Ops console</span></div>
      <div className="small muted" style={{ padding: '0 10px 8px' }}>{ROLE_LABEL[role]} · every view is logged</div>
      {SECTIONS.filter(([k]) => allowed.includes(k)).map(([k, l, i]) => <button key={k} aria-current={sec === k ? 'page' : 'false'} onClick={() => setSec(k)}><Icon name={i} size={18} />{l}</button>)}
      {location.hash === '#admin' && <button onClick={() => { location.hash = ''; }}>Back to the owner app</button>}
      <button onClick={signOut} className="console-out">Sign out</button>
    </aside>
    <main className="console-main">
      {sec === 'overview' && <Overview />}{sec === 'service' && <Service />}{sec === 'release' && <Release role={role} />}{sec === 'queues' && <Queues role={role} />}{sec === 'households' && <Households />}
      {sec === 'mix' && <MethodMix />}{sec === 'signals' && <Signals />}{sec === 'ff' && <FF />}{sec === 'flags' && <Flags role={role} />}
      {sec === 'rewards' && <Rewards />}{sec === 'rights' && <Rights />}{sec === 'audit' && <Audit role={role} />}{sec === 'breach' && <Breach role={role} />}
    </main>
  </div>;
}

function StaffSignIn({ onDone, notStaff, onSignOut }: { onDone: () => void; notStaff: boolean; onSignOut: () => void }) {
  const [phone, setPhone] = useState(''); const [code, setCode] = useState(''); const [sent, setSent] = useState(false); const [demo, setDemo] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const e164 = '+91' + phone.replace(/\D/g, '');
  return <div className="console-shell"><div className="card" style={{ maxWidth: 420, width: '100%' }}>
    <span className="eyebrow">Pawsure operations</span><h2>Staff sign-in</h2>
    {notStaff && <div className="card warn small">This account has no staff role. <button className="btn ghost sm" onClick={onSignOut}>Use another number</button></div>}
    {!sent ? <><div className="field"><label htmlFor="sp">Staff mobile</label><div className="row"><span className="tag">+91</span><input id="sp" className="input mono" inputMode="numeric" maxLength={10} value={phone} onChange={e => setPhone(e.target.value)} /></div></div>
      <button className="btn primary block" onClick={async () => { setErr(null); try { const r = await api<{ demoCode?: string }>('/auth/otp/request', { body: { phone: e164 }, auth: false }); setDemo(r.demoCode ?? null); setSent(true); } catch { setErr('Check the number.'); } }}>Send code</button></>
      : <><div className="field"><label htmlFor="sc">6-digit code</label><input id="sc" className="input mono" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value)} />{demo && <span className="xs muted">Demo code: <span className="mono">{demo}</span></span>}</div>
        <button className="btn primary block" onClick={async () => { setErr(null); try { const r = await api<{ token: string; userId: string }>('/auth/otp/verify', { body: { phone: e164, code }, auth: false }); session.set({ token: r.token, userId: r.userId }); onDone(); } catch { setErr('That code doesn’t match.'); } }}>Sign in</button></>}
    {err && <span className="errtext" role="alert">{err}</span>}
    {location.hash === '#admin' && <button className="btn ghost sm" onClick={() => { location.hash = ''; }}>Back to the owner app</button>}
    <p className="xs muted">Demo staff: ops 98110 00001 · ops lead 98110 00002 · privacy lead 98110 00003 · auditor 98110 00004</p>
  </div></div>;
}

/** Fetch helper that turns a 403 into the server's own explanation. */
function useLoad<T>(path: string): [T | null, string | null, () => void] {
  const [d, setD] = useState<T | null>(null); const [e, setE] = useState<string | null>(null); const [n, setN] = useState(0);
  useEffect(() => { api<T>(path).then(x => { setD(x); setE(null); }).catch(err => setE(err instanceof ApiError && err.status === 403 ? String(err.body.note ?? 'Your role can’t open this.') : 'Can’t reach Pawsure.')); }, [path, n]);
  return [d, e, () => setN(x => x + 1)];
}
const Head = ({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) => <header className="console-head"><div className="grow"><h1>{title}</h1>{sub && <p className="small muted">{sub}</p>}</div>{right}</header>;
const Err = ({ e }: { e: string | null }) => e ? <div className="card danger" role="alert">{e}</div> : null;

function Overview() {
  const [o, e] = useLoad<{ note: string; households: number; staffedHours: string; noEmergencyPromise: string; metrics: { label: string; value: number | null; n: number; target: string; status: string }[] }>('/admin/overview');
  return <><Head title="Pilot overview" sub={o?.note} /><Err e={e} />
    {o && <><div className="console-kpis">{o.metrics.map(m => <div key={m.label} className="card"><span className="eyebrow">{m.label}</span><div className="row"><b className="kpi">{m.value == null ? '—' : m.value + '%'}</b><span className={`tag ${m.status === 'on track' ? 'flag-on' : m.status === 'below' ? 'flag-off' : ''}`}>{m.status}</span></div><div className="xs muted">n = {m.n} · target {m.target}</div></div>)}</div>
      <div className="card flat small"><div><b>{o.households}</b> pilot households · staffed {o.staffedHours}</div><div className="muted">{o.noEmergencyPromise}</div></div></>}
  </>;
}

function Queues({ role }: { role: string }) {
  const [q, e, reload] = useLoad<{ cases: { id: string; household_id: string | null; kind: string; title: string; severity: string | null; state: string; created_at: string; notes: string[] }[]; escalations: { household: string; task: string; state: string; acknowledged: boolean; stepsSent: number }[]; incidents: { id: string; household_id: string; severity: string; category: string; reported_at: string; ack_at: string | null }[]; targets: Record<string, string> }>('/admin/queues');
  const [closing, setClosing] = useState<string | null>(null); const [note, setNote] = useState(''); const [err, setErr] = useState<string | null>(null);
  const canAct = role === 'ops' || role === 'ops_lead';
  const act = async (id: string, action: string, n?: string) => { setErr(null); try { await api(`/admin/cases/${id}`, { body: { action, note: n } }); setClosing(null); setNote(''); reload(); } catch (x) { setErr(x instanceof ApiError && x.body.error === 'reason_required' ? 'Write a short reason (5+ characters) to close.' : 'Couldn’t update.'); } };
  return <><Head title="Queues" sub={q ? Object.entries(q.targets).map(([k, v]) => `${k}: ${v}`).join(' · ') : undefined} /><Err e={e} />
    {q && <>
      <h2 className="console-h2">Open incidents ({q.incidents.length})</h2>
      {q.incidents.length === 0 ? <div className="empty small">None open.</div> : <table className="tbl"><thead><tr><th>Severity</th><th>Category</th><th>Household</th><th>Reported</th><th>Acknowledged</th></tr></thead><tbody>{q.incidents.map(i => <tr key={i.id}><td><span className={`tag ${i.severity === 'S1' ? 'flag-off' : ''}`}>{i.severity}</span></td><td>{i.category.replace(/_/g, ' ')}</td><td className="mono">{i.household_id}</td><td>{when(i.reported_at)}</td><td>{i.ack_at ? when(i.ack_at) : 'Not yet'}</td></tr>)}</tbody></table>}
      <h2 className="console-h2">Escalations today ({q.escalations.length})</h2>
      {q.escalations.length === 0 ? <div className="empty small">No open escalations.</div> : <table className="tbl"><thead><tr><th>Household</th><th>Task</th><th>Evidence</th><th>Steps sent</th><th>Owner on it</th></tr></thead><tbody>{q.escalations.map((x, i) => <tr key={i}><td className="mono">{x.household}</td><td>{x.task}</td><td>{x.state}</td><td>{x.stepsSent}</td><td>{x.acknowledged ? 'Yes' : 'No'}</td></tr>)}</tbody></table>}
      <h2 className="console-h2">Cases</h2>{err && <span className="errtext" role="alert">{err}</span>}
      <table className="tbl"><thead><tr><th>Case</th><th>Kind</th><th>Opened</th><th>State</th><th></th></tr></thead><tbody>{q.cases.map(c => <tr key={c.id}><td><b>{c.title}</b>{c.notes.length > 0 && <div className="xs muted">{c.notes.at(-1)}</div>}{closing === c.id && <div className="row" style={{ marginTop: 6 }}><input className="input" placeholder="Reason for closing" value={note} onChange={x => setNote(x.target.value)} /><button className="btn sm primary" onClick={() => act(c.id, 'close', note)}>Close</button></div>}</td><td>{c.kind}{c.severity ? ' · ' + c.severity : ''}</td><td>{when(c.created_at)}</td><td><span className={`tag ${c.state === 'closed' ? 'flag-on' : ''}`}>{c.state}</span></td>
        <td>{canAct && c.state !== 'closed' && <div className="row"><button className="btn sm" onClick={() => act(c.id, 'assign', 'Taken by ' + ROLE_LABEL[role])}>Take</button><button className="btn sm" onClick={() => setClosing(closing === c.id ? null : c.id)}>Close…</button></div>}</td></tr>)}</tbody></table>
    </>}
  </>;
}

function Households() {
  const [h, e] = useLoad<{ id: string; society: string; cohort: string; rewardsArm: string; gateApp: boolean; helperMethod: string; today: string; ownerPhone: string }[]>('/admin/households');
  return <><Head title="Households" sub="Phone numbers are masked. Addresses, photos and pet details are not shown here." /><Err e={e} />
    {h && <table className="tbl"><thead><tr><th>Household</th><th>Society</th><th>Cohort</th><th>Rewards</th><th>Gate app</th><th>Helper method</th><th>Today</th><th>Owner</th></tr></thead><tbody>{h.map(x => <tr key={x.id}><td className="mono">{x.id}</td><td>{x.society}</td><td>{x.cohort}</td><td>{x.rewardsArm}</td><td>{x.gateApp ? 'Yes' : 'No'}</td><td>{x.helperMethod}</td><td>{x.today}</td><td className="mono">{x.ownerPhone}</td></tr>)}</tbody></table>}
  </>;
}

type Cut = { group: string; n: number | null; value?: number | null; suppressed: boolean };
const CutTable = ({ title, rows, pct }: { title: string; rows: Cut[]; pct?: boolean }) => <div className="card"><span className="eyebrow">{title}</span>
  {rows.length === 0 ? <div className="small muted">No data yet.</div> : <table className="tbl"><tbody>{rows.map(r => <tr key={r.group}><td>{r.group}</td><td className="mono">{r.suppressed ? <span className="muted">fewer than 5 — hidden</span> : pct ? `${r.value}% (n=${r.n})` : r.n}</td></tr>)}</tbody></table>}</div>;
function MethodMix() {
  const [m, e] = useLoad<{ note: string; consentGiven: number; helpersInvited: number; helpersByMethod: Cut[]; helpersByLanguage: Cut[]; confirmedLikelyBy: Record<string, Cut[]> }>('/admin/method-mix');
  return <><Head title="Method mix" sub={m?.note} /><Err e={e} />
    {m && <div className="console-grid">
      <CutTable title="Helpers by check-in method" rows={m.helpersByMethod} /><CutTable title="Helpers by language" rows={m.helpersByLanguage} />
      <CutTable title="Confirmed or Likely, by method" rows={m.confirmedLikelyBy.method ?? []} pct /><CutTable title="Confirmed or Likely, by language" rows={m.confirmedLikelyBy.language ?? []} pct />
      <CutTable title="Confirmed or Likely, gate app vs none" rows={m.confirmedLikelyBy.gateApp ?? []} pct />
    </div>}
  </>;
}

function Signals() {
  const [s, e] = useLoad<{ ruleSet: string; distribution: Record<string, number>; events: { at: string; action: string; household_id: string | null }[] }>('/admin/signals');
  return <><Head title="Signals" sub={s ? `Rule set ${s.ruleSet}. Today’s task states across all households.` : undefined} /><Err e={e} />
    {s && <><div className="console-kpis">{Object.entries(s.distribution).map(([k, v]) => <div key={k} className="card"><span className="eyebrow">{k}</span><b className="kpi">{v}</b></div>)}</div>
      <table className="tbl"><thead><tr><th>When</th><th>Event</th><th>Household</th></tr></thead><tbody>{s.events.map((x, i) => <tr key={i}><td>{when(x.at)}</td><td className="mono">{x.action}</td><td className="mono">{x.household_id ?? '—'}</td></tr>)}</tbody></table></>}
  </>;
}

function FF() {
  const [f, e] = useLoad<{ counts: Record<string, number>; stuck: { id: string; state: string; minutes: number }[]; correctionRate: { corrected: number; parsed: number }; recent: { id: string; state: string; mode: string | null; parser: string | null; corrected: string[]; recipients: string[] }[]; llmLog: { at: string; action: string }[] }>('/admin/friend-finder');
  return <><Head title="Friend Finder" sub="Request states, stuck requests and AI parsing quality. Message text is not shown." /><Err e={e} />
    {f && <><div className="console-kpis">{Object.entries(f.counts).map(([k, v]) => <div key={k} className="card"><span className="eyebrow">{k}</span><b className="kpi">{v}</b></div>)}
      <div className="card"><span className="eyebrow">AI corrections</span><b className="kpi">{f.correctionRate.corrected}/{f.correctionRate.parsed}</b><div className="xs muted">Above 10% blocks rollout</div></div></div>
      {f.stuck.length > 0 && <div className="card warn"><b>Stuck for more than 10 minutes</b>{f.stuck.map(s => <div key={s.id} className="small mono">{s.id} · {s.state} · {s.minutes} min</div>)}</div>}
      <table className="tbl"><thead><tr><th>Request</th><th>State</th><th>Mode</th><th>Parser</th><th>Corrected</th><th>Friends</th></tr></thead><tbody>{f.recent.map(r => <tr key={r.id}><td className="mono">{r.id}</td><td>{r.state}</td><td>{r.mode ?? '—'}</td><td>{r.parser ?? '—'}</td><td>{r.corrected.join(', ') || '—'}</td><td>{r.recipients.join(', ') || '—'}</td></tr>)}</tbody></table>
      {f.llmLog.length > 0 && <><h2 className="console-h2">AI and webhook log</h2><table className="tbl"><tbody>{f.llmLog.map((l, i) => <tr key={i}><td>{when(l.at)}</td><td className="mono">{l.action}</td></tr>)}</tbody></table></>}</>}
  </>;
}

function Flags({ role }: { role: string }) {
  const [f, e, reload] = useLoad<{ flags: { key: string; default_value: unknown; locked: boolean; note: string }[]; overrides: { household_id: string; key: string; value: unknown }[]; rewardsArms: { household: string; rewardsArm: boolean }[] }>('/admin/flags');
  const [err, setErr] = useState<string | null>(null);
  const canEdit = role === 'ops_lead' || role === 'tech_lead';
  const set = async (key: string, value: boolean | string, householdId?: string) => { setErr(null); try { await api('/admin/flags', { method: 'PUT', body: { key, value, householdId } }); reload(); } catch (x) { setErr(x instanceof ApiError ? String(x.body.note ?? x.body.error) : 'Couldn’t change.'); } };
  return <><Head title="Switches" sub="Feature switches by default and by household. Locked switches need an approval outside the console." /><Err e={e} />{err && <div className="card warn" role="alert">{err}</div>}
    {f && <><table className="tbl"><thead><tr><th>Switch</th><th>Value</th><th>Why</th><th></th></tr></thead><tbody>{f.flags.map(x => <tr key={x.key}><td className="mono">{x.key}</td><td><span className={`tag ${x.default_value === true ? 'flag-on' : x.default_value === false ? 'flag-off' : ''}`}>{String(x.default_value)}</span>{x.locked && <span className="tag" style={{ marginLeft: 6 }}>Locked</span>}</td><td className="small">{x.note}</td>
      <td>{canEdit && typeof x.default_value === 'boolean' && <button className="btn sm" disabled={x.locked} onClick={() => set(x.key, !x.default_value)}>{x.default_value ? 'Turn off' : 'Turn on'}</button>}</td></tr>)}</tbody></table>
      <h2 className="console-h2">Rewards experiment arms</h2>
      <table className="tbl"><tbody>{f.rewardsArms.map(r => <tr key={r.household}><td className="mono">{r.household}</td><td><span className={`tag ${r.rewardsArm ? 'flag-on' : 'flag-off'}`}>{r.rewardsArm ? 'ON' : 'OFF'}</span></td><td>{canEdit && <button className="btn sm" onClick={() => set('helperRewards', !r.rewardsArm, r.household)}>{r.rewardsArm ? 'Turn off' : 'Turn on'}</button>}</td></tr>)}</tbody></table></>}
  </>;
}

function Rewards() {
  const [r, e, reload] = useLoad<{ policy: Record<string, number | string>; held: { id: string; household_id: string; points: number; reason: string; created_at: string; decideBy: string }[]; totals: { state: string; points: number; entries: number }[]; experiment: string }>('/admin/rewards');
  const [open, setOpen] = useState<string | null>(null); const [note, setNote] = useState(''); const [err, setErr] = useState<string | null>(null);
  const decide = async (id: string, decision: 'release' | 'reverse') => { setErr(null); try { await api(`/admin/rewards/${id}/decide`, { body: { decision, note } }); setOpen(null); setNote(''); reload(); } catch (x) { setErr(x instanceof ApiError && x.body.error === 'reason_required' ? 'Write a reason the helper can read (5+ characters).' : x instanceof ApiError && x.status === 403 ? 'Your role can’t decide holds.' : 'Couldn’t save.'); } };
  return <><Head title="Rewards holds" sub={r?.experiment} /><Err e={e} />
    {r && <><div className="console-kpis">{r.totals.map(t => <div key={t.state} className="card"><span className="eyebrow">{t.state}</span><b className="kpi">{t.points}</b><div className="xs muted">{t.entries} entries</div></div>)}</div>
      <h2 className="console-h2">On hold ({r.held.length})</h2>{err && <span className="errtext" role="alert">{err}</span>}
      {r.held.length === 0 ? <div className="empty small">Nothing on hold.</div> : <table className="tbl"><thead><tr><th>Entry</th><th>Household</th><th>Points</th><th>Why</th><th>Decide by</th><th></th></tr></thead><tbody>{r.held.map(h => <tr key={h.id}><td className="mono">{h.id}</td><td className="mono">{h.household_id}</td><td>{h.points}</td><td>{h.reason.replace(/_/g, ' ')}{open === h.id && <div className="stack" style={{ marginTop: 6 }}><input className="input" placeholder="Reason the helper will read" value={note} onChange={x => setNote(x.target.value)} /><div className="row"><button className="btn sm primary" onClick={() => decide(h.id, 'release')}>Release</button><button className="btn sm" onClick={() => decide(h.id, 'reverse')}>Don’t give</button></div></div>}</td><td>{when(h.decideBy)}</td><td><button className="btn sm" onClick={() => setOpen(open === h.id ? null : h.id)}>Decide…</button></td></tr>)}</tbody></table>}
      <div className="card flat small"><span className="eyebrow">Policy</span>{Object.entries(r.policy).map(([k, v]) => <span key={k}>{k}: <b>{String(v)}</b> · </span>)}</div></>}
  </>;
}

function Rights() {
  const [r, e, reload] = useLoad<{ id: string; kind: string; channel: string; state: string; due_at: string; legal_due_at: string; created_at: string; detail: string | null; reply: string | null; user: string; overdue: boolean }[]>('/admin/rights');
  const [open, setOpen] = useState<string | null>(null); const [reply, setReply] = useState(''); const [err, setErr] = useState<string | null>(null);
  const update = async (id: string, state: string) => { setErr(null); try { await api(`/admin/rights/${id}`, { method: 'PUT', body: { state, reply: reply || undefined } }); setOpen(null); setReply(''); reload(); } catch (x) { setErr(x instanceof ApiError && x.body.error === 'reply_required' ? 'Write the reply the person will read before closing.' : 'Couldn’t save.'); } };
  return <><Head title="Rights requests" sub="Target: reply within 7 days. Legal limit: 90 days. Withdrawal stops future processing." /><Err e={e} />{err && <span className="errtext" role="alert">{err}</span>}
    {r && (r.length === 0 ? <div className="empty small">No requests.</div> : <table className="tbl"><thead><tr><th>Request</th><th>Person</th><th>Kind</th><th>Channel</th><th>Due</th><th>State</th><th></th></tr></thead><tbody>{r.map(x => <tr key={x.id}><td className="mono">{x.id}{x.detail && <div className="xs muted">{x.detail}</div>}{x.reply && <div className="xs">Reply: {x.reply}</div>}{open === x.id && <div className="stack" style={{ marginTop: 6 }}><textarea className="input" rows={2} placeholder="Reply the person will read" value={reply} onChange={v => setReply(v.target.value)} /><div className="row"><button className="btn sm" onClick={() => update(x.id, 'in_review')}>Mark in review</button><button className="btn sm primary" onClick={() => update(x.id, 'closed')}>Reply and close</button></div></div>}</td><td className="mono">{x.user}</td><td>{x.kind}</td><td>{x.channel}</td><td>{when(x.due_at)}{x.overdue && <span className="tag flag-off" style={{ marginLeft: 4 }}>Overdue</span>}</td><td>{x.state}</td><td>{x.state !== 'closed' && <button className="btn sm" onClick={() => setOpen(open === x.id ? null : x.id)}>Handle…</button>}</td></tr>)}</tbody></table>)}
  </>;
}

function Audit({ role }: { role: string }) {
  const [filter, setFilter] = useState('');
  const [a, e] = useLoad<{ appendOnly: boolean; rows: { id: number; at: string; actor: string; household_id: string | null; action: string; detail: unknown }[] }>('/admin/audit' + (filter ? `?action=${encodeURIComponent(filter)}` : ''));
  const canExport = role === 'auditor' || role === 'privacy_lead';
  const exportCsv = () => { if (!a) return; const csv = ['id,at,actor,household,action', ...a.rows.map(r => [r.id, r.at, r.actor, r.household_id ?? '', r.action].join(','))].join('\n'); const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); el.download = 'pawsure-audit.csv'; el.click(); URL.revokeObjectURL(el.href); };
  return <><Head title="Audit log" sub="Append-only. Nobody, including staff, can edit or delete an entry." right={canExport && <button className="btn sm" onClick={exportCsv}>Export CSV</button>} /><Err e={e} />
    <div className="seg" style={{ maxWidth: 560 }}>{[['', 'All'], ['admin', 'Staff views'], ['rights', 'Rights'], ['helper', 'Helper'], ['reward', 'Rewards'], ['flag', 'Switches']].map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k!)}>{l}</button>)}</div>
    {a && <table className="tbl"><thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Household</th></tr></thead><tbody>{a.rows.map(r => <tr key={r.id}><td className="mono">{r.id}</td><td>{when(r.at)}</td><td className="mono">{r.actor}</td><td className="mono">{r.action}</td><td className="mono">{r.household_id ?? '—'}</td></tr>)}</tbody></table>}
  </>;
}

function Breach({ role }: { role: string }) {
  const canRun = role === 'privacy_lead' || role === 'tech_lead';
  const [b, e, reload] = useLoad<{ checklist: { item: string; done: boolean; done_at: string | null }[]; events: { id: string; kind: string; aware_at: string; board_due_at: string; users_notified_at: string | null; board_reported_at: string | null; closed_at: string | null; summary: string | null }[]; rule: string }>('/admin/breach');
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); reload(); } catch (x) { setErr(x instanceof ApiError && x.status === 403 ? 'Your role can read the runbook but not run it.' : 'Couldn’t save.'); } };
  const left = (due: string) => { const h = Math.round((Date.parse(due) - Date.now()) / 3600000); return h > 0 ? `${h} h left` : 'Past due'; };
  return <><Head title="Breach runbook" sub={b?.rule} right={canRun && <button className="btn sm warn" onClick={() => run(() => api('/admin/breach/events', { body: { kind: 'rehearsal', summary: 'Tabletop rehearsal' } }))}>Start a rehearsal</button>} /><Err e={e} />{err && <div className="card warn" role="alert">{err}</div>}
    {b && <><div className="card"><span className="eyebrow">Readiness ({b.checklist.filter(c => c.done).length}/{b.checklist.length})</span>
      {b.checklist.map(c => <label key={c.item} className="row small" style={{ cursor: 'pointer' }}><input type="checkbox" disabled={!canRun} checked={c.done} onChange={() => run(() => api('/admin/breach/checklist', { method: 'PUT', body: { item: c.item, done: !c.done } }))} /><span className="grow">{c.item}</span>{c.done_at && <span className="xs muted">{when(c.done_at)}</span>}</label>)}</div>
      {b.events.map(ev => <div key={ev.id} className={`card ${ev.kind === 'incident' ? 'danger' : 'info'}`}><div className="row"><b className="grow">{ev.kind === 'incident' ? 'Incident' : 'Rehearsal'} · aware {when(ev.aware_at)}</b>{!ev.board_reported_at && !ev.closed_at && <span className="tag">{left(ev.board_due_at)}</span>}</div>
        {ev.summary && <div className="small">{ev.summary}</div>}
        <div className="row small">{([['users_notified', 'Affected people notified', ev.users_notified_at], ['board_reported', 'Board report filed', ev.board_reported_at], ['closed', 'Closed', ev.closed_at]] as const).map(([k, l, v]) => <button key={k} className={`btn sm ${v ? 'primary' : ''}`} disabled={!!v || !canRun} onClick={() => run(() => api(`/admin/breach/events/${ev.id}`, { method: 'PUT', body: { step: k } }))}>{v ? '✓ ' : ''}{l}</button>)}</div>
        <div className="xs muted">Board report due {when(ev.board_due_at)}</div></div>)}</>}
  </>;
}

type ServiceCheck = { key: string; label: string; status: 'ok' | 'warn' | 'alert'; value: string; target: string; note?: string };
const TONE: Record<string, string> = { ok: 'flag-on', warn: '', alert: 'flag-off' };
function Service() {
  const [s, e, reload] = useLoad<{ checks: ServiceCheck[]; deliveries: { at: string; channel: string; recipient_masked: string; template: string; status: string; attempt: number; error: string | null; latency_ms: number | null; fallback_of: string | null }[]; retention: { runs: { run_date: string; counts: Record<string, number> }[] }; vendors: { name: string; adapter: string; simulatedOutage: boolean }[]; uptimeSec: number }>('/admin/service');
  useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, []);
  const bad = s?.checks.filter(c => c.status !== 'ok') ?? [];
  return <><Head title="Service health" sub="Checks from the monitoring plan. A check that turns red opens one ops case and pages on-call. Refreshes every 15 s." right={<button className="btn sm" onClick={reload}>Refresh</button>} /><Err e={e} />
    {s && <>
      <div className={`card ${bad.some(c => c.status === 'alert') ? 'danger' : bad.length ? 'warn' : 'info'}`}><b>{bad.length === 0 ? 'All checks OK' : `${bad.filter(c => c.status === 'alert').length} alert · ${bad.filter(c => c.status === 'warn').length} warning`}</b><span className="xs muted">API up {Math.round(s.uptimeSec / 60)} min</span></div>
      <table className="tbl"><thead><tr><th>Check</th><th>Status</th><th>Now</th><th>Target</th></tr></thead><tbody>{s.checks.map(c => <tr key={c.key}><td><b>{c.label}</b>{c.note && <div className="xs muted">{c.note}</div>}</td><td><span className={`tag ${TONE[c.status]}`}>{c.status}</span></td><td>{c.value}</td><td className="small muted">{c.target}</td></tr>)}</tbody></table>
      <h2 className="console-h2">Vendors</h2>
      <table className="tbl"><tbody>{s.vendors.map(v => <tr key={v.name}><td>{v.name}</td><td className="small">{v.adapter}</td><td>{v.simulatedOutage ? <span className="tag flag-off">Simulated outage</span> : <span className="tag flag-on">Up</span>}</td></tr>)}</tbody></table>
      <h2 className="console-h2">Recent deliveries</h2>
      {s.deliveries.length === 0 ? <div className="empty small">Nothing sent yet.</div> : <table className="tbl"><thead><tr><th>When</th><th>Channel</th><th>To</th><th>Message</th><th>Result</th></tr></thead><tbody>{s.deliveries.map((d, i) => <tr key={i}><td>{when(d.at)}</td><td>{d.channel}{d.fallback_of ? ` (for ${d.fallback_of})` : ''}</td><td className="mono">{d.recipient_masked}</td><td className="mono small">{d.template}</td><td><span className={`tag ${d.status === 'sent' || d.status === 'fallback_sent' ? 'flag-on' : 'flag-off'}`}>{d.status.replace('_', ' ')}</span>{d.error && <div className="xs muted">{d.error}</div>}</td></tr>)}</tbody></table>}
      <h2 className="console-h2">Retention runs</h2>
      {s.retention.runs.length === 0 ? <div className="empty small">Not run yet.</div> : <table className="tbl"><tbody>{s.retention.runs.map(r => <tr key={r.run_date}><td className="mono">{r.run_date}</td><td className="small">{Object.entries(r.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(' · ') || 'nothing due'}</td></tr>)}</tbody></table>}
    </>}
  </>;
}

function Release({ role }: { role: string }) {
  const [r, e, reload] = useLoad<{ ready: boolean; items: { item: string; ok: boolean; detail: string }[]; lastAssignment: { at: string; detail: { seed: number; on: number; of: number } } | null; households: number; note: string }>('/admin/release-check');
  const [msg, setMsg] = useState<string | null>(null);
  const canAssign = role === 'ops_lead' || role === 'tech_lead';
  const assign = async () => { try { const x = await api<{ seed: number; on: number; of: number }>('/admin/cohort/assign', { body: { confirm: true } }); setMsg(`Assigned: ${x.on} of ${x.of} homes in the rewards arm. Seed ${x.seed} (record it in the decision log).`); reload(); } catch (err) { setMsg(err instanceof ApiError ? String(err.body.error) : 'Couldn’t assign.'); } };
  return <><Head title="Pilot readiness" sub={r?.note} /><Err e={e} />{msg && <div className="card info" role="status">{msg}</div>}
    {r && <>
      <div className={`card ${r.ready ? 'info' : 'warn'}`}><b>{r.ready ? 'Switches match §4.2' : 'Switches do not match §4.2 yet'}</b><span className="xs muted">{r.households} households in the database</span></div>
      <table className="tbl"><tbody>{r.items.map(i => <tr key={i.item}><td className="mono">{i.item}</td><td><span className={`tag ${i.ok ? 'flag-on' : 'flag-off'}`}>{i.ok ? 'OK' : 'Fix'}</span></td><td className="small">{i.detail}</td></tr>)}</tbody></table>
      <div className="card"><span className="eyebrow">Rewards arms</span>
        <div className="small">Puts half the cohort in the points arm, balanced between homes with and without a gate app. The seed makes the split reproducible.</div>
        {r.lastAssignment && <div className="small">Last assigned {when(r.lastAssignment.at)}: {r.lastAssignment.detail.on} of {r.lastAssignment.detail.of}, seed <span className="mono">{r.lastAssignment.detail.seed}</span></div>}
        {canAssign && <div><button className="btn sm" onClick={assign}>Assign arms for this cohort</button></div>}</div>
    </>}
  </>;
}
