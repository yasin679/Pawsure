/**
 * v1.1.0 cover continuity screens (PRD v1.4 7.7, 9.6; PS-127 to PS-140). All rules run on the server: this file only shows
 * what the API returns and sends the owner's choices. Visual reference: the updated prototype (Prototype/js/cover.js).
 */
import { useEffect, useState } from 'react';
import { nameError, api, ApiError, fmt, type Pet } from '../api';
import { AppBar, Banner, Icon, PersonAvatar } from '../ui';
import { Sheet } from './Today';

export interface CoverLine { tone: 'ok' | 'risk' | 'none' | 'plain'; text: string }
export interface JobView {
  id: string; careDate: string; tomorrow: boolean; state: string; active: boolean; reason: string; firstDue: number; time: string; pet: string; mode: string;
  tasks: { id: string; title: string; due: number; urgency: string; open: boolean; cover?: string }[];
  asks: { personId: string; name: string; state: string; at: number; round: number; until: number | null; holdsKey: boolean; ownerArranged: boolean; firstTime: boolean }[];
  hold: { personId: string; name: string; at: number; preApproved: boolean } | null; log: { at: number; text: string }[]; next: string; ffSkipped: boolean; friendFinderOpen: boolean; friendFinderCutoff: number; requestId: string | null;
  options: { handle: boolean; askSomeone: boolean; askCircle: boolean; friendFinder: boolean; ffOpen: boolean; move: boolean; moveWarning: boolean; skip: boolean; circleCallAt: number | null }; lastCare: string; notFoundAt: number | null; circleCalled: boolean
}
export interface CoverOverview {
  lines: Record<string, CoverLine | null>; jobs: JobView[]; tomorrow: { id: string; title: string; due: number; petId: string; line: CoverLine | null; ev: { state: string; label: string } }[];
  substitutes: { id: string; name: string; phone: string; by: string; tasks: string[]; time: string; decideBy: string }[];
  checklists: { taskId: string; person: string; gateApproved: boolean; keyPlan: string | null; keyNote: string | null; reminded: boolean }[];
  extensions: { id: string; old_return: number; new_return: number; created_tasks: string[]; result: string | null; asked: unknown }[];
  preDeparture: { warn: boolean; messages: string[]; unconfirmed: { id: string; petName: string; due: number; title: string; urgency: string }[]; wideAsk: boolean; medicine: boolean };
  noCoverPlanned: boolean; planB: string | null; settings: { standingApproval: boolean; remindTrusted: boolean; hotDay: boolean }; thin: { keyHolders: number; thin: boolean }; keyPlans: [string, string][]
}
const STATE_TITLE: Record<string, string> = { 'await-owner': 'Waiting for your tap', asking: 'Asking backups', hold: 'Someone said yes', ff: 'Friend Finder (needs your approval)', notfound: 'Cover not found', adhoc: 'Waiting for the person you asked', stopped: 'Stopped by you', covered: 'Covered', owner: 'You’re handling it', moved: 'Moved by you', skipped: 'Skipped by you', nocover: 'No cover planned', closed: 'Closed' };
const ASK_STATE: Record<string, string> = { asked: 'Waiting', yes: 'Said yes · waiting for you', confirmed: 'Said yes · confirmed', no: 'Said no', noreply: 'No reply', closed: 'Closed politely', waiting: 'Also said yes · waiting', released: 'Said yes · hold released', expired: 'Link expired' };
const URG: Record<string, [string, string]> = { CanWait: ['Can wait', ''], TimeSensitive: ['Time-sensitive', ''], MustHappen: ['Must happen', 'sim'] };
export const UrgencyTag = ({ u }: { u: string }) => <span className={`tag ${URG[u]?.[1] ?? ''}`}>{URG[u]?.[0] ?? u}</span>;
const errText = (e: unknown) => e instanceof ApiError ? String(e.body.message ?? e.body.note ?? e.body.error) : 'Can’t reach Pawsure. Try again.';

export function useCover(hh: string, stamp: unknown) {
  const [ov, setOv] = useState<CoverOverview | null>(null);
  const load = () => api<CoverOverview>(`/v1/households/${hh}/cover`).then(setOv).catch(() => setOv(null));
  useEffect(() => { load(); }, [hh, stamp]);
  return { ov, load };
}
export function CoverLineView({ line }: { line: CoverLine | null | undefined }) {
  if (!line) return null;
  return <div className={`coverline ${line.tone}`}><span className="eyebrow">Cover</span><span className="grow">{line.text}</span></div>;
}

/** At-risk banners, substitute approvals and gate-and-key cards at the top of Today. */
export function CoverAlerts({ hh, ov, reload, onFriendFinder }: { hh: string; ov: CoverOverview; reload: () => void; onFriendFinder: (requestId: string) => void }) {
  const [sheet, setSheet] = useState<{ kind: 'status' | 'notfound' | 'someone' | 'move'; job: JobView } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const H = `/v1/households/${hh}`;
  const act = async (fn: () => Promise<unknown>, keep = false) => { setErr(null); try { await fn(); reload(); if (!keep) setSheet(null); } catch (e) { setErr(errText(e)); } };
  const ff = (j: JobView) => act(async () => { const r = await api<{ requestId: string }>(`${H}/cover/jobs/${j.id}/friend-finder`, { body: {} }); onFriendFinder(r.requestId); });
  // the cover-not-found sheet opens by itself the first time (PS-133: message + call + one-tap options)
  useEffect(() => { const nf = ov.jobs.find(j => j.active && j.state === 'notfound'); if (nf && !sheet) { const k = 'pawsure.nf.' + nf.id; try { if (!sessionStorage.getItem(k)) { sessionStorage.setItem(k, '1'); setSheet({ kind: 'notfound', job: nf }); } } catch { /* storage blocked */ } } }, [ov]);
  const active = ov.jobs.filter(j => j.active);
  return <>
    {active.map(j => { const nf = j.state === 'notfound', asking = j.asks.filter(a => a.state === 'asked').map(a => a.name.split(' ').slice(0, a.name.startsWith('Mrs') ? 2 : 1).join(' '));
      return <div key={j.id} className={`card ${nf ? 'danger' : 'warn'} atrisk`} data-job={j.id}>
        <div className="row"><b className="grow">{nf ? 'Cover not found' : 'At risk'} · {j.pet} · {j.tasks.filter(t => t.open).map(t => t.title).join(', ')}</b><span className="mono small">{j.time}{j.tomorrow ? ' tomorrow' : ''}</span></div>
        <div className="small"><b>Why:</b> {j.reason}.{asking.length ? <> <b>Asking:</b> {asking.join(' and ')}.</> : null}{j.hold ? <> <b>{j.hold.name} said yes.</b></> : null}</div>
        <div className="small"><b>Next:</b> {j.next}</div>
        <div className="btnrow">
          {j.hold && <button className="btn primary" onClick={() => act(() => api(`${H}/cover/jobs/${j.id}/confirm`, { body: { personId: j.hold!.personId } }))}>Confirm {j.hold.name.split(' ')[0] === 'Mrs' ? j.hold.name : j.hold.name.split(' ')[0]}</button>}
          {j.state === 'await-owner' && <button className="btn primary" onClick={() => act(() => api(`${H}/cover/jobs/${j.id}/start`, { body: {} }))}>Ask my backups</button>}
          {(nf || j.state === 'stopped') && <button className="btn primary" onClick={() => setSheet({ kind: 'notfound', job: j })}>Choose what to do</button>}
          {j.options.ffOpen && (j.state === 'ff' || (j.state === 'asking' && j.mode === 'wide')) && <button className={`btn ${j.state === 'ff' ? 'primary' : ''}`} onClick={() => ff(j)}>{j.mode === 'wide' ? 'Ask friends too' : 'Find a friend'}</button>}
          {j.requestId && <button className="btn" onClick={() => onFriendFinder(j.requestId!)}>Open request</button>}
          <button className="btn" onClick={() => setSheet({ kind: 'status', job: j })}>See what’s happening</button>
        </div></div>; })}
    {ov.substitutes.map(s => <div key={s.id} className="card warn atrisk"><b>{s.by} wants to send someone else</b>
      <div className="small">{s.by} can’t make {s.tasks.join(', ')} ({s.time}) and named <b>{s.name}</b> ({s.phone}).</div>
      <div className="small"><b>Nothing about your home has been shared with {s.name.split(' ')[0]}.</b> If you approve, they get a one-time link for this task only. If you don’t decide by {s.decideBy}, your backups are asked.</div>
      <div className="btnrow"><button className="btn primary" onClick={() => act(() => api(`${H}/cover/substitutes/${s.id}/approve`, { body: {} }))}>Approve {s.name.split(' ')[0]}</button><button className="btn" onClick={() => act(() => api(`${H}/cover/substitutes/${s.id}/decline`, { body: {} }))}>Decline</button></div></div>)}
    {ov.checklists.map(c => <GateKey key={c.taskId} hh={hh} c={c} plans={ov.keyPlans} reload={reload} />)}
    {err && <span className="errtext" role="alert">{err}</span>}
    {sheet?.kind === 'status' && <Sheet onClose={() => setSheet(null)}><StatusBody j={ov.jobs.find(x => x.id === sheet.job.id) ?? sheet.job} />
      <div className="btnrow">{sheet.job.state === 'asking' && <button className="btn" onClick={() => act(() => api(`${H}/cover/jobs/${sheet.job.id}/stop`, { body: {} }), true).then(() => setSheet({ kind: 'notfound', job: sheet.job }))}>Stop asking</button>}
        {['notfound', 'stopped', 'ff'].includes(sheet.job.state) && <button className="btn primary" onClick={() => setSheet({ kind: 'notfound', job: sheet.job })}>Choose what to do</button>}</div></Sheet>}
    {sheet?.kind === 'notfound' && <Sheet onClose={() => setSheet(null)}><NotFoundBody j={ov.jobs.find(x => x.id === sheet.job.id) ?? sheet.job} err={err}
      onHandle={() => act(() => api(`${H}/cover/jobs/${sheet.job.id}/handle`, { body: {} }))} onCircle={() => act(() => api(`${H}/cover/jobs/${sheet.job.id}/circle`, { body: {} }))}
      onSkip={() => act(() => api(`${H}/cover/jobs/${sheet.job.id}/skip`, { body: {} }))} onSomeone={() => setSheet({ kind: 'someone', job: sheet.job })} onMove={() => setSheet({ kind: 'move', job: sheet.job })} onFriend={() => ff(sheet.job)} /></Sheet>}
    {sheet?.kind === 'someone' && <AskSomeone j={sheet.job} onClose={() => setSheet(null)} onSend={(name, phone) => act(() => api(`${H}/cover/jobs/${sheet.job.id}/ask-someone`, { body: { name, phone } }))} err={err} />}
    {sheet?.kind === 'move' && <MoveSheet j={sheet.job} onClose={() => setSheet(null)} onMove={(time) => act(() => api(`${H}/cover/jobs/${sheet.job.id}/move`, { body: { time } }))} err={err} />}
  </>;
}
function StatusBody({ j }: { j: JobView }) {
  return <><h2>Cover status</h2>
    <div className="small"><b>{j.pet} · {j.tasks.map(t => t.title).join(', ')}</b> · {j.time}{j.tomorrow ? ' tomorrow' : ''}<br />{j.reason}</div>
    <div className="card flat small"><b>{STATE_TITLE[j.state] ?? j.state}</b>{j.active && <><br />{j.next}</>}</div>
    {j.asks.length ? <div className="list">{j.asks.map((a, i) => <div key={i} className="li"><PersonAvatar seed={a.name} /><div className="grow"><b>{a.name}</b> {a.holdsKey && <span className="tag">Key</span>} {a.ownerArranged && <span className="tag sim">Owner-arranged, not verified by Pawsure</span>}
      <div className="small muted">Asked {fmt(a.at)} · {ASK_STATE[a.state] ?? a.state}{a.state === 'asked' && a.until != null ? ` until ${fmt(a.until)}` : ''}</div></div></div>)}</div> : <p className="small muted">Nobody has been asked yet.</p>}
    <div className="card flat"><span className="eyebrow">What happened</span>{j.log.map((l, i) => <div key={i} className="row small top"><span className="mono muted" style={{ minWidth: 58 }}>{fmt(l.at)}</span><span className="grow">{l.text}</span></div>)}</div>
    <p className="xs muted">Only people you approved are asked.</p></>;
}
function NotFoundBody({ j, err, onHandle, onCircle, onSkip, onSomeone, onMove, onFriend }: { j: JobView; err: string | null; onHandle: () => void; onCircle: () => void; onSkip: () => void; onSomeone: () => void; onMove: () => void; onFriend: () => void }) {
  const open = j.tasks.filter(t => t.open), must = open.filter(t => t.urgency === 'MustHappen'), asked = [...new Set(j.asks.map(a => a.name))].join(', ') || 'Nobody yet';
  if (!j.active) return <><h2>Sorted</h2><p className="small">{j.log.at(-1)?.text}.</p></>;
  return <><h2>{j.state === 'notfound' ? 'Cover not found' : 'Choose the next step'}</h2>
    <div className={`card ${j.state === 'notfound' ? 'danger' : 'warn'}`}>{open.map(t => <div key={t.id} className="row small"><span className="mono">{fmt(t.due)}</span><span className="grow"><b>{t.title}</b> · {j.pet}</span><UrgencyTag u={t.urgency} /></div>)}
      <div className="small"><b>Asked:</b> {asked}</div><div className="small">{j.lastCare}</div>{(j.ffSkipped || !j.friendFinderOpen) && <div className="small">Too close to the task for Friend Finder.</div>}</div>
    <div className="stack">
      <button className="btn primary block" onClick={onHandle}>I’ll handle it</button>
      <button className="btn block" onClick={onSomeone}>Ask someone else (any phone number)</button>
      <button className="btn block" disabled={!j.options.askCircle} onClick={onCircle}>Ask my whole care circle at once</button>
      {j.options.ffOpen && <button className="btn block" onClick={onFriend}>Find a friend (open until {fmt(j.friendFinderCutoff)})</button>}
      {j.options.move && <button className="btn block" onClick={onMove}>{j.options.moveWarning ? 'Move it (time-sensitive: you’ll see a warning)' : 'Move it'}</button>}
      {j.options.skip && <button className="btn block" onClick={onSkip}>Skip it today</button>}
    </div>
    {must.length > 0 && <Banner kind="alert" icon="!"><b>{must.map(t => t.title).join(', ')} must happen</b>, so Move and Skip are not offered. {j.options.circleCallAt != null ? `Calling your care circle in 15 min if you don’t respond (at ${fmt(j.options.circleCallAt)}).` : j.circleCalled ? 'Your care circle was called.' : ''}</Banner>}
    {!must.length && !j.options.skip && <p className="xs muted">Skip isn’t offered: meals are time-sensitive. They can be moved.</p>}
    {err && <span className="errtext" role="alert">{err}</span>}
    <p className="xs muted">Pawsure can’t promise someone will come. It is not an emergency service.</p></>;
}
function AskSomeone({ j, onClose, onSend, err }: { j: JobView; onClose: () => void; onSend: (name: string, phone: string) => void; err: string | null }) {
  const [name, setName] = useState(''), [phone, setPhone] = useState('');
  return <Sheet onClose={onClose}><h2>Ask someone else</h2><p className="small muted">{j.tasks.filter(t => t.open).map(t => t.title).join(', ')} · {j.time}</p>
    <div className="field"><label htmlFor="asn">Their name</label><input id="asn" className="input" value={name} onChange={e => setName(e.target.value)} /></div>
    <div className="field"><label htmlFor="asp">Their mobile</label><div className="row"><span className="tag">+91</span><input id="asp" className="input mono" inputMode="numeric" maxLength={10} value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} /></div></div>
    <div className="card flat small"><b>What they get:</b> a one-time link for this task, valid 15 minutes. <b>Not shared:</b> your flat number, key or gate details, until they accept and you approve.</div>
    {err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn primary block" disabled={!name.trim() || phone.length !== 10} onClick={() => onSend(name.trim(), '+91' + phone)}>Send one-time link</button></Sheet>;
}
function MoveSheet({ j, onClose, onMove, err }: { j: JobView; onClose: () => void; onMove: (t: number) => void; err: string | null }) {
  const opts = [j.firstDue + 60, j.firstDue + 120, j.firstDue + 180].filter(t => t < 1440);
  const [to, setTo] = useState(opts[0] ?? j.firstDue + 60);
  return <Sheet onClose={onClose}><h2>Move the task</h2><p className="small muted">{j.tasks.filter(t => t.open).map(t => t.title).join(', ')} · was {j.time}</p>
    <div className="field"><label htmlFor="mvt">New time</label><select id="mvt" className="input" value={to} onChange={e => setTo(Number(e.target.value))}>{opts.map(t => <option key={t} value={t}>{fmt(t)}</option>)}</select></div>
    {j.options.moveWarning ? <Banner kind="warn" icon="!"><b>Time-sensitive.</b> {j.pet} would wait longer than planned. {j.lastCare}.</Banner> : <p className="small">This task can wait, so moving it is fine.</p>}
    <p className="xs muted">You’ll do it yourself at the new time.</p>
    {err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn primary block" onClick={() => onMove(to)}>Move it</button></Sheet>;
}
function GateKey({ hh, c, plans, reload }: { hh: string; c: CoverOverview['checklists'][number]; plans: [string, string][]; reload: () => void }) {
  const done = c.gateApproved && !!c.keyPlan;
  const set = (b: Record<string, unknown>) => api(`/v1/households/${hh}/cover/checklists/${c.taskId}`, { body: b }).then(reload);
  const value = c.keyPlan === 'named_person' ? plans.find(p => p[0].startsWith('named_person:') && c.keyNote?.includes(p[0].slice(13).split(' ')[0]!))?.[0] ?? 'named_person:' : c.keyPlan ?? '';
  return <div className={`card ${done ? '' : 'info'} gatekey`} data-task={c.taskId}><div className="row"><b className="grow">Gate and key · {c.person}</b><span className={`tag ${done ? 'flag-on' : 'sim'}`}>{done ? 'Ready' : 'To do'}</span></div>
    <div className="small muted">{c.person} is new to your home.</div>
    <label className="check"><input type="checkbox" checked={c.gateApproved} onChange={e => set({ gateApproved: e.target.checked })} /><span>Approve {c.person} in your gate app <span className="xs muted">(you do this in the gate app; Pawsure has no gate-app integration)</span></span></label>
    <div className="field"><label htmlFor={'gk' + c.taskId}>Key plan</label><select id={'gk' + c.taskId} className="input" value={value} onChange={e => { const v = e.target.value; if (!v) return; const [plan, who] = v.split(':'); set({ keyPlan: plan, keyNote: who ? `Collect the key from ${who}` : undefined }); }}>
      <option value="">Choose the key plan…</option>{plans.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
    <div className="xs muted">{c.person} sees the gate and key note only after acceptance.{done ? '' : ' You’ll be reminded once, 15 minutes before the visit, if this isn’t finished.'}</div></div>;
}

/** Tomorrow's tasks appear once an evening reminder or advisory has started their cover (PS-127, PS-135). */
export function TomorrowList({ ov, petName }: { ov: CoverOverview; petName: (id: string) => string }) {
  if (!ov.tomorrow.length) return null;
  return <><div className="row"><h2 className="grow" style={{ fontSize: 'var(--fs-l)' }}>Tomorrow</h2><span className="xs muted">cover only</span></div>
    {ov.tomorrow.map(t => <div key={t.id} className="task"><div className="t1"><span className="time">{fmt(t.due).replace(/ (AM|PM)/, '')}</span><div className="grow"><div style={{ fontWeight: 700 }}>{t.title}</div><div className="small muted">{petName(t.petId)}</div></div></div><CoverLineView line={t.line} /></div>)}</>;
}

/** PS-134: shown when the owner taps "I'm leaving" and something today has nobody confirmed. */
export function PreDepartureSheet({ hh, ov, pets, onClose, onLeave, reload }: { hh: string; ov: CoverOverview; pets: Pet[]; onClose: () => void; onLeave: () => void; reload: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const pick = async (option: string) => { setErr(null); try { const r = await api<{ notCovered?: string[] }>(`/v1/households/${hh}/day/pre-departure`, { body: { option, petId: ov.preDeparture.unconfirmed[0] ? undefined : pets[0]?.id } }); reload(); if (option === 'leave_later' || option === 'ask_circle_now') onClose(); else if (r.notCovered?.length) setErr(`Not passed on: ${r.notCovered.join(', ')} (your provider isn’t marked for medicine).`); else onLeave(); } catch (e) { setErr(errText(e)); } };
  const pd = ov.preDeparture, first = pd.unconfirmed[0];
  const opts: [string, string, string, string][] = [
    ['do_it_before_leaving', 'check', 'Do it before leaving', `Feed early, leave extra water${pd.medicine ? '; medicine now only if your vet allows it' : ''}`],
    ['leave_later', 'phone', 'Leave later', 'Stay until someone confirms'],
    ['take_the_pet', 'paw', `Take ${first?.petName ?? 'your pet'} with me`, 'Today’s tasks for that pet are cancelled, not missed'],
    ['own_paid_provider', 'user', 'Use my own paid provider', 'Owner-arranged, not verified by Pawsure'],
    ['ask_circle_now', 'friends', 'Ask my circle now', pd.wideAsk ? 'More than 3 hours to go: backups are asked together, 60-minute window, and you can ask friends too' : 'Backups two at a time, then friends if there’s time'],
    ['leave_anyway', 'alert', 'Leave anyway', 'The day shows “No cover planned” and is not counted as covered']];
  return <Sheet onClose={onClose}><h2>Before you leave</h2>
    <Banner kind="warn" icon="!">{pd.messages.map(m => <div key={m}><b>{m}</b></div>)}</Banner>
    <p className="small muted">Choose what to do before you go.</p>
    <div className="list">{opts.map(([k, i, t, s]) => <button key={k} className="li" data-option={k} onClick={() => pick(k)}><span className="avatar icon"><Icon name={i} size={20} /></span><div className="grow"><b>{t}</b><div className="small muted">{s}</div></div><span className="chev">›</span></button>)}</div>
    {err && <span className="errtext" role="alert">{err}</span>}</Sheet>;
}

/** PS-136 I'm delayed: set a new return time → what changes → ask the current caregiver first. */
export function DelaySheet({ hh, returnAt: current, now, onClose, reload }: { hh: string; returnAt: number; now: number; onClose: () => void; reload: () => void }) {
  const [returnAt] = useState(current); // keep the time the owner started from, even after the plan is saved
  const opts: number[] = []; for (let t = Math.max(returnAt, now) + 30; t <= 1410; t += 30) opts.push(t);
  const [to, setTo] = useState(opts.includes(returnAt + 120) ? returnAt + 120 : opts[0] ?? returnAt + 30);
  const [plan, setPlan] = useState<{ id: string; added: { id: string; title: string; due: number; urgency: string }[]; alone: { longestMinutes: number; from: number; to: number; exceeds: boolean; limitHours: number }; medicine: { title: string }[]; planOnly: boolean; ask: { first: string } } | null>(null);
  const [asked, setAsked] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  if (!plan) return <Sheet onClose={onClose}><h2>I’m delayed</h2><p className="small muted">You planned to be back at <b>{fmt(returnAt)}</b>. Pawsure never guesses this from your location.</p>
    <div className="field"><label htmlFor="dlt">New return time</label><select id="dlt" className="input" value={to} onChange={e => setTo(Number(e.target.value))}>{opts.map(t => <option key={t} value={t}>{fmt(t)}</option>)}</select></div>
    <p className="xs muted">Only the extra time is re-planned. You can change it again later.</p>{err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn primary block" onClick={() => api<typeof plan>(`/v1/households/${hh}/day/delay`, { body: { returnAt: to } }).then(p => { setPlan(p); reload(); }).catch(e => setErr(errText(e)))}>See what changes</button></Sheet>;
  return <Sheet onClose={onClose}><h2>What changes</h2>
    <div className="card"><span className="eyebrow">New return time</span><h2>{fmt(returnAt)} → {fmt(to)}</h2></div>
    {plan.planOnly ? <div className="card flat small"><b>Nothing new is due</b> before {fmt(to)}. Your plan and return time are updated; nobody needs to be asked.</div>
      : <div className="card"><span className="eyebrow">Tasks that now fall while you’re out</span>{plan.added.map(t => <div key={t.id} className="row small"><span className="mono">{fmt(t.due)}</span><span className="grow"><b>{t.title}</b></span><UrgencyTag u={t.urgency} /></div>)}<div className="xs muted">You normally do these yourself after {fmt(returnAt)}.</div></div>}
    {plan.alone.exceeds ? <Banner kind="warn" icon="⏱"><b>Alone-window warning.</b> Your pets would be alone {(plan.alone.longestMinutes / 60).toFixed(1)} h ({fmt(plan.alone.from)}–{fmt(plan.alone.to)}). Your limit is {plan.alone.limitHours} h. <span className="xs muted">Your own threshold, not medical guidance.</span></Banner>
      : <div className="card flat small">Alone window: longest gap {(plan.alone.longestMinutes / 60).toFixed(1)} h, within your {plan.alone.limitHours} h limit.</div>}
    <div className="card flat small">Medicine: {plan.medicine.length ? <><b>{plan.medicine.map(m => m.title).join(', ')}</b> falls in the extra time. It is passed on only with your written instructions.</> : 'no medicine falls in the extra time.'}</div>
    {!plan.planOnly && !asked && <><button className="btn primary block" onClick={() => api<{ asked: string }>(`/v1/households/${hh}/day/delay/${plan.id}/ask`, { body: {} }).then(r => { setAsked(r.asked); reload(); }).catch(e => setErr(errText(e)))}>{plan.ask.first === 'current_caregiver' ? 'Ask Sunita first' : 'Ask my backups'}</button>
      <p className="xs muted">Your caregiver is asked first. Anything she can’t cover is asked of others.</p></>}
    {asked && <div className="card info small">{asked === 'helper' ? 'Sunita was asked. If she doesn’t reply in 10 minutes, your backups are asked for these tasks only.' : 'Nobody is caring right now, so your backups are being asked for these tasks only.'}</div>}
    {err && <span className="errtext" role="alert">{err}</span>}</Sheet>;
}

/** Cover history block for the day report (PRD 7.7 step 31). */
export function CoverHistory({ ov }: { ov: CoverOverview }) {
  const jobs = ov.jobs.filter(j => !j.tomorrow);
  if (!jobs.length && !ov.extensions.length && !ov.noCoverPlanned) return null;
  return <div className="card"><span className="eyebrow">Cover history</span>
    {ov.noCoverPlanned && <Banner kind="alert" icon="!"><b>No cover planned.</b> Nobody is confirmed for these tasks yet.</Banner>}
    {jobs.map(j => <div key={j.id} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}><b>{j.time} {j.tasks.map(t => t.title).join(', ')}</b><br />{j.reason} · now: <b>{STATE_TITLE[j.state] ?? j.state}</b>
      {j.asks.length > 0 && <><br />Asked: {j.asks.map(a => `${a.name} (${ASK_STATE[a.state]?.toLowerCase() ?? a.state})`).join(', ')}</>}{j.ffSkipped && <><br />Friend Finder skipped: too close to the task</>}{j.requestId && <><br />Friend Finder: {j.requestId}</>}</div>)}
    {ov.extensions.map(x => <div key={x.id} className="small" style={{ padding: '6px 0' }}><b>You were delayed:</b> return {fmt(x.old_return)} → {fmt(x.new_return)}{x.result ? <><br />{x.result}</> : null}</div>)}
    {ov.planB && <div className="small">Plan B you named when leaving: <b>{ov.planB}</b></div>}</div>;
}

/* ===================== Me → Backups (PS-130, PS-135) ===================== */
interface Backup { id: string; rank: number; name: string; phone: string; relationship: string; holdsKey: boolean; canGiveMedicine: boolean; ownerArranged: boolean; caredBefore: boolean }
export function ThinCard({ thin, onOpen }: { thin: { keyHolders: number; thin: boolean } | undefined; onOpen: () => void }) {
  if (!thin?.thin) return null;
  return <div className="card warn"><b>Your circle is thin</b><div className="small">{thin.keyHolders === 0 ? 'Nobody' : `Only ${thin.keyHolders} person`} on your backup list holds a key. If your helper can’t come, there may be nobody who can get in.</div><button className="btn sm primary" onClick={onOpen}>Open Backups</button><div className="xs muted">Weekly check (PS-135).</div></div>;
}
export function BackupsScreen({ hh, onBack, onBuild }: { hh: string; onBack: () => void; onBuild: () => void }) {
  const [d, setD] = useState<{ backups: Backup[]; standingApproval: boolean; remindTrusted: boolean; hotDay: boolean; max: number } | null>(null);
  const [add, setAdd] = useState(false), [f, setF] = useState({ name: '', phone: '', relationship: 'Neighbour or friend', holdsKey: false }), [err, setErr] = useState<string | null>(null);
  const H = `/v1/households/${hh}`;
  const load = () => api<typeof d>(`${H}/backups`).then(setD);
  useEffect(() => { load(); }, [hh]);
  const run = (p: Promise<unknown>) => p.then(load).catch(e => setErr(errText(e)));
  if (!d) return <><AppBar title="Backups" onBack={onBack} /><main className="body"><div className="empty">Loading…</div></main></>;
  const keys = d.backups.filter(b => b.holdsKey).length;
  const move = (i: number, dir: number) => { const ids = d.backups.map(b => b.id); const k = i + dir; [ids[i], ids[k]] = [ids[k]!, ids[i]!]; run(api(`${H}/backups/order`, { method: 'PUT', body: { ids } })); };
  return <><AppBar title="Backups" onBack={onBack} right={d.backups.length < d.max ? <button className="btn sm primary" onClick={() => setAdd(true)}><Icon name="plus" size={16} />Add</button> : undefined} /><main className="body">
    <p className="small muted">People you’ve pre-approved to step in, in the order they’re asked. Up to {d.max}. Two are asked at a time, 10 minutes per pair; key holders first when someone has to get in.</p>
    <ThinCard thin={{ keyHolders: keys, thin: keys < 2 }} onOpen={() => {}} />
    <div className="card"><label className="switch" htmlFor="sa"><span className="grow"><b>Ask my backups automatically</b><br /><span className="xs muted">If a task is at risk, these people are asked in this order. <b>This is the only case where Pawsure contacts people without your tap.</b> You can stop any ask.</span></span><input id="sa" type="checkbox" role="switch" checked={d.standingApproval} onChange={e => run(api(`${H}/cover/settings`, { method: 'PUT', body: { standingApproval: e.target.checked } }))} /></label></div>
    {d.backups.map((b, i) => <div key={b.id} className="card backup" data-backup={b.id}><div className="row"><span className="avatar">{i + 1}</span><div className="grow"><b>{b.name}</b><div className="small muted">{b.relationship} · <span className="mono">{b.phone}</span></div></div>
      <button className="btn sm" aria-label={`Move ${b.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button className="btn sm" aria-label={`Move ${b.name} down`} disabled={i === d.backups.length - 1} onClick={() => move(i, 1)}>↓</button></div>
      {b.ownerArranged && <div><span className="tag sim">Owner-arranged, not verified by Pawsure</span></div>}
      <label className="switch"><span className="grow">Holds a key</span><input type="checkbox" role="switch" checked={b.holdsKey} onChange={e => run(api(`${H}/backups/${b.id}`, { method: 'PATCH', body: { holdsKey: e.target.checked } }))} /></label>
      <label className="switch"><span className="grow">Can give medicine<br /><span className="xs muted">Only from your written instructions</span></span><input type="checkbox" role="switch" checked={b.canGiveMedicine} onChange={e => run(api(`${H}/backups/${b.id}`, { method: 'PATCH', body: { canGiveMedicine: e.target.checked } }))} /></label>
      {!b.caredBefore && <div className="xs muted">New to your home: they read the handling note first.</div>}
      <button className="btn ghost sm" onClick={() => run(api(`${H}/backups/${b.id}`, { method: 'DELETE' }))}>Remove</button></div>)}
    {!d.backups.length && <div className="empty"><b>No backups yet</b><p>Cover is limited until you have a circle.</p><button className="btn primary" onClick={onBuild}>Build my circle</button></div>}
    <div className="card"><label className="switch"><span className="grow"><b>Send the pre-visit reminder in Trusted Helper mode</b><br /><span className="xs muted">Off by default. Tracked helpers always get one reminder per visit.</span></span><input type="checkbox" role="switch" checked={d.remindTrusted} onChange={e => run(api(`${H}/cover/settings`, { method: 'PUT', body: { remindTrusted: e.target.checked } }))} /></label>
      <label className="switch"><span className="grow"><b>Hot day: water tasks must happen</b><br /><span className="xs muted">Your choice; Pawsure gives no health advice.</span></span><input type="checkbox" role="switch" checked={d.hotDay} onChange={e => run(api(`${H}/cover/settings`, { method: 'PUT', body: { hotDay: e.target.checked } }))} /></label></div>
    <p className="xs muted">Backups see the task and time. Address and key details only after you confirm someone.</p>
    {err && <span className="errtext" role="alert">{err}</span>}
    {add && <Sheet onClose={() => setAdd(false)}><h2>Add a backup</h2>
      <div className="field"><label htmlFor="bn">Name</label><input id="bn" className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="bp">Mobile</label><div className="row"><span className="tag">+91</span><input id="bp" className="input mono" inputMode="numeric" maxLength={10} value={f.phone} onChange={e => setF({ ...f, phone: e.target.value.replace(/\D/g, '') })} /></div></div>
      <div className="field"><label htmlFor="br">Who are they?</label><select id="br" className="input" value={f.relationship} onChange={e => setF({ ...f, relationship: e.target.value })}>{['Spouse or co-owner', 'Family', 'Neighbour or friend', 'Own paid walker or sitter'].map(o => <option key={o}>{o}</option>)}</select></div>
      <label className="check"><input type="checkbox" checked={f.holdsKey} onChange={e => setF({ ...f, holdsKey: e.target.checked })} /><span>Holds a key</span></label>
      <div className="card flat small">A paid walker or sitter you arrange yourself is labelled <b>owner-arranged, not verified by Pawsure</b>. Pawsure hasn’t checked them.</div>
      <button className="btn primary block" disabled={!f.name || f.phone.length !== 10} onClick={() => { const ne = nameError(f.name); if (ne) { setErr(ne); return; } api(`${H}/backups`, { body: { name: f.name, phone: '+91' + f.phone, relationship: f.relationship, holdsKey: f.holdsKey, ownerArranged: f.relationship === 'Own paid walker or sitter' } }).then(() => { setAdd(false); load(); }).catch(e => setErr(errText(e))); }}>Add to my backups</button></Sheet>}
  </main></>;
}

/* ===================== PS-140 newcomer circle builder ===================== */
/** `embedded` renders just the four ways (no header or banner), for the onboarding conversation. */
export function CircleBuilder({ hh, onDone, onBack, embedded }: { hh: string; onDone?: () => void; onBack?: () => void; embedded?: boolean }) {
  const [done, setDone] = useState<Record<string, string>>({});
  const go = (kind: string, extra: Record<string, unknown> = {}) => api<{ note: string }>(`/v1/households/${hh}/circle-builder`, { body: { kind, ...extra } }).then(r => setDone(d => ({ ...d, [kind]: r.note })));
  const [prov, setProv] = useState({ name: '', phone: '' });
  const row = (k: string, ic: string, t: string, s: string, action: () => void, extra?: React.ReactNode) => <div className="card" data-builder={k}><div className="row top"><span className="avatar icon"><Icon name={ic} size={20} /></span><div className="grow"><b>{t}</b><div className="small muted">{s}</div></div></div>{extra}{done[k] ? <span className="tag flag-on">{done[k]}</span> : <button className="btn sm primary" onClick={action}>Start</button>}</div>;
  const ways = <>
    {row('society_link', 'friends', 'Share an invite link in your society WhatsApp group', 'Neighbours who join choose what they can help with. Nobody sees your flat number.', () => go('society_link'))}
    {row('pet_swap', 'paw', 'Start a pet-parent swap', 'Pair up with another owner in your society: you cover for each other. Both of you must opt in.', () => go('pet_swap'))}
    {row('building_helper', 'user', 'Invite a helper who already works in your building', 'Only with her consent first. One helper can work for several homes without mixing them up.', () => go('building_helper'))}
    {row('paid_provider', 'star', 'Add your own paid walker or sitter', 'Shown as “owner-arranged, not verified by Pawsure”.', () => go('paid_provider', prov.name && prov.phone.length === 10 ? { name: prov.name, phone: '+91' + prov.phone } : {}),
      !done.paid_provider && <div className="grid2"><input className="input" aria-label="Provider name" placeholder="Name" value={prov.name} onChange={e => setProv({ ...prov, name: e.target.value })} /><input className="input mono" aria-label="Provider mobile" placeholder="Mobile (10 digits)" inputMode="numeric" maxLength={10} value={prov.phone} onChange={e => setProv({ ...prov, phone: e.target.value.replace(/\D/g, '') })} /></div>)}
    <div className="card flat small muted">Day cares aren’t listed here.</div>
    {onDone && <button className="btn primary block" onClick={onDone}>Continue</button>}
  </>;
  if (embedded) return ways;
  return <><AppBar title="Build your circle" onBack={onBack} /><main className="body">
    <Banner kind="info" icon="ℹ"><b>Cover is limited until you have a circle.</b> Four easy ways to find someone who can step in.</Banner>
    {ways}
  </main></>;
}
