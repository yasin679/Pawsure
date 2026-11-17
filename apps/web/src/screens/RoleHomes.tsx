/**
 * Home screens for people who sign in but don't own the household: helpers use WhatsApp or a basic phone, and
 * care-circle members (backup, family, viewer) get alerts, the day's timeline and incidents — never the owner's tabs.
 * The server enforces every permission; these screens only avoid showing doors that aren't theirs.
 */
import { ProofSheet } from './Proof';
import { useEffect, useState } from 'react';
import { api, hm, type Incident, type Me, type TimelineItem } from '../api';
import { AppBar, Art, Banner } from '../ui';

const ROLE: Record<string, string> = { backup: 'Backup', family: 'Family', viewer: 'Viewer' };

export function HelperHome({ me, onRights, onSignOut, onSignOutAll }: { me: Me; onRights: () => void; onSignOut: () => void; onSignOutAll: () => void }) {
  const home = me.memberships[0]; const [msg, setMsg] = useState<string | null>(null);
  return <><AppBar title="Pawsure for helpers" /><main className="body">
    <div className="hero-ill"><Art name="wave" width={120} /><h2>Hello {me.user.display_name?.split(' ')[0]}</h2><p className="small">You help at {home?.society?.split(',')[0]}{home?.tower ? ', ' + home.tower : ''}.</p>
      {/* PAW-019: the home's address belongs to the owner; the helper can say it is wrong. */}
      {home && (msg ? <div className="small" role="status">{msg}</div> : <button className="btn ghost sm" onClick={() => api<{ note: string }>(`/v1/households/${home.household_id}/report-details`, { body: {} }).then(r => setMsg(r.note)).catch(() => setMsg('Couldn’t send. Reply “help” on WhatsApp instead.'))}>Wrong society or tower? Tell the owner</button>)}</div>
    <HelperTasks />
    <div className="card"><span className="eyebrow">Pawsure works on WhatsApp or a basic phone</span>
      <p className="small">You don’t need this app. Reply on WhatsApp to the task messages, or give a missed call and enter the code.</p>
      <dl className="kv"><dt>points</dt><dd>See your points</dd><dt>share</dt><dd>Get a link to your record (counts only)</dd><dt>my data</dt><dd>Ask what Pawsure holds about you</dd><dt>stop</dt><dd>Stop check-ins at any time</dd><dt>help</dt><dd>A person calls you back</dd></dl></div>
    <Banner kind="info" icon="ℹ">Owners never see your number. Nothing is recorded unless you said Yes.</Banner>
    <button className="btn block" onClick={onRights}>Your data rights</button>
    <button className="btn ghost block" onClick={onSignOut}>Sign out</button>
    <button className="btn ghost block" onClick={onSignOutAll}>Sign out of all devices</button>
  </main></>;
}

export function CircleHome({ me, onRights, onSignOut, onSignOutAll }: { me: Me; onRights: () => void; onSignOut: () => void; onSignOutAll: () => void }) {
  const m = me.memberships[0]!; const H = `/v1/households/${m.household_id}`;
  const [timeline, setTimeline] = useState<TimelineItem[] | null>(null); const [incidents, setIncidents] = useState<Incident[]>([]); const [msg, setMsg] = useState<string | null>(null);
  const load = () => { api<TimelineItem[]>(`${H}/day/timeline`).then(setTimeline).catch(() => setTimeline([])); api<Incident[]>(`${H}/incidents`).then(setIncidents).catch(() => setIncidents([])); };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  const open = incidents.filter(i => !i.resolved_at);
  return <><AppBar title="Care circle" /><main className="body">
    <div className="card"><span className="eyebrow">{ROLE[m.role] ?? m.role} for</span><h2>{m.society.split(',')[0]}{m.tower ? ' · ' + m.tower : ''}</h2>
      <div className="small muted">{m.role === 'backup' ? 'You’re alerted if a check-in is missed and the owner hasn’t responded. Pet details and the emergency card open from the 15-minute look-in link you get on WhatsApp. Backups never give medicine.' : 'You can follow today’s care and acknowledge alerts.'}</div></div>
    {msg && <Banner kind="info" icon="✓">{msg}</Banner>}
    {open.map(i => <div key={i.id} className="card danger"><div className="row"><b className="grow">{i.severity} · {i.category.replace(/_/g, ' ')}</b><span className="tag">{i.ack_at ? 'Acknowledged' : 'Not acknowledged'}</span></div>
      {!i.ack_at && <button className="btn danger" onClick={() => api(`${H}/incidents/${i.id}/ack`, { body: {} }).then(() => { setMsg('Thanks, the owner will see that you’re on it.'); load(); }).catch(() => setMsg('Your role can’t acknowledge this.'))}>I’m on it</button>}</div>)}
    <div className="card"><span className="eyebrow">Today</span>
      {timeline == null ? <div className="small muted">Loading…</div> : timeline.length ? <div className="tl">{timeline.map((x, i) => <div key={i} className={`ev ${x.kind === 'signal' ? 'sig' : x.kind}`}><span className="t">{hm(x.at)}</span><span className="d" aria-hidden="true" /><span>{x.text}</span></div>)}</div> : <div className="small muted">Nothing to show yet.</div>}</div>
    <button className="btn block" onClick={onRights}>Your data rights</button>
    <button className="btn ghost block" onClick={onSignOut}>Sign out</button>
    <button className="btn ghost block" onClick={onSignOutAll}>Sign out of all devices</button>
  </main></>;
}

interface HelperTask { id: string; title: string; pet: string; due: number; householdId: string; proofSent: boolean; codeResult: string | null }
/** Proof from the helper's own login: today's tasks, each with Send proof (photo from camera or gallery + today's code). */
function HelperTasks() {
  const [d, setD] = useState<{ tasks: HelperTask[]; canSend: boolean } | null>(null); const [open, setOpen] = useState<HelperTask | null>(null);
  const load = () => api<{ tasks: HelperTask[]; canSend: boolean }>('/v1/me/helper/tasks').then(setD).catch(() => setD({ tasks: [], canSend: false }));
  useEffect(() => { load(); }, []);
  if (!d) return null;
  return <div className="card"><span className="eyebrow">Today’s tasks</span>
    {!d.tasks.length && <div className="small muted">No tasks for you today.</div>}
    {!d.canSend && d.tasks.length > 0 && <div className="small muted">Check-ins are stopped. Reply “start” on WhatsApp to begin again.</div>}
    <div className="list">{d.tasks.map(t => <div key={t.id} className="li"><div className="grow"><b>{hm(t.due)} · {t.title}</b><div className="small muted">{t.pet}{t.proofSent ? (t.codeResult === 'today' ? ' · proof sent ✓' : ' · proof sent') : ''}</div></div>
      {d.canSend && <button className="btn sm primary" onClick={() => setOpen(t)}>{t.proofSent ? 'Send again' : 'Send proof'}</button>}</div>)}</div>
    {open && <ProofSheet title={`Proof: ${open.title}`} householdId={open.householdId} onClose={() => { setOpen(null); load(); }} onSend={b => api<{ message?: string }>(`/v1/me/helper/tasks/${open.id}/proof`, { body: b })} />}
  </div>;
}
