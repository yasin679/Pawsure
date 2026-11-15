/** Today (PS-007, PS-012–016, PS-030–036, PS-103, PS-111, PS-121, PS-122). */
import { t as tr } from '../i18n';
import { useState } from 'react';
import { api, ApiError, fmt, hm, type DayTask, type DayView, type DayReport, type Incident, type Pet, type TimelineItem } from '../api';
import { AppBar, Art, Banner, Conf, Icon, PetAvatar } from '../ui';
import { useCover, CoverAlerts, CoverLineView, TomorrowList, PreDepartureSheet, DelaySheet, CoverHistory, UrgencyTag } from './Cover';

const COVER_LABEL: Record<string, [string, string]> = { Covered: ['Confirmed', 'Covered day'], 'In progress': ['Pending', 'Covered so far'], 'At risk': ['Not confirmed', 'Not covered yet'], 'Not covered': ['Missed', 'Not covered'], Unknown: ['Unknown', 'Unknown, tap Covered'], Excluded: ['Pending', 'No tasks today'] };
const MODE: Record<string, string> = { tracked: 'Sunita (tracked helper)', trusted: 'Sunita, Trusted Helper mode', uncovered: 'Nobody yet, cover needed', friend: 'A friend (Find cover)' };
const SEV: Record<string, [string, string][]> = {
  'S1 Urgent': [['pet_hurt', 'Pet hurt'], ['bite', 'Someone was bitten'], ['collapse_breathing', 'Collapse / breathing trouble'], ['pet_missing', 'Pet missing'], ['door_key_security', 'Door / key problem']],
  'S2 Unwell': [['vomiting', 'Vomiting'], ['not_eating', 'Not eating'], ['limping', 'Limping'], ['unusual_behaviour', 'Unusual behaviour']],
  'S3 Practical': [['food_out', 'Food ran out'], ['water_out', 'Water ran out'], ['pads_out', 'Toilet pads ran out'], ['pet_outside', 'Pet left outside']]
};
const RQ = [['food', 'Food bowl', 'Empty / eaten', 'Untouched'], ['water', 'Water bowl', 'Lower / refilled', 'Same or dry'], ['pad', 'Toilet pad', 'Changed', 'Old'], ['pet', 'Your pets', 'Normal', 'Very hungry or thirsty'], ['damage', 'Anything damaged or wrong?', 'No', 'Yes']] as const;
type SheetKind = null | 'caring' | 'cantcome' | 'leaving' | 'return' | 'timeline' | 'report' | 'sos' | 'resolve' | 'task' | 'incident' | 'change' | 'predeparture' | 'delay';

const VERB: Record<string, string> = { feeding: 'feed', walk: 'walk', medicine: 'give medicine to', litter: 'clean the litter tray for', toilet: 'change the toilet pad for', water: 'top up water for' };

export function Today({ hh, day, pets, incidents, ownerName, reload, onFindCover, onOpenRequest, onEditRoutine }: { hh: string; day: DayView | null; pets: Pet[]; incidents: Incident[]; ownerName: string; reload: () => void; onFindCover: (draft?: string) => void; onOpenRequest?: (id: string) => void; onEditRoutine?: () => void }) {
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [task, setTask] = useState<DayTask | null>(null);
  const [inc, setInc] = useState<Incident | null>(null);
  const [note, setNote] = useState(''); const [err, setErr] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const [checklist, setChecklist] = useState({ water: false, doors: false, pads: false }); const [returnAt, setReturnAt] = useState(1140);
  const [answers, setAnswers] = useState<Record<string, 0 | 1 | undefined>>({});
  const [timeline, setTimeline] = useState<TimelineItem[]>([]); const [report, setReport] = useState<DayReport | null>(null);
  const [change, setChange] = useState<'Cancelled by owner' | 'Partly done' | 'Skipped with reason'>('Cancelled by owner');
  const [planB, setPlanB] = useState('');
  const { ov, load: loadCover } = useCover(hh, day);
  const reloadAll = () => { reload(); loadCover(); };
  const petName = (id: string) => pets.find(p => p.id === id)?.name ?? id;
  const H = `/v1/households/${hh}`;
  const close = () => { setSheet(null); setErr(null); setNote(''); };
  const run = async (fn: () => Promise<unknown>, after?: () => void) => { setErr(null); try { await fn(); reloadAll(); after ? after() : close(); } catch (e) { setErr(e instanceof ApiError ? String(e.body.message ?? e.body.issues ?? e.body.error) : 'Can’t reach Pawsure. Try again.'); } };
  if (!day) return <><AppBar title={tr('Today')} hideTitle /><div className="body"><div className="empty">{tr('Loading today…')}</div></div></>;

  const [cs, cl] = COVER_LABEL[day.covered.household] ?? ['Pending', day.covered.household];
  const greet = day.now < 720 ? 'Good morning' : day.now < 1020 ? 'Good afternoon' : 'Good evening';
  const alerts = day.tasks.filter(t => t.esc?.open && !t.esc.resolved);
  const openInc = incidents.filter(i => !i.resolved_at);
  const byVisit = new Map<string, DayTask[]>();
  day.tasks.forEach(t => { const k = t.visitId ?? 'solo-' + t.id; byVisit.set(k, [...(byVisit.get(k) ?? []), t]); });
  const d = day.day;
  // Pre-fill Find cover with the next task the helper would have done (owner edits it before anything is sent).
  const nextTask = day.tasks.find(t => t.due >= day.now - 30 && !['Confirmed', 'Likely', 'Cancelled'].includes(t.ev.state));
  const coverDraft = nextTask ? `Sunita can’t come today. Can someone ${VERB[nextTask.type] ?? 'look after'} ${petName(nextTask.petId)} at ${fmt(nextTask.due).toLowerCase()}?` : undefined;
  const needsCover = d.helperUnavailable || d.mode === 'uncovered' || d.mode === 'friend';

  return <>
    <AppBar title={tr('Today')} hideTitle right={<button className="btn sm danger" onClick={() => setSheet('sos')} aria-label="Report a problem or emergency">{tr('SOS')}</button>} />
    <main className="body">
      <div className="row top"><div className="grow"><div className="small muted">{day.careDate} · IST</div><h2 style={{ fontSize: 'var(--fs-xl)', lineHeight: 1.3 }}>{tr(greet)}, {ownerName.split(' ')[0]}</h2></div>{ov?.noCoverPlanned && day.covered.household !== 'Covered' ? <Conf state="Missed" label="No cover planned" /> : <Conf state={cs} label={cl} />}</div>
      <div className="petchips">{pets.map(p => <span key={p.id} className="petchip"><PetAvatar species={p.species} size={34} /><span><b>{p.name}</b><span className="xs muted">{p.species}{p.age ? ' · ' + p.age : ''}</span></span></span>)}</div>
      {msg && <Banner kind="info" icon="ℹ">{msg} <button className="btn ghost sm" onClick={() => setMsg(null)}>{tr('Dismiss')}</button></Banner>}

      {ov && <CoverAlerts hh={hh} ov={ov} reload={reloadAll} onFriendFinder={(id) => onOpenRequest ? onOpenRequest(id) : onFindCover()} />}
      {openInc.map(i => <div key={i.id} className="card danger"><div className="row"><b className="grow">{i.severity} · {i.category.replace(/_/g, ' ')}</b><span className={`tag ${i.ack_at ? 'owner' : 'sim'}`}>{i.ack_at ? 'Acknowledged' : 'Not acknowledged'}</span></div>
        <div className="btnrow">{!i.ack_at && <button className="btn danger" onClick={() => run(() => api(`${H}/incidents/${i.id}/ack`, { body: {} }))}>{tr('I’m on it')}</button>}<button className="btn" onClick={() => { setInc(i); setSheet('incident'); }}>{tr('Open')}</button></div></div>)}

      {alerts.map(t => <div key={t.id} className={`card ${t.esc!.acknowledged ? 'info' : 'warn'}`}>
        <div className="row"><b className="grow">{petName(t.petId)} · {t.title}</b><Conf state={t.ev.state} label={t.ev.label} /></div>
        <div className="small">{t.ev.visitOnly ? 'The visit is recorded, but there’s no evidence for this task.' : `No evidence yet. Due ${fmt(t.due)}.`} {escText(t, day.now)}</div>
        <div className="btnrow">{t.esc!.acknowledged ? <button className="btn primary" onClick={() => { setTask(t); setSheet('resolve'); }}>{tr('Mark resolved')}</button> : <button className="btn warn" onClick={() => run(() => api(`${H}/tasks/${t.id}/ack`, { body: {} }))}>{tr('I’m on it')}</button>}
          <button className="btn" onClick={() => run(() => api(`${H}/day/call-helper`, { body: {} }), () => setMsg('Logged that you called Sunita. Use your phone to place the call.'))}><Icon name="phone" size={18} />Call Sunita</button></div>
      </div>)}

      <div className="card"><div className="row"><div className="grow"><span className="eyebrow">{tr('Who’s caring today?')}</span><h2>{tr(MODE[d.mode] ?? d.mode)}</h2></div><button className="btn sm" onClick={() => setSheet('caring')}>{tr('Change')}</button></div>
        {d.mode === 'trusted' && <><div className="small muted">No check-ins or alerts today. Tap Covered when it’s done.</div>{day.covered.household !== 'Covered' && <button className="btn primary sm" onClick={() => run(() => api(`${H}/day/trusted-covered`, { body: {} }))}>{tr('Covered')}</button>}</>}
        {d.helperUnavailable && <Banner kind="warn" icon="!">Sunita can’t come today{d.unavailableReason ? ` (${d.unavailableReason})` : ''}. Your original plan is kept.</Banner>}
        {needsCover && <div className="btnrow">{d.helperUnavailable && ov?.preDeparture.warn && !ov.jobs.some(j => j.active) && <button className="btn primary sm" onClick={() => run(() => api(`${H}/day/pre-departure`, { body: { option: 'ask_circle_now' } }))}><Icon name="friends" size={18} />{tr('Ask my backups')}</button>}<button className="btn sm" onClick={() => onFindCover(d.helperUnavailable ? coverDraft : undefined)}><Icon name="search" size={18} />{tr('Ask a friend to cover')}</button></div>}
        {d.mode === 'tracked' && !d.helperUnavailable && <button className="btn ghost sm" onClick={() => setSheet('cantcome')}>{tr('My help can’t come today')}</button>}
      </div>
      {d.alone.exceeds && <Banner kind="warn" icon="⏱"><b>Alone-window warning.</b> Your pets would be alone {(d.alone.longestMinutes / 60).toFixed(1)} h ({fmt(d.alone.from)}–{fmt(d.alone.to)}). Your limit is {d.alone.limitHours} h. <span className="xs muted">Your own threshold, not medical guidance.</span></Banner>}
      {d.leftAt == null ? <div className="card flat"><div className="row"><div className="grow"><b>{tr('Heading out?')}</b><div className="small muted">{tr('30-second leaving checklist')}</div></div><button className="btn primary sm" onClick={() => setSheet(ov?.preDeparture.warn ? 'predeparture' : 'leaving')}>{tr('I’m leaving')}</button></div></div>
        : d.backAt == null ? <div className="card flat"><div className="row"><div className="grow"><b>Out since {fmt(d.leftAt)}</b><div className="small muted">Back around {fmt(d.returnAt)}</div></div><button className="btn sm" onClick={() => setSheet('delay')}>{tr('I’m delayed')}</button><button className="btn sm" onClick={() => run(async () => { const r = await api<{ returnCheckNeeded: boolean }>(`${H}/day/back`, { body: {} }); setSheet(r.returnCheckNeeded ? 'return' : null); if (!r.returnCheckNeeded) setMsg('Welcome back. Everything had evidence today, no return check needed.'); }, () => {})}>{tr('I’m back')}</button></div></div>
        : !d.returnCheckDone && d.returnCheckNeeded ? <div className="card flat"><div className="row"><b className="grow">{tr('Quick return check (10 s)')}</b><button className="btn primary sm" onClick={() => setSheet('return')}>{tr('Start')}</button></div></div> : null}

      <h2 style={{ fontSize: 'var(--fs-l)', margin: '4px 0 -6px' }}>{tr('Plan & evidence')}</h2><div className="row wrap" style={{ gap: 4 }}>
        {onEditRoutine && <button className="btn ghost sm" onClick={onEditRoutine}>{tr('Edit routine')}</button>}
        <button className="btn ghost sm" onClick={() => run(async () => { setTimeline(await api<TimelineItem[]>(`${H}/day/timeline`)); setSheet('timeline'); }, () => {})}>{tr('Timeline')}</button>
        <button className="btn ghost sm" onClick={() => run(async () => { setReport(await api<DayReport>(`${H}/day/report`)); setSheet('report'); }, () => {})}>{tr('Day report')}</button></div>
      {[...byVisit.entries()].map(([k, ts]) => { const v = day.visits[k]; return <div key={k} className="stack">
        {v && v.status && <div className="visitline"><span className="eyebrow">{tr('Visit')}</span><span className="grow">{v.arrive != null && v.exit != null ? <>Sunita came <b>{hm(v.arrive)}–{hm(v.exit)}</b> ({v.duration} min)</> : v.arrive != null ? <>Arrived <b>{hm(v.arrive)}</b></> : v.gate ? 'Gate entry (owner-provided)' : <>Left <b>{hm(v.exit!)}</b></>}</span><Conf state={v.status} label={v.status === 'In progress' ? 'Visit in progress' : 'Visit ' + v.status.toLowerCase()} /></div>}
        {ts.map(t => <button key={t.id} className="task" onClick={() => { setTask(t); setSheet('task'); }}>
          <div className="t1"><span className="time">{hm(t.due)}</span><div className="grow"><div style={{ fontWeight: 700 }}>{t.title}</div><div className="small muted">{petName(t.petId)}</div></div><Conf state={t.ev.state} label={t.ev.label} /></div>
          <CoverLineView line={ov?.lines[t.id]} />
          {(t.lifecycle.at(-1)?.state !== 'Planned' || t.signals.length > 0 || t.ev.late) && <div className="row wrap"><span className="life">{t.lifecycle.at(-1)?.state !== 'Planned' ? t.lifecycle.at(-1)?.state : ''}{t.signals.length ? (t.lifecycle.at(-1)?.state !== 'Planned' ? ' · ' : '') + t.signals.map(s => s.kind === 'photo' ? `📷 ${s.code === 'today' ? 'photo + code' : 'photo'}` : s.kind === 'friend_photo' ? '📷 photo' : s.kind).join(' · ') : ''}</span>{t.ev.late && <span className="tag sim">{tr('Late')}</span>}</div>}
        </button>)}
      </div>; })}
      {ov && <TomorrowList ov={ov} petName={petName} />}
      <p className="xs muted">Cover (who is expected) and evidence (whether it was done) are shown separately. A Yes or a visit alone never confirms a task. Rule {day.tasks[0]?.ev.ruleSet} · {day.covered.rule}</p>
    </main>

    {sheet === 'task' && task && <Sheet onClose={close}>
      <div className="row"><h2 className="grow">{task.title}</h2><Conf state={task.ev.state} label={task.ev.label} /></div>
      <div className="small muted">{petName(task.petId)} · due {fmt(task.due)}{task.movedFrom != null ? ` (moved from ${fmt(task.movedFrom)})` : ''} · {task.profile} escalation{task.profile === 'medicine' ? ' (never to backup)' : ''} <UrgencyTag u={task.urgency} /></div>
      {task.cover && <div className="card"><span className="eyebrow">Cover (who is expected) · separate from evidence</span><div className="row"><b className="grow">{task.cover.label}</b></div><CoverLineView line={ov?.lines[task.id]} /><div className="xs muted">{tr('A Yes is a plan, not proof the task was done.')}</div></div>}
      {task.visitId && day.visits[task.visitId]?.status && <div className="card flat"><span className="eyebrow">Visit evidence (separate from the task)</span>{day.visits[task.visitId]!.reasons.map(r => <div key={r} className="xs mono">{r}</div>)}</div>}
      <div className="card flat"><span className="eyebrow">Why this label</span>{task.ev.reasons.map(r => <div key={r} className="xs mono">{r}</div>)}</div>
      {task.esc && <div className="card"><span className="eyebrow">Escalation ladder</span>{task.esc.steps.map(s => <div key={s.n} className="row small"><span className="mono" style={{ minWidth: 60 }}>{fmt(s.at)}</span><span className="grow">{s.kind.replace(/_/g, ' ')}</span><span className={`tag ${s.fired ? 'flag-on' : s.stoppedByAck || s.notRepeated ? 'owner' : ''}`}>{s.fired ? 'Sent' : s.stoppedByAck ? 'Stopped' : s.notRepeated ? 'Not repeated (asked before the task)' : 'Pending'}</span></div>)}</div>}
      <div className="card"><span className="eyebrow">Lifecycle (append-only)</span>{task.lifecycle.map((l, i) => <div key={i} className="row small"><span className="mono muted" style={{ minWidth: 48 }}>{hm(l.at)}</span><span className="grow"><b>{l.state}</b> · {l.actor}{l.note ? ', ' + l.note : ''}</span></div>)}</div>
      <div className="small"><b>Helper points:</b> {task.points.kind === 'earn' ? `+${task.points.points}` : task.points.kind === 'hold' ? 'held (review, max 7 days)' : (task.points.reason ?? '').replace(/_/g, ' ')}</div>
      <div className="btnrow">{task.visitId && d.gateApp && <button className="btn sm" onClick={() => run(() => api(`${H}/visits/${task.visitId}/gate`, { body: {} }))}>Attach my gate-app alert</button>}
        {task.ev.state !== 'Cancelled' && <button className="btn sm" onClick={() => setSheet('change')}>{tr('Change this task')}</button>}</div>
      <p className="xs muted">Gate alerts are marked as from you.</p>
    </Sheet>}

    {sheet === 'predeparture' && ov && <PreDepartureSheet hh={hh} ov={ov} pets={pets} onClose={close} onLeave={() => setSheet('leaving')} reload={reloadAll} />}
    {sheet === 'delay' && <DelaySheet hh={hh} returnAt={d.returnAt} now={day.now} onClose={close} reload={reloadAll} />}
    {sheet === 'change' && task && <Sheet onClose={close}><h2>Change: {task.title}</h2>
      <div className="seg">{(['Cancelled by owner', 'Partly done', 'Skipped with reason'] as const).map(s => <button key={s} aria-pressed={change === s} onClick={() => setChange(s)}>{s === 'Cancelled by owner' ? 'Cancel today' : s === 'Partly done' ? 'Partly done' : 'Skipped'}</button>)}</div>
      <div className="field"><label htmlFor="cn">{change === 'Partly done' ? 'What was skipped?' : 'Reason'} (required)</label><input id="cn" className="input" value={note} onChange={e => setNote(e.target.value)} /></div>
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block" onClick={() => run(() => api(`${H}/tasks/${task.id}/lifecycle`, { body: { state: change, note } }))}>{tr('Save')}</button>
      <p className="xs muted">{tr('History is kept.')}</p></Sheet>}

    {sheet === 'resolve' && task && <Sheet onClose={close}><h2>Resolve: {task.title}</h2>
      <div className="field"><label htmlFor="rn">What happened? (required)</label><textarea id="rn" className="input" value={note} onChange={e => setNote(e.target.value)} /></div>
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block" onClick={() => run(() => api(`${H}/tasks/${task.id}/resolve`, { body: { note } }))}>{tr('Mark resolved')}</button>
      <p className="xs muted">Resolve a missed task by midnight to keep the day covered.</p></Sheet>}

    {sheet === 'caring' && <Sheet onClose={close}><h2>{tr('Who’s caring today?')}</h2>
      <div className="list">{[['tracked', 'user', 'Own helper: Sunita (tracked)', 'Check-ins on WhatsApp or missed call; alerts if something is missed'], ['trusted', 'heart', 'Trusted Helper mode', 'No check-ins, alerts or points. You tap Covered later; no tap = Unknown'], ['uncovered', 'alert', 'Nobody yet', 'Shows “cover needed”; your plan is kept'], ['friend', 'search', 'A friend', 'Ask your own friends. Nothing is sent until you approve']].map(([k, i, t, s]) =>
        <button key={k} className="li" onClick={() => run(() => api(`${H}/day`, { method: 'PUT', body: { mode: k } }), k === 'friend' ? () => { close(); onFindCover(coverDraft); } : undefined)}><span className="avatar icon"><Icon name={i!} size={20} /></span><div className="grow"><b>{t}</b><div className="small muted">{s}</div></div>{d.mode === k && <span className="tag flag-on">Selected</span>}</button>)}</div>
      <div className="list"><div className="li"><span className="avatar icon"><Icon name="home" size={20} /></span><div className="grow"><b>Graded day care · Verified carer</b><div className="small muted">Later releases (P1 / P2), not available</div></div></div></div></Sheet>}

    {sheet === 'cantcome' && <Sheet onClose={close}><h2>{tr('Help can’t come today')}</h2><p>Sunita is marked unavailable for today.</p>
      <div className="field"><label htmlFor="cr">{tr('Reason (optional, private)')}</label><select id="cr" className="input" value={note} onChange={e => setNote(e.target.value)}><option value="">{tr('Not given')}</option><option>{tr('Unwell')}</option><option>{tr('Family emergency')}</option><option>{tr('Holiday')}</option></select></div>
      <button className="btn primary block" onClick={() => run(() => api(`${H}/day`, { method: 'PUT', body: { helperUnavailable: true, reason: note || undefined } }))}>{tr('Mark unavailable')}</button></Sheet>}

    {sheet === 'leaving' && <Sheet onClose={close}><h2>{tr('Before you go')}</h2><p className="muted small">A 30-second reminder list. Skip it if you’re in a hurry.</p>
      <div className="card">{([['water', 'Water bowl is full'], ['doors', 'Balcony and main door secured'], ['pads', 'Toilet pads in place']] as const).map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={checklist[k]} onChange={e => { const v = e.target.checked; setChecklist(p => ({ ...p, [k]: v })); }} /><span>{l}</span></label>)}
        <div className="field"><label htmlFor="pb">If nobody can come today, who is plan B?</label><select id="pb" className="input" value={planB} onChange={e => setPlanB(e.target.value)}><option value="">Not decided</option><option>I’ll come back myself</option>{(ov ? ov.keyPlans.filter(k => k[0].startsWith('named_person:')).map(k => k[0].slice(13)) : []).map(n => <option key={n}>{n}</option>)}</select></div>
        <div className="field"><label htmlFor="rt">{tr('Expected return')}</label><select id="rt" className="input" value={returnAt} onChange={e => setReturnAt(Number(e.target.value))}>{[1080, 1140, 1200, 1320].map(m => <option key={m} value={m}>{fmt(m)}</option>)}</select></div></div>
      <p className="xs muted">Just a reminder list.</p>
      <div className="btnrow"><button className="btn" onClick={() => run(() => api(`${H}/day/leaving`, { body: { checklist: null, returnAt, planB: planB || null } }))}>{tr('Skip')}</button><button className="btn primary" onClick={() => run(() => api(`${H}/day/leaving`, { body: { checklist, returnAt, planB: planB || null } }))}>{tr('I’m leaving')}</button></div></Sheet>}

    {sheet === 'return' && <Sheet onClose={close}><h2>{tr('Quick return check')}</h2><p className="muted small">One mismatch is never treated as wrongdoing.</p>
      {RQ.map(([k, q, a, b]) => <div key={k} className="card"><b>{q}</b><div className="seg" role="radiogroup" aria-label={q}><button aria-pressed={answers[k] === 0} onClick={() => setAnswers(p => ({ ...p, [k]: 0 }))}>{a}</button><button aria-pressed={answers[k] === 1} onClick={() => setAnswers(p => ({ ...p, [k]: 1 }))}>{b}</button></div></div>)}
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block" disabled={RQ.some(([k]) => answers[k] == null)} onClick={() => run(async () => {
        const r = await api<{ outcomes: { taskId: string; result: string }[]; suggestIncident?: boolean }>(`${H}/day/return-check`, { body: answers });
        const m = r.outcomes.filter(o => o.result === 'matched').length, c = r.outcomes.filter(o => o.result === 'contradicted').length;
        setMsg(`Return check saved. ${m ? m + ' task(s) matched by your check (no helper points). ' : ''}${c ? c + ' mismatch(es): points held while it’s reviewed. ' : ''}${r.suggestIncident ? 'You reported a problem, use SOS to log details.' : ''}`);
      })}>{tr('Save')}</button></Sheet>}

    {sheet === 'timeline' && <Sheet onClose={close}><h2>{tr('Timeline')}</h2><div className="card"><div className="tl">{timeline.map((x, i) => <div key={i} className={`ev ${x.kind === 'signal' ? 'sig' : x.kind}`}><span className="t">{hm(x.at)}</span><span className="d" aria-hidden="true" /><span>{x.text}</span></div>)}</div></div></Sheet>}

    {sheet === 'report' && report && <Sheet onClose={close}>
      <div className={`card ${report.covered.household === 'Covered' ? 'hero' : ''}`}><span className="eyebrow">{report.date}</span><h2>{report.covered.household === 'Covered' ? 'Covered care day' : report.covered.household}</h2>
        {report.covered.pets.map(p => <div key={p.petId} className="small">{petName(p.petId)}: <b>{p.status}</b>{p.why.length ? ', ' + p.why.join('; ') : ''}</div>)}<div className="xs">{report.covered.rule}</div></div>
      {report.covered.household === 'Covered' && <div className="art-stage"><Art name="run" width={150} /></div>}
      <div className="list">{report.tasks.map(t => <div key={t.id} className="li"><span className="mono small">{hm(t.due)}</span><div className="grow"><b>{t.title}</b><div className="xs muted">{petName(t.petId)} · {t.lifecycle}</div></div><Conf state={t.state} label={t.label} /></div>)}</div>
      {ov && <CoverHistory ov={ov} />}
      <div className="card flat small"><b>Calls you placed to Sunita:</b> {report.callsToHelper} · <b>Points from your home today:</b> {report.points.earned}{report.points.held ? ` (${report.points.held} held)` : ''}</div>
      {report.upcomingHealth.length > 0 && <div className="card small"><b>{tr('Coming up')}</b>{report.upcomingHealth.map(h => <div key={h.id}>{h.label} · {petName(h.pet_id)} · {h.next_due}</div>)}</div>}
      <a className="btn primary block" href={`https://wa.me/?text=${encodeURIComponent('Thank you Sunita for looking after the pets today! 🙏')}`} target="_blank" rel="noreferrer">Thank Sunita on WhatsApp</a>
    </Sheet>}

    {sheet === 'incident' && inc && <Sheet onClose={close}><h2>{inc.severity} · {inc.category.replace(/_/g, ' ')}</h2>
      <div className="card">{inc.plan.map((s, i) => <div key={i} className="row small"><span className="mono" style={{ minWidth: 48 }}>+{s.offsetMin}m</span><span className="grow"><b>{s.to.replace('+', ' + ').replace(/_/g, ' ')}</b> · {s.channels.join(', ')}</span><span className={`tag ${s.sent ? 'flag-on' : s.stopped ? 'owner' : ''}`}>{s.sent ? 'Sent' : s.stopped ? 'Stopped' : 'Pending'}</span></div>)}
        <div className="xs muted">Stops when someone taps “I’m on it” or presses 1.</div></div>
      <Banner kind="alert" icon="☎">Call your own vet: <b>{pets[0]?.vet_name}</b> · <span className="mono">{pets[0]?.vet_phone}</span>. Pawsure is not an emergency or vet service.</Banner>
      <div className="field"><label htmlFor="ir">Resolution note (required to close)</label><textarea id="ir" className="input" value={note} onChange={e => setNote(e.target.value)} /></div>
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block" onClick={() => run(() => api(`/v1/households/${hh}/incidents/${inc.id}/resolve`, { body: { note } }))}>{tr('Mark resolved')}</button></Sheet>}

    {sheet === 'sos' && <Sheet onClose={close}><h2>{tr('Report a problem')}</h2>
      <Banner kind="alert" icon="☎">In an emergency, call your vet first: <b>{pets[0]?.vet_name}</b> · <span className="mono">{pets[0]?.vet_phone}</span></Banner>
      {Object.entries(SEV).map(([k, cats]) => <div key={k} className="card"><span className="eyebrow">{k}</span><div className="chips">{cats.map(([id, l]) => <button key={id} className="btn sm" onClick={() => run(() => api(`${H}/incidents`, { body: { category: id, petId: pets[0]?.id } }), () => { close(); setMsg('Reported. Open the incident card above to see who is being told and when.'); })}>{l}</button>)}</div></div>)}</Sheet>}
  </>;
}

/** v1.1.0 fix #2: past tense once a step's time has passed; PRD 10.4: steps already run before the task are not repeated. */
function escText(t: DayTask, now: number) {
  const e = t.esc!; if (e.acknowledged) return 'You’re on it.';
  const step = e.steps.find(s => s.kind === (e.backupExcluded ? 'cover_suggestions' : 'backup_lookin'))!;
  if (step.notRepeated) return 'Your backups were already asked before the task, so they are not alerted again. Tap “I’m on it” or call Sunita.';
  const past = now >= step.at || step.fired;
  if (e.backupExcluded) return past ? `Medicine is never passed to your backup. Cover suggestions were shown at ${fmt(step.at)}.` : `Medicine is never passed to your backup. Cover suggestions at ${fmt(step.at)} if you don’t acknowledge.`;
  return past ? `Your backup was alerted at ${fmt(step.at)}.` : `Your backup is alerted at ${fmt(step.at)} if you don’t acknowledge.`;
}

export function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return <div className="sheet-backdrop" onClick={onClose}><div className="sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>{children}<button className="btn block" onClick={onClose}>{tr('Close')}</button></div></div>;
}
