/** Today (PS-007, PS-012–016, PS-030–036, PS-103, PS-111, PS-121, PS-122). */
import { t as tr } from '../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, fmt, hm, type Helper, type DayTask, type DayView, type DayReport, type Incident, type Pet, type TimelineItem, type Visit, type VisitCodeState } from '../api';
import { AppBar, Art, Banner, Conf, Icon, PetAvatar, personSrc } from '../ui';
import { useCover, CoverAlerts, CoverLineView, TomorrowList, PreDepartureSheet, DelaySheet, CoverHistory, UrgencyTag } from './Cover';

const COVER_LABEL: Record<string, [string, string]> = { Covered: ['Confirmed', 'Covered day'], 'In progress': ['Pending', 'Covered so far'], 'At risk': ['Not confirmed', 'Not covered yet'], 'Not covered': ['Missed', 'Not covered'], Unknown: ['Unknown', 'Unknown, tap Covered'], Excluded: ['Pending', 'No tasks today'] };
const HELP_SUB: Record<string, string> = { tracked: 'Tracked helper · check-ins on WhatsApp', trusted: 'Trusted Helper mode · no check-ins today', uncovered: 'Cover needed', friend: 'A friend is covering' };
const MODE: Record<string, string> = { tracked: 'Sunita (tracked helper)', trusted: 'Sunita, Trusted Helper mode', uncovered: 'Nobody yet, cover needed', friend: 'A friend (Find cover)' };
const SEV: Record<string, [string, string][]> = {
  'S1 Urgent': [['pet_hurt', 'Pet hurt'], ['bite', 'Someone was bitten'], ['collapse_breathing', 'Collapse / breathing trouble'], ['pet_missing', 'Pet missing'], ['door_key_security', 'Door / key problem']],
  'S2 Unwell': [['vomiting', 'Vomiting'], ['not_eating', 'Not eating'], ['limping', 'Limping'], ['unusual_behaviour', 'Unusual behaviour']],
  'S3 Practical': [['food_out', 'Food ran out'], ['water_out', 'Water ran out'], ['pads_out', 'Toilet pads ran out'], ['pet_outside', 'Pet left outside']]
};
const RQ = [['food', 'Food bowl', 'Empty / eaten', 'Untouched'], ['water', 'Water bowl', 'Lower / refilled', 'Same or dry'], ['pad', 'Toilet pad', 'Changed', 'Old'], ['pet', 'Your pets', 'Normal', 'Very hungry or thirsty'], ['damage', 'Anything damaged or wrong?', 'No', 'Yes']] as const;
type SheetKind = null | 'plan' | 'caring' | 'cantcome' | 'leaving' | 'return' | 'timeline' | 'report' | 'sos' | 'resolve' | 'task' | 'incident' | 'change' | 'predeparture' | 'delay';

/** Task type icons and colours follow the prototype (feeding orange, water sky, walk green, toilet teal, medicine lilac). */
const TASK_ICON: Record<string, string> = { feeding: 'food', water: 'water', walk: 'walk', toilet: 'pad', litter: 'litter', medicine: 'pill', other: 'paw' };
/** The carer's avatar: an illustrated portrait from the people set (no photos are stored); no helper shows an empty seat. */
function HelperAvatar({ who, seed = '', name = '' }: { who: 'sunita' | 'helper' | 'friend' | 'none'; seed?: string; name?: string }) {
  // No helper yet: an empty seat waiting for someone, in the sky and coral accents.
  if (who === 'none') return <span className="helper-av none" aria-hidden="true"><svg viewBox="0 0 64 64" width="56" height="56">
    <circle cx="32" cy="32" r="32" fill="var(--sky-soft)" />
    <path d="M12 64c2-11 10-17 20-17s18 6 20 17Z" fill="var(--sky)" opacity=".35" />
    <circle cx="32" cy="29" r="11" fill="var(--sky)" opacity=".35" />
    <circle cx="48" cy="46" r="10" fill="var(--coral)" /><path d="M48 41v10M43 46h10" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
  </svg></span>;
  return <span className="helper-av" aria-hidden="true"><img src={personSrc(seed || who, name)} alt="" width={56} height={56} /></span>;
}
/** Home shows a task as Pending or Completed (or Cancelled); the evidence label is in Task details. */
function StatusPill({ t }: { t: DayTask }) {
  const st = t.ev.state === 'Cancelled' ? 'Cancelled' : ['Confirmed', 'Likely', 'Matched'].includes(t.ev.state) ? 'Completed' : 'Pending';
  return <span className={`st-pill ${st.toLowerCase()}`}>{st === 'Completed' ? '✓ ' : ''}{tr(st)}</span>;
}
const VERB: Record<string, string> = { feeding: 'feed', walk: 'walk', medicine: 'give medicine to', litter: 'clean the litter tray for', toilet: 'change the toilet pad for', water: 'top up water for' };

const d0Tracked = (day: DayView | null) => day?.day.mode === 'tracked';
export function Today({ hh, day, pets, incidents, ownerName, reload, onFindCover, onOpenRequest, onEditRoutine, onAddPet, onAddHelper }: { hh: string; day: DayView | null; pets: Pet[]; incidents: Incident[]; ownerName: string; reload: () => void; onFindCover: (draft?: string) => void; onOpenRequest?: (id: string) => void; onEditRoutine?: () => void; onAddPet?: () => void; onAddHelper?: () => void }) {
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [task, setTask] = useState<DayTask | null>(null);
  const [inc, setInc] = useState<Incident | null>(null);
  const [note, setNote] = useState(''); const [err, setErr] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const [checklist, setChecklist] = useState({ water: false, doors: false, pads: false }); const [returnAt, setReturnAt] = useState(1140);
  const [answers, setAnswers] = useState<Record<string, 0 | 1 | undefined>>({});
  const [timeline, setTimeline] = useState<TimelineItem[]>([]); const [report, setReport] = useState<DayReport | null>(null);
  const [change, setChange] = useState<'Cancelled by owner' | 'Partly done' | 'Skipped with reason'>('Cancelled by owner');
  const [planB, setPlanB] = useState('');
  const [petTab, setPetTab] = useState<string | null>(null);
  // The household's helper (name and whether she has accepted the WhatsApp invite) for "Your help today".
  const [helpers, setHelpers] = useState<Helper[] | null>(null);
  // The helper's invite status follows every refresh of the day (not only when the clock moves),
  // and while an invite is pending it is checked every few seconds, so an accepted invite shows without a reload.
  const loadHelpers = () => api<Helper[]>(`/v1/households/${hh}/helpers`).then(setHelpers).catch(() => setHelpers([]));
  useEffect(() => { loadHelpers(); }, [hh, day]);
  const pendingInvite = !!helpers?.some(h => h.consent === 'pending');
  useEffect(() => { if (!pendingInvite) return; const t = setInterval(loadHelpers, 4000); return () => clearInterval(t); }, [hh, pendingInvite]);
  // The header turns into a compact bar as Home scrolls: --hp goes 0 → 1 over the first 110 px (styles.css).
  const mainRef = useRef<HTMLElement>(null);
  const onScroll = () => { const m = mainRef.current; if (!m) return; (m.closest('.pwa') as HTMLElement | null)?.style.setProperty('--hp', Math.min(1, m.scrollTop / Math.max(1, Math.min(110, m.scrollHeight - m.clientHeight))).toFixed(3)); };
  useEffect(() => () => { (document.querySelector('.pwa') as HTMLElement | null)?.style.removeProperty('--hp'); }, []);
  // The header only sticks when Home has room for it (not when the demo phones squeeze it on a small screen).
  useEffect(() => {
    const m = mainRef.current; if (!m || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { m.toggleAttribute('data-sticky', m.clientHeight >= 360); }); ro.observe(m);
    return () => ro.disconnect();
  }, [day != null]);
  const { ov, load: loadCover } = useCover(hh, day);
  const reloadAll = () => { reload(); loadCover(); };
  const petName = (id: string) => pets.find(p => p.id === id)?.name ?? id;
  const H = `/v1/households/${hh}`;
  const close = () => { setSheet(null); setErr(null); setNote(''); };
  const run = async (fn: () => Promise<unknown>, after?: () => void) => { setErr(null); try { await fn(); reloadAll(); after ? after() : close(); } catch (e) { setErr(e instanceof ApiError ? String(e.body.message ?? e.body.issues ?? e.body.error) : 'Can’t reach Pawsure. Try again.'); } };
  if (!day) return <><AppBar title={tr('Today')} hideTitle /><div className="body"><div className="empty">{tr('Loading today…')}</div></div></>;

  const helperRow = helpers?.find(h => h.status === 'active') ?? helpers?.[0];
  const helperName = helperRow?.name ?? (helpers ? '' : 'Sunita');
  const helperFirst = helperName.split(' ')[0] || tr('Your help');
  const invite = helperRow?.consent;
  /** No helper added yet: Home asks for one first. Heading out, and then the day's tasks, come after. */
  const noHelper = d0Tracked(day) && !!helpers && !helperRow;
  const [cs, cl] = COVER_LABEL[day.covered.household] ?? ['Pending', day.covered.household];
  const alerts = day.tasks.filter(t => t.esc?.open && !t.esc.resolved);
  const openInc = incidents.filter(i => !i.resolved_at);
  const d = day.day;
  // Pre-fill Find cover with the next task the helper would have done (owner edits it before anything is sent).
  const nextTask = day.tasks.find(t => t.due >= day.now - 30 && !['Confirmed', 'Likely', 'Cancelled'].includes(t.ev.state));
  const coverDraft = nextTask ? `${helperFirst} can’t come today. Can someone ${VERB[nextTask.type] ?? 'look after'} ${petName(nextTask.petId)} at ${fmt(nextTask.due).toLowerCase()}?` : undefined;
  const first = ownerName.split(' ')[0];
  // Pet tabs: whose schedule is shown. Pending first (by time), then completed.
  const petId = pets.some(p => p.id === petTab) ? petTab : pets[0]?.id;
  const mine = day.tasks.filter(t => t.petId === petId).sort((a, b) => a.due - b.due);
  const isDone = (t: DayTask) => ['Confirmed', 'Likely', 'Matched', 'Cancelled'].includes(t.ev.state);
  const pending = mine.filter(t => !isDone(t)), completed = mine.filter(isDone);
  /** A task as in the prototype: type icon, title, time as sub text, status pill (cover details are in the task sheet). */
  /** A plain description of what the task involves, from the pet's profile. */
  const taskDescription = (t: DayTask) => {
    const p = pets.find(x => x.id === t.petId); const n = p?.name ?? 'your pet';
    switch (t.type) {
      case 'feeding': return `Feed ${n}: ${p?.food ?? 'the usual meal'}. Rinse and refill the water bowl.`;
      case 'medicine': return `Give ${n} the medicine: ${p?.medicines ?? 'as on the vet’s card'}. Only as written on the vet’s card.`;
      case 'walk': return `Take ${n} for a walk on the lead, about 20 minutes. Bring a poop bag.`;
      case 'toilet': return `Change ${n}’s toilet pad and top up the water bowl.`;
      case 'litter': return `Clean ${n}’s litter tray and top up the water bowl.`;
      case 'water': return `Top up ${n}’s water bowl with fresh water.`;
      default: return `${t.title} for ${n}.`;
    }
  };
  const evidenceCaption = (t: DayTask) => {
    if (t.ev.state === 'Matched') return tr('Marked completed by you');
    const s = t.signals.find(x => x.kind === 'photo' || x.kind === 'friend_photo') ?? t.signals[0];
    const who = s?.kind === 'friend_photo' ? tr('the friend covering') : helperFirst;
    return s ? `${s.kind.includes('photo') ? tr('Photo from') : tr('Check-in from')} ${who} · ${fmt(s.eventTime)}` : tr('Completed');
  };
  const taskCard = (t: DayTask) => <button key={t.id} className={`task tl-row${isDone(t) ? ' done' : ''}`} onClick={() => { setTask(t); setSheet('task'); }}>
    <span className={`task-ic t-${t.type}`} aria-hidden="true"><Icon name={TASK_ICON[t.type] ?? 'paw'} size={22} /></span>
    <span className="grow task-txt"><b className="task-title">{t.title}</b>
      <span className="task-sub">{fmt(t.due)}{t.lifecycle.at(-1)?.state && t.lifecycle.at(-1)?.state !== 'Planned' ? ` · ${t.lifecycle.at(-1)?.state}` : ''}{t.signals.length ? ' · ' + t.signals.map(s => s.kind === 'photo' ? `📷 ${s.code === 'today' ? 'photo + code' : 'photo'}` : s.kind === 'friend_photo' ? '📷 photo' : s.kind).join(' · ') : ''}{t.ev.late ? ` · ${tr('Late')}` : ''}</span></span>
    <StatusPill t={t} /><span className="chev" aria-hidden="true">›</span>
  </button>;
  // Who's caring: the carer's avatar and how far today's help has got (Accepted → Checked in → Completed).
  const inVisit = Object.values(day.visits).some(v => v.arrive != null && v.exit == null);
  const allDone = day.tasks.length > 0 && day.tasks.every(t => ['Confirmed', 'Likely', 'Cancelled'].includes(t.ev.state));
  const carer = {
    steps: (d.mode === 'tracked' || d.mode === 'friend') && !d.helperUnavailable,
    at: allDone ? 2 : inVisit || Object.values(day.visits).some(v => v.arrive != null) ? 1 : 0
  };
  // The helper's status in one word or two (Plan sheet): can't come, invite state, or how far today has got.
  const helpStatus: { text: string; tone: string } = d.helperUnavailable ? { text: 'Can’t come today', tone: 'cancelled' }
    : d.mode === 'trusted' ? { text: 'Trusted Helper mode', tone: 'pending' } : d.mode === 'uncovered' ? { text: 'Cover needed', tone: 'pending' }
    : d.mode === 'tracked' && helperRow && invite !== 'yes' ? { text: invite === 'pending' ? 'Invite pending' : invite === 'notnow' ? 'Said not now' : 'Stopped check-ins', tone: 'pending' }
    : d.mode === 'tracked' && !helperRow && helpers ? { text: 'No helper', tone: 'cancelled' }
    : { text: ['Accepted', 'Checked in', 'Completed'][carer.at]!, tone: carer.at === 2 ? 'completed' : 'pending' };
  const needsCover = d.helperUnavailable || d.mode === 'uncovered' || d.mode === 'friend';

  return <>
    <main className="body today" ref={mainRef} onScroll={onScroll}>
      <header className="today-hero">
        <h1 className="sr-only">{tr('Today')}</h1>
        <div className="th-bg" aria-hidden="true" />
        <div className="th-top">
          <div className="grow"><h2 className="th-greet">{tr('Hi')}, {first} <span className="wave" aria-hidden="true">👋</span></h2><div className="th-date">{tr('Here’s who’s helping today.')}</div></div>
          <button className="th-sos" onClick={() => setSheet('sos')} aria-label="Report a problem or emergency"><Icon name="phone" size={18} />{tr('SOS')}</button>
        </div>
      </header>

      <section className="card caring help-card" aria-label="Your help today">
        <svg className="hc-spark" viewBox="0 0 40 30" aria-hidden="true"><path d="M6 4l3 9M16 10l5 6M26 18l9 1" /></svg>
        <div className="row"><HelperAvatar who={d.mode === 'uncovered' || d.helperUnavailable || (d.mode === 'tracked' && helpers && !helperRow) ? 'none' : d.mode === 'friend' ? 'friend' : /^sunita/i.test(helperName) ? 'sunita' : 'helper'} seed={d.mode === 'friend' ? 'friend' : helperRow?.id ?? helperName} name={d.mode === 'friend' ? '' : helperName} />
          <div className="grow"><span className="eyebrow">{tr('Your help today')}</span><h2>{d.mode === 'uncovered' ? tr('Nobody yet') : d.mode === 'friend' ? tr('A friend (Find cover)') : helperName || tr('No helper added yet')}</h2><div className="small muted">{tr(HELP_SUB[d.mode] ?? MODE[d.mode] ?? d.mode)}</div></div></div>
        {d.mode === 'tracked' && helperRow && invite !== 'yes' && <div className={`invite-pill ${invite}`} role="status">{invite === 'pending' ? <span className="ip-text"><b>⏳ {tr('Invite pending')}</b><span>{tr('WhatsApp message sent. Waiting for her to accept.')}</span></span> : invite === 'notnow' ? <>✋ {tr('She said “not now” to the invite')}</> : <>⏸ {tr('She stopped check-ins')}</>}
          {invite === 'pending' && <button className="btn ghost sm" onClick={() => run(() => api(`${H}/helpers/${helperRow.id}/resend`, { body: {} }), () => setMsg(`Invite sent again to ${helperFirst} on WhatsApp.`))}>{tr('Resend')}</button>}</div>}
        {carer.steps && (d.mode !== 'tracked' || invite === 'yes') && <ol className="help-track" aria-label="Help status">{(['Accepted', 'Checked in', 'Completed'] as const).map((st, i) => <li key={st} className={i < carer.at ? 'done' : i === carer.at ? 'now' : ''} aria-current={i === carer.at ? 'step' : undefined}><span className="ht-dot">{i < carer.at || (i === carer.at && st === 'Completed') ? '✓' : ''}</span>{tr(st)}</li>)}</ol>}
        {d.mode === 'trusted' && <><div className="small muted">No check-ins or alerts today. Tap Covered when it’s done.</div>{day.covered.household !== 'Covered' && <button className="btn primary sm" onClick={() => run(() => api(`${H}/day/trusted-covered`, { body: {} }))}>{tr('Covered')}</button>}</>}
        {d.helperUnavailable && <Banner kind="warn" icon="!">{helperFirst} can’t come today{d.unavailableReason ? ` (${d.unavailableReason})` : ''}. Your original plan is kept.</Banner>}
        {needsCover && <div className="btnrow">{d.helperUnavailable && ov?.preDeparture.warn && !ov.jobs.some(j => j.active) && <button className="btn primary sm" onClick={() => run(() => api(`${H}/day/pre-departure`, { body: { option: 'ask_circle_now' } }))}><Icon name="friends" size={18} />{tr('Ask my backups')}</button>}</div>}
        {noHelper ? <button className="btn primary block" onClick={onAddHelper}><Icon name="plus" size={18} />{tr('Add helper')}</button>
          : <div className="btnrow even"><button className="btn sm" onClick={() => setSheet('caring')}>{tr('Change')}</button>
          {d.mode === 'tracked' && !d.helperUnavailable && <button className="btn sm" onClick={() => setSheet('cantcome')}>{tr('My help can’t come')}</button>}</div>}
      </section>
      {noHelper && <p className="add-helper-note">{tr('Add helper to start tasks.')}</p>}
      {noHelper ? null : d.leftAt == null ? <div className="card flat out-card"><div className="row"><div className="grow"><b>{tr('Heading out?')}</b><div className="small muted">{tr('30-second leaving checklist')}</div><button type="button" className="linkbtn plan-link" aria-label="Plan for today" onClick={() => setSheet('plan')}>{tr('Today’s plan')}</button></div><div className="out-art"><img src={`${import.meta.env.BASE_URL}assets/heading-out-pets.webp`} alt="" width={140} height={104} /><button className="btn primary sm" onClick={() => setSheet(ov?.preDeparture.warn ? 'predeparture' : 'leaving')}>{tr('I’m leaving')}</button></div></div></div>
        : d.backAt == null ? <div className="card flat out-card"><div className="row"><div className="grow"><b>Out since {fmt(d.leftAt)}</b><div className="small muted">Back around {fmt(d.returnAt)}</div><button type="button" className="linkbtn plan-link" aria-label="Plan for today" onClick={() => setSheet('plan')}>{tr('Today’s plan')}</button></div><button className="btn sm" onClick={() => setSheet('delay')}>{tr('I’m delayed')}</button><button className="btn sm" onClick={() => run(async () => { const r = await api<{ returnCheckNeeded: boolean }>(`${H}/day/back`, { body: {} }); setSheet(r.returnCheckNeeded ? 'return' : null); if (!r.returnCheckNeeded) setMsg('Welcome back. Everything had evidence today, no return check needed.'); }, () => {})}>{tr('I’m back')}</button></div></div>
        : !d.returnCheckDone && d.returnCheckNeeded ? <div className="card flat"><div className="row"><b className="grow">{tr('Quick return check (10 s)')}</b><button className="btn primary sm" onClick={() => setSheet('return')}>{tr('Start')}</button></div></div> : null}
      {msg && <Banner kind="info" icon="ℹ">{msg} <button className="btn ghost sm" onClick={() => setMsg(null)}>{tr('Dismiss')}</button></Banner>}
      {/* Alerts appear only when something needs you: cover at risk, an incident, or a missed task. */}
      {ov && <CoverAlerts hh={hh} ov={ov} reload={reloadAll} onFriendFinder={(id) => onOpenRequest ? onOpenRequest(id) : onFindCover()} />}
      {openInc.map(i => <div key={i.id} className="card danger"><div className="row"><b className="grow">{i.severity} · {i.category.replace(/_/g, ' ')}</b><span className={`tag ${i.ack_at ? 'owner' : 'sim'}`}>{i.ack_at ? 'Acknowledged' : 'Not acknowledged'}</span></div>
        <div className="btnrow">{!i.ack_at && <button className="btn danger" onClick={() => run(() => api(`${H}/incidents/${i.id}/ack`, { body: {} }))}>{tr('I’m on it')}</button>}<button className="btn" onClick={() => { setInc(i); setSheet('incident'); }}>{tr('Open')}</button></div></div>)}
      {alerts.map(t => <div key={t.id} className={`card ${t.esc!.acknowledged ? 'info' : 'warn'}`}>
        <div className="row"><b className="grow">{petName(t.petId)} · {t.title}</b><Conf state={t.ev.state} label={t.ev.label} /></div>
        <div className="small">{t.ev.visitOnly ? 'The visit is recorded, but there’s no evidence for this task.' : `No evidence yet. Due ${fmt(t.due)}.`} {escText(t, day.now)}</div>
        <div className="btnrow">{t.esc!.acknowledged ? <button className="btn primary" onClick={() => { setTask(t); setSheet('resolve'); }}>{tr('Mark resolved')}</button> : <button className="btn warn" onClick={() => run(() => api(`${H}/tasks/${t.id}/ack`, { body: {} }))}>{tr('I’m on it')}</button>}
          <button className="btn" onClick={() => run(() => api(`${H}/day/call-helper`, { body: {} }), () => setMsg(`Logged that you called ${helperFirst}. Use your phone to place the call.`))}><Icon name="phone" size={18} />Call {helperFirst}</button></div>
      </div>)}

      {/* The day's tasks appear once the owner has headed out and set the options (Heading out → I'm leaving). */}
      {d.leftAt != null && !noHelper ? <>
      <div className="pet-tabs" role="tablist" aria-label="Whose schedule">
        {pets.map((p, i) => <button key={p.id} role="tab" aria-selected={p.id === petId} className={`petchip pet-tab tone-${i % 4}`} onClick={() => setPetTab(p.id)}>
          <PetAvatar species={p.species} size={40} /><b>{p.name}</b></button>)}
        {onAddPet && <button className="pet-tab add" onClick={onAddPet}><span className="pt-plus" aria-hidden="true"><Icon name="plus" size={20} /></span><b>{tr('Add pet')}</b></button>}
      </div>

      <section role="tabpanel" aria-label={`${petName(petId ?? '')}’s tasks today`} className="task-panel">
        <div className="sec-head"><h2>{tr('Tasks')} <span className="sec-n">{pending.length}</span></h2></div>
        {pending.length ? pending.map(taskCard) : <div className="task-empty">{mine.length ? `${tr('Nothing pending for')} ${petName(petId ?? '')} 🎉` : tr('No tasks today.')}</div>}
        <div className="sec-head"><h2>{tr('Completed')} <span className="sec-n">{completed.length}</span></h2></div>
        {completed.length ? completed.map(taskCard) : <div className="task-empty">{tr('Nothing done yet today.')}</div>}
      </section>
      </> : noHelper ? null : <div className="tasks-locked"><Icon name="list" size={20} /><span>{tr('Your pets’ tasks for today show here once you tap “I’m leaving” and set the options.')}</span></div>}
    </main>

    {sheet === 'plan' && <Sheet onClose={close}>
      <div className="row"><h2 className="grow">{tr('Plan for today')}</h2>{ov?.noCoverPlanned && day.covered.household !== 'Covered' ? <Conf state="Missed" label="No cover planned" /> : <Conf state={cs} label={cl} />}</div>
      <div className="plan-help" aria-label="Your help today"><HelperAvatar who={d.mode === 'uncovered' || d.helperUnavailable || (d.mode === 'tracked' && helpers && !helperRow) ? 'none' : d.mode === 'friend' ? 'friend' : /^sunita/i.test(helperName) ? 'sunita' : 'helper'} seed={d.mode === 'friend' ? 'friend' : helperRow?.id ?? helperName} name={d.mode === 'friend' ? '' : helperName} />
        <div className="grow"><span className="eyebrow">{tr('Your help today')}</span><b>{d.mode === 'friend' ? tr('A friend (Find cover)') : d.mode === 'uncovered' ? tr('Nobody yet') : helperName || tr('No helper added yet')}</b></div>
        <span className={`st-pill ${helpStatus.tone}`}>{tr(helpStatus.text)}</span></div>
      {d.alone.exceeds && <Banner kind="warn" icon="⏱"><b>Alone-window warning.</b> Your pets would be alone {(d.alone.longestMinutes / 60).toFixed(1)} h ({fmt(d.alone.from)}–{fmt(d.alone.to)}). Your limit is {d.alone.limitHours} h. <span className="xs muted">Your own threshold, not medical guidance.</span></Banner>}
      <div className="row wrap" style={{ gap: 4 }}>
        {onEditRoutine && <button className="btn ghost sm" onClick={onEditRoutine}>{tr('Edit routine')}</button>}
        <button className="btn ghost sm" onClick={() => run(async () => { setTimeline(await api<TimelineItem[]>(`${H}/day/timeline`)); setSheet('timeline'); }, () => {})}>{tr('Timeline')}</button>
        <button className="btn ghost sm" onClick={() => run(async () => { setReport(await api<DayReport>(`${H}/day/report`)); setSheet('report'); }, () => {})}>{tr('Day report')}</button></div>
      {ov && <TomorrowList ov={ov} petName={petName} />}
      <p className="xs muted">Cover (who is expected) and evidence (whether it was done) are shown separately. A Yes or a visit alone never confirms a task. Rule {day.tasks[0]?.ev.ruleSet} · {day.covered.rule}</p>
    </Sheet>}

    {sheet === 'task' && task && <Sheet onClose={close}>
      <div className="row"><h2 className="grow">{task.title}</h2><StatusPill t={task} /></div>
      <div className="small muted">{petName(task.petId)} · {fmt(task.due)}{helperRow ? ` · ${helperFirst}` : ''}</div>
      {isDone(task) && task.ev.state !== 'Cancelled'
        ? <TaskProof hh={hh} taskId={task.id} fallback={<figure className="ev-media"><img src={`${import.meta.env.BASE_URL}assets/evidence-bowl.webp`} alt={`${petName(task.petId)} eating from the bowl`} /><figcaption>{evidenceCaption(task)}</figcaption></figure>} />
        : task.ev.state === 'Cancelled' ? <div className="task-desc">{tr('Cancelled for today.')}</div>
        : <>
          <div className="task-desc">{taskDescription(task)}</div>
          <TaskProof hh={hh} taskId={task.id} fallback={<div className="ev-placeholder"><Icon name="camera" size={28} /><span>{helperRow && invite === 'yes' ? `${helperFirst}${tr('’s photo will appear here after she checks in.')}` : tr('A photo will appear here once the task is done.')}</span></div>} />
          <div className="btnrow even"><button className="btn" onClick={() => run(async () => { const r = await api<{ note?: string }>(`${H}/tasks/${task.id}/remind`, { body: {} }); setMsg(r.note ?? 'Reminder sent.'); })}>{tr('Send reminder')}</button>
            <button className="btn primary" onClick={() => run(async () => { await api(`${H}/tasks/${task.id}/owner-done`, { body: {} }); setMsg(`Marked “${task.title}” completed.`); })}>{tr('Mark completed')}</button></div>
          {err && <span className="errtext" role="alert">{err}</span>}
        </>}
      {task.visitId && day.visits[task.visitId]?.status && <VisitTime v={day.visits[task.visitId]!} />}
      <details className="task-more"><summary>{tr('Task details')}</summary>
      <div className="row"><span className="eyebrow grow">{tr('Evidence')}</span><Conf state={task.ev.state} label={task.ev.label} /></div>
      <div className="small muted">{petName(task.petId)} · due {fmt(task.due)}{task.movedFrom != null ? ` (moved from ${fmt(task.movedFrom)})` : ''} · {task.profile} escalation{task.profile === 'medicine' ? ' (never to backup)' : ''} <UrgencyTag u={task.urgency} /></div>
      {!task.cover && <CoverLineView line={ov?.lines[task.id]} />}
      {task.cover && <div className="card"><span className="eyebrow">Cover (who is expected) · separate from evidence</span><div className="row"><b className="grow">{task.cover.label}</b></div><CoverLineView line={ov?.lines[task.id]} /><div className="xs muted">{tr('A Yes is a plan, not proof the task was done.')}</div></div>}
      {task.visitId && day.visits[task.visitId]?.status && <div className="card flat"><span className="eyebrow">Visit evidence (separate from the task)</span>{day.visits[task.visitId]!.reasons.map(r => <div key={r} className="xs mono">{r}</div>)}</div>}
      <div className="card flat"><span className="eyebrow">Why this label</span>{task.ev.reasons.map(r => <div key={r} className="xs mono">{r}</div>)}</div>
      {task.esc && <div className="card"><span className="eyebrow">Escalation ladder</span>{task.esc.steps.map(s => <div key={s.n} className="row small"><span className="mono" style={{ minWidth: 60 }}>{fmt(s.at)}</span><span className="grow">{s.kind.replace(/_/g, ' ')}</span><span className={`tag ${s.fired ? 'flag-on' : s.stoppedByAck || s.notRepeated ? 'owner' : ''}`}>{s.fired ? 'Sent' : s.stoppedByAck ? 'Stopped' : s.notRepeated ? 'Not repeated (asked before the task)' : 'Pending'}</span></div>)}</div>}
      <div className="card"><span className="eyebrow">Lifecycle (append-only)</span>{task.lifecycle.map((l, i) => <div key={i} className="row small"><span className="mono muted" style={{ minWidth: 48 }}>{hm(l.at)}</span><span className="grow"><b>{l.state}</b> · {l.actor}{l.note ? ', ' + l.note : ''}</span></div>)}</div>
      <div className="small"><b>Helper points:</b> {task.points.kind === 'earn' ? `+${task.points.points}` : task.points.kind === 'hold' ? 'held (review, max 7 days)' : (task.points.reason ?? '').replace(/_/g, ' ')}</div>
      <div className="btnrow">{task.visitId && d.gateApp && <button className="btn sm" onClick={() => run(() => api(`${H}/visits/${task.visitId}/gate`, { body: {} }))}>Attach my gate-app alert</button>}
        {task.ev.state !== 'Cancelled' && <button className="btn sm" onClick={() => setSheet('change')}>{tr('Change this task')}</button>}</div>
      <p className="xs muted">Gate alerts are marked as from you.</p>
      </details>
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
      <div className="list">{[['tracked', 'user', `Own helper: ${helperFirst} (tracked)`, 'Check-ins on WhatsApp or missed call; alerts if something is missed'], ['trusted', 'heart', 'Trusted Helper mode', 'No check-ins, alerts or points. You tap Covered later; no tap = Unknown'], ['uncovered', 'alert', 'Nobody yet', 'Shows “cover needed”; your plan is kept'], ['friend', 'search', 'A friend', 'Ask your own friends. Nothing is sent until you approve']].map(([k, i, t, s]) =>
        <button key={k} className="li" onClick={() => run(() => api(`${H}/day`, { method: 'PUT', body: { mode: k } }), k === 'friend' ? () => { close(); onFindCover(coverDraft); } : undefined)}><span className="avatar icon"><Icon name={i!} size={20} /></span><div className="grow"><b>{t}</b><div className="small muted">{s}</div></div>{d.mode === k && <span className="tag flag-on">Selected</span>}</button>)}</div>
      <div className="list"><div className="li"><span className="avatar icon"><Icon name="home" size={20} /></span><div className="grow"><b>Graded day care · Verified carer</b><div className="small muted">Later releases (P1 / P2), not available</div></div></div></div></Sheet>}

    {sheet === 'cantcome' && <Sheet onClose={close}><h2>{tr('Help can’t come today')}</h2><p>{helperFirst} is marked unavailable for today.</p>
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

interface ProofRow { photo: string | null; code: string; by: string; channel: string; at: string }
const CODE_TEXT: Record<string, string> = { today: '✓ today’s code', old: '✕ an old code', wrong: '✕ wrong code', none: 'no code' };
/** The owner sees every proof photo for the task: who sent it, when, and whether today's code matched. */
/** When the helper's visit started and ended (arrival and exit calls) and how long it lasted, against the minimum for its tasks. */
function VisitTime({ v }: { v: Visit }) {
  const min = `${tr('minimum')} ${v.minimum} min`;
  const text = v.arrive != null && v.exit != null ? `${hm(v.arrive)}–${hm(v.exit)} · ${v.duration} min (${min})`
    : v.arrive != null ? `${tr('Started')} ${hm(v.arrive)} · ${tr('no exit call yet')} (${min})`
    : v.exit != null ? `${tr('Ended')} ${hm(v.exit)} · ${tr('no arrival call')} (${min})` : null;
  if (!text) return null;
  const codes = v.codes && (v.codes.start || v.codes.end) ? <div className="visit-codes xs">{(['start', 'end'] as const).map(p => { const s = v.codes![p]; return s ? <span key={p} className={`vc ${s}`}>{tr(p === 'start' ? 'Start code' : 'End code')}: {tr(CODE_WORD[s])}</span> : null; })}</div> : null;
  return <><div className={`visit-time small${v.duration != null && v.duration < v.minimum ? ' short' : ''}`}><b>{tr('Visit')}</b> {text}{v.status && <b className="vt-status"> · {tr(v.status === 'In progress' ? 'Visit in progress' : 'Visit ' + v.status.toLowerCase())}</b>}</div>{codes}</>;
}
/** The random code sent at the arrival / exit call, and whether her photo of it came back in time. */
const CODE_WORD: Record<VisitCodeState, string> = { ok: 'photo matched ✓', late: 'photo came late', wrong: 'code didn’t match', waiting: 'waiting for photo', missing: 'no photo sent' };

function TaskProof({ hh, taskId, fallback }: { hh: string; taskId: string; fallback?: ReactNode }) {
  const [rows, setRows] = useState<ProofRow[] | null>(null);
  useEffect(() => { api<ProofRow[]>(`/v1/households/${hh}/tasks/${taskId}/proof`).then(setRows).catch(() => setRows([])); }, [hh, taskId]);
  if (!rows?.length) return <>{fallback ?? null}</>;
  return <div className="card flat"><span className="eyebrow">Proof photos</span><div className="proofs">
    {rows.map((r, i) => <figure key={i}>{r.photo ? <img src={r.photo} alt={`Proof from ${r.by}`} /> : <div className="proof-photo" style={{ height: 100 }}>Deleted after 90 days</div>}
      <figcaption><b>{r.by.split(' ')[0]}</b> · {new Date(r.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}<br /><span className={r.code === 'today' ? 'ok' : r.code === 'none' ? 'muted' : 'errtext'}>{CODE_TEXT[r.code] ?? r.code}</span></figcaption></figure>)}
  </div></div>;
}
