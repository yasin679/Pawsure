/** Find cover — F4 Ask Pawsure, F5 suggestions, approval, request detail (PS-055–068, PS-123, PS-125). */
import { t as tr } from '../i18n';
import { useEffect, useState } from 'react';
import { api, ApiError, fmt, hm, type FFTask, type Pet, type ReqView, type SearchResult } from '../api';
import { AppBar, Art, Banner, Icon, PersonAvatar } from '../ui';

const TASKS: [FFTask, string][] = [['feed', 'Feed'], ['walk', 'Short walk'], ['meds', 'Medicine'], ['water', 'Water'], ['litter', 'Litter tray'], ['toilet', 'Toilet pad']];
const EXAMPLES: [string, string][] = [['Clear request', 'I am stuck in a meeting until 8. Can someone feed Bruno and take him down at 5?'], ['Medicine + vague time', 'Can someone give Bruno his medicine this evening and let themselves in?'], ['Urgent', 'Can someone feed Bruno and Misty right now? Spare key with Ankita.']];
const STATE_CLS: Record<string, string> = { Draft: 'c-pending', 'Ready for search': 'c-pending', 'Awaiting owner approval': 'c-pending', Sent: 'c-likely', 'Accepted - pending owner confirmation': 'c-notconfirmed', 'Provisional hold': 'c-notconfirmed', Confirmed: 'c-confirmed', Completed: 'c-confirmed', Declined: 'c-cancelled', Expired: 'c-cancelled', Cancelled: 'c-cancelled', 'Cancelled by friend': 'c-mismatch', 'No-show': 'c-missed', Interrupted: 'c-mismatch' };
export const StateTag = ({ s }: { s: string }) => <span className={`conf ${STATE_CLS[s] ?? 'c-pending'}`}>{s}</span>;
const REC: Record<string, string> = { sent: 'Waiting', accepted: 'Said yes', waiting: 'Said yes, waiting (no double booking)', proposed: 'Suggested another time', unclear: 'Replied unclearly, asked again', declined: 'Declined', expired: 'No reply, expired', withdrawn: 'Closed politely', released: 'Hold released', confirmed: 'Confirmed', cancelled: 'Cancelled after confirming' };
/** PAW-012: the exact time of an event, in India time, to the second. */
const exact = (ts?: string) => ts ? new Date(ts).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
/** PAW-004: the latest three events, with the rest one tap away. */
function History({ items }: { items: ReqView['history'] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(-3);
  return <div className="card flat"><div className="row"><span className="eyebrow grow">{tr('Event history')}</span>{items.length > 3 && <button className="btn ghost sm" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? 'Show latest 3' : `View all (${items.length})`}</button>}</div>
    {!all && items.length > 3 && <div className="xs muted">{items.length - 3} earlier events hidden</div>}
    {shown.map((x, i) => <div key={i} className="row small top"><span className="mono muted" style={{ minWidth: 92 }} title={x.ts}>{exact(x.ts) || hm(x.at)}</span><span className="grow"><b>{x.state}</b>{x.note ? ', ' + x.note : ''}</span></div>)}</div>;
}
/** PAW-013: the simple form survives switching tabs (the typed request text already does). */
let manualDraft: { tasks: FFTask[]; petId: string; petIds?: string[]; time: number; access: string } | null = null;

type View = { k: 'ask' } | { k: 'review'; id: string } | { k: 'manual'; id?: string; reason?: string } | { k: 'suggest'; id: string } | { k: 'approve'; id: string; ids: string[]; mode: 'one' | 'all3' } | { k: 'request'; id: string };

/** Pawly: the friendly name for the friend search. It shows its steps while the normal, rules-based search runs. */
const PAWLY_STEPS = (time: string) => ['Reading your request', `Checking who’s free at ${time}`, 'Matching tasks, pets and keys', 'Picking the closest friends'];
function PawlyThinking({ step, time }: { step: number; time: string }) {
  return <><AppBar title={tr('Pawly')} /><main className="body pawly-think" aria-live="polite">
    <div className="pawly-orb" aria-hidden="true"><span>✦</span></div>
    <h2>{tr('Pawly is finding a friend')}</h2>
    <ul className="pawly-steps">{PAWLY_STEPS(time).map((t, i) => <li key={t} className={i < step ? 'done' : i === step ? 'now' : ''}><span className="dot">{i < step ? '✓' : ''}</span>{t}</li>)}</ul>
    <p className="xs muted">{tr('Only your own friends. Nothing is sent until you approve.')}</p>
  </main></>;
}

export function FindCover({ hh, pets, draft, onDraft, openRequest, onOpened, onInvite, prefer, onPreferUsed }: { hh: string; pets: Pet[]; draft: string; onDraft: (s: string) => void; openRequest?: string | null; onOpened?: () => void; onInvite?: () => void; prefer?: string | null; onPreferUsed?: () => void }) {
  const [thinking, setThinking] = useState<{ step: number; time: string } | null>(null); const [byPawly, setByPawly] = useState(false);
  const [v, setV] = useState<View>({ k: 'ask' });
  const [reqs, setReqs] = useState<ReqView[]>([]); const [req, setReq] = useState<ReqView | null>(null); const [sr, setSr] = useState<SearchResult | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [approved, setApproved] = useState(false); const [sel, setSel] = useState<string[]>([]);
  useEffect(() => { if (!openRequest) return; (async () => { try { const r = await api<SearchResult>(`/v1/households/${hh}/requests/${openRequest}/search`, { body: {} }); setSr(r); setReq(r.request); setSel([]); setApproved(false); setV({ k: 'suggest', id: openRequest } as View); } catch (e) { setErr(e instanceof ApiError ? String(e.body.message ?? e.body.error) : 'Can’t reach Pawsure.'); } onOpened?.(); })(); }, [openRequest]);
  const [manual, setManualState] = useState<{ tasks: FFTask[]; petId: string; petIds?: string[]; time: number; access: string }>(manualDraft ?? { tasks: [], petId: pets[0]?.id ?? '', time: 1080, access: 'Key handover' });
  const setManual = (f: (m: typeof manual) => typeof manual) => setManualState(m => (manualDraft = f(m)));
  const [dupErr, setDupErr] = useState<string | null>(null);
  const H = `/v1/households/${hh}`;
  const loadList = () => api<ReqView[]>(`${H}/requests`).then(setReqs).catch(() => {});
  const loadReq = async (id: string) => { const r = await api<ReqView>(`${H}/requests/${id}`); setReq(r); return r; };
  useEffect(() => { if (v.k === 'ask') loadList(); if (v.k === 'request' || v.k === 'review') loadReq(v.id); }, [v]);
  useEffect(() => { if (v.k !== 'request') return; const t = setInterval(() => loadReq(v.id), 5000); return () => clearInterval(t); }, [v]);
  const run = async (fn: () => Promise<void>) => { if (busy) return; setErr(null); setDupErr(null); setBusy(true); try { await fn(); } catch (e) { if (e instanceof ApiError && e.body.duplicateOf) setDupErr(String(e.body.duplicateOf)); setErr(e instanceof ApiError ? (e.body.error === 'clarification_needed' ? 'Answer the highlighted questions first.' : e.body.error === 'not_eligible' ? 'That friend is no longer eligible. Search again.' : String(e.body.message ?? e.body.error)) : 'Can’t reach Pawsure.'); } finally { setBusy(false); } };
  const petName = (id: string | null) => pets.find(p => p.id === id)?.name ?? '';
  /** The friend picked in the assistant: once a search finds them, go straight to the message for them. */
  const showResults = (r: SearchResult, pawly: boolean) => {
    setSr(r); setSel([]); setByPawly(pawly);
    if (prefer && r.top.some(t => t.id === prefer)) { setApproved(false); setV({ k: 'approve', id: r.request.id, ids: [prefer], mode: 'one' }); onPreferUsed?.(); }
    else setV({ k: 'suggest', id: r.request.id });
  };
  /** Ask in the assistant hands over the request: understand it at once instead of showing the blank form. */
  const understand = () => run(async () => { const r = await api<ReqView>(`${H}/requests`, { body: { text: draft } }); if (r.needsManualForm) setV({ k: 'manual', reason: r.fallbackReason }); else { setReq(r); setV({ k: 'review', id: r.id }); } });
  useEffect(() => { if (prefer && draft.trim()) understand(); }, []);
  /** Run the normal search with Pawly's steps on screen (about 5.5 s, so each step can be read). */
  const askPawly = (time: number | null | undefined, go: () => Promise<SearchResult>) => run(async () => {
    const t0 = Date.now(); setThinking({ step: 0, time: time != null ? fmt(time) : 'that time' });
    const iv = setInterval(() => setThinking(s => s && { ...s, step: Math.min(s.step + 1, 4) }), 1300);
    try {
      const r = await go(); const wait = 5600 - (Date.now() - t0); if (wait > 0) await new Promise(res => setTimeout(res, wait));
      showResults(r, true);
    } finally { clearInterval(iv); setThinking(null); }
  });
  /** PAW-033: every pet on the request. */
  const petIdsOf = (x: { petId: string | null; petIds?: string[] }) => x.petIds?.length ? x.petIds : x.petId ? [x.petId] : [];
  const petNames = (x: { petId: string | null; petIds?: string[] }) => petIdsOf(x).map(petName).join(' and ');
  const summary = (r: ReqView) => r.parsed ? `${r.parsed.tasks.map(t => TASKS.find(x => x[0] === t)?.[1]).join(' + ')} for ${petNames(r.parsed)}${(r.taskTime ?? r.parsed.time) != null ? ' at ' + fmt((r.taskTime ?? r.parsed.time)!) : ''}` : (r.text ?? '');
  const startVoice = () => {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => { lang: string; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; start(): void } }).webkitSpeechRecognition;
    if (!SR) { setErr('Voice input isn’t available in this browser. Type instead.'); return; }
    const r = new SR(); r.lang = 'en-IN'; r.onresult = (e) => onDraft(e.results[0]![0].transcript); r.start();
  };

  if (thinking) return <PawlyThinking step={thinking.step} time={thinking.time} />;
  if (v.k === 'review' && req) {
    const p = req.parsed;
    const patch = (body: unknown) => run(async () => setReq(await api<ReqView>(`${H}/requests/${req.id}`, { method: 'PATCH', body })));
    return <><AppBar title={tr('Check the details')} onBack={() => setV({ k: 'ask' })} /><main className="body">
      <div className="card flat small"><span className="eyebrow">{tr('You said')}</span>“{req.text}”</div>
      {!!req.petChanged?.length && <Banner kind="info" icon="↻"><b>{petName(p?.petId ?? null) || 'Your pet'}’s profile changed since you wrote this</b> ({req.petChanged.join(', ')}). Search uses the latest details from the pet profile.</Banner>}
      {req.clarifications.map(c => <div key={c.field} className="card warn" role="alert"><b>{c.question}</b><div className="chips">{c.options.map(o => <button key={o.value} className="btn sm" onClick={() => patch({ clarify: { field: c.field, value: o.value } })}>{o.label}</button>)}</div></div>)}
      {p && <div className="card"><span className="eyebrow">{tr('Pawsure understood. Tap to correct')}</span>
        <div className="chips">{TASKS.map(([k, l]) => <button key={k} className={`tag ${p.tasks.includes(k) ? 'flag-on' : 'flag-off'}`} aria-pressed={p.tasks.includes(k)} onClick={() => patch({ fields: { tasks: p.tasks.includes(k) ? p.tasks.filter(t => t !== k) : [...p.tasks, k] } })}>{p.tasks.includes(k) ? '✓ ' : '+ '}{l}</button>)}</div>
        <div className="grid2">{pets.length > 1 ? <fieldset className="field"><legend>{tr('Pets')}</legend>{pets.map(x => <label key={x.id} className="check"><input type="checkbox" checked={petIdsOf(p).includes(x.id)} onChange={e => { const cur = petIdsOf(p); const next = e.target.checked ? [...cur, x.id] : cur.filter(y => y !== x.id); if (next.length) patch({ fields: { petIds: next } }); }} /><span>{x.name}</span></label>)}</fieldset>
          : <div className="field"><label htmlFor="rp">{tr('Pet')}</label><select id="rp" className="input" value={p.petId ?? ''} onChange={e => patch({ fields: { petId: e.target.value } })}>{pets.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>}
          <div className="field"><label htmlFor="rt">{tr('Time')}</label><select id="rt" className="input" value={p.time ?? ''} onChange={e => patch({ fields: { time: Number(e.target.value) } })}>{p.time == null && <option value="">{tr('Needs an answer')}</option>}{p.time != null && p.time % 30 !== 0 && <option value={p.time}>{fmt(p.time)}</option>}{Array.from({ length: 34 }, (_, i) => 420 + i * 30).map(m => <option key={m} value={m}>{fmt(m)}</option>)}</select></div></div>
        <div className="grid2"><div className="field"><label htmlFor="rd">{tr('Duration')}</label><select id="rd" className="input" value={p.durationMin} onChange={e => patch({ fields: { durationMin: Number(e.target.value) } })}>{[5, 10, 15, 20, 25, 30, 45].map(m => <option key={m} value={m}>{m} min</option>)}</select></div>
          <div className="field"><label htmlFor="ra">{tr('Access')}</label><select id="ra" className="input" value={p.access ?? ''} onChange={e => patch({ fields: { access: e.target.value } })}>{!p.access && <option value="">{tr('Needs an answer')}</option>}{['Key handover', 'Someone at home', 'Friend has key'].map(a => <option key={a}>{a}</option>)}</select></div></div>
        <div className="xs muted">{[p.sources.time && 'Time: ' + p.sources.time, p.sources.access && 'Access: ' + p.sources.access, p.sources.pet && 'Pet: ' + p.sources.pet].filter(Boolean).join(' · ')}</div></div>}
      {p?.tasks.includes('meds') && <Banner kind="info" icon="✚">{tr('Medicine goes only to friends who chose it, with your written instructions.')}</Banner>}
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn pawly block lg" disabled={busy || req.blocked.length > 0} onClick={() => askPawly(req.parsed?.time, () => api<SearchResult>(`${H}/requests/${req.id}/search`, { body: {} }))}><span aria-hidden="true">✦</span> Find with Pawly</button>
      <button className="btn ghost block" disabled={busy || req.blocked.length > 0} onClick={() => run(async () => showResults(await api<SearchResult>(`${H}/requests/${req.id}/search`, { body: {} }), false))}>{tr('Search my friends')}</button>
      {req.blocked.length > 0 && <p className="xs muted">Search is blocked until the highlighted questions are answered.</p>}
      <button className="btn ghost block" onClick={() => setV({ k: 'manual', id: req.id })}>{tr('Use the simple form instead')}</button>
    </main></>;
  }

  if (v.k === 'manual') return <><AppBar title={tr('Simple request form')} onBack={() => setV({ k: 'ask' })} /><main className="body">
    {v.reason && <Banner kind="warn" icon="⚙"><b>{v.reason}.</b> Use this form instead, matching works exactly the same.</Banner>}
    <div className="card"><span className="eyebrow">{tr('What needs doing?')}</span>{TASKS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={manual.tasks.includes(k)} onChange={e => { const on = e.target.checked; setManual(m => ({ ...m, tasks: on ? [...m.tasks, k] : m.tasks.filter(t => t !== k) })); }} /><span>{l}</span></label>)}</div>
    {pets.length > 1 && <div className="card"><span className="eyebrow">{tr('Which pets?')}</span>{pets.map(x => { const cur = manual.petIds?.length ? manual.petIds : [manual.petId]; return <label key={x.id} className="check"><input type="checkbox" checked={cur.includes(x.id)} onChange={e => { const on = e.target.checked; setManual(m => { const c0 = m.petIds?.length ? m.petIds : [m.petId]; const next = on ? [...c0, x.id] : c0.filter(y => y !== x.id); return next.length ? { ...m, petId: next[0]!, petIds: next } : m; }); }} /><span>{x.name} <span className="xs muted">{x.species}</span></span></label>; })}<span className="xs muted">Only friends happy with this many pets are suggested.</span></div>}
    <div className="grid2">{pets.length <= 1 && <div className="field"><label htmlFor="mp">{tr('Pet')}</label><select id="mp" className="input" value={manual.petId} onChange={e => { const val = e.target.value; setManual(m => ({ ...m, petId: val })); }}>{pets.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>}
      <div className="field"><label htmlFor="mt">{tr('Time')}</label><select id="mt" className="input" value={manual.time} onChange={e => { const val = Number(e.target.value); setManual(m => ({ ...m, time: val })); }}>{Array.from({ length: 34 }, (_, i) => 420 + i * 30).map(m => <option key={m} value={m}>{fmt(m)}</option>)}</select></div></div>
    <div className="field"><label htmlFor="mk">{tr('Key needed?')}</label><select id="mk" className="input" value={manual.access} onChange={e => { const val = e.target.value; setManual(m => ({ ...m, access: val })); }}><option value="Key handover">{tr('Yes, key handover')}</option><option value="Someone at home">{tr('No, someone is home')}</option></select></div>
    {err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn pawly block lg" disabled={busy || !manual.tasks.length} onClick={() => askPawly(manual.time, async () => { const r = await api<ReqView>(`${H}/requests`, { body: { manual } }); manualDraft = null; return api<SearchResult>(`${H}/requests/${r.id}/search`, { body: {} }); })}><span aria-hidden="true">✦</span> Find with Pawly</button>
    <button className="btn ghost block" disabled={busy || !manual.tasks.length} onClick={() => run(async () => { const r = await api<ReqView>(`${H}/requests`, { body: { manual } }); manualDraft = null; showResults(await api<SearchResult>(`${H}/requests/${r.id}/search`, { body: {} }), false); })}>{tr('Search my friends')}</button>
  </main></>;

  if (v.k === 'suggest' && sr) {
    const ex = Object.entries(sr.excludedCounts), nEx = ex.reduce((a, [, n]) => a + n, 0);
    if (!sr.top.length) return <><AppBar title={tr('No friend free')} onBack={() => setV({ k: 'ask' })} /><main className="body">
      <div className="nofriend">
        <img src={`${import.meta.env.BASE_URL}assets/mascot-family.png`} width={150} height={146} alt="" />
        <h2>{tr('No friend is free right now')}</h2>
        <p className="muted">{byPawly ? 'Pawly checked all your friends.' : 'We checked all your friends.'} None of them can do this one: {summary(sr.request)}.</p>
      </div>
      <div className="list">
        <button className="li" onClick={() => setV({ k: 'review', id: sr.request.id })}><span className="avatar icon"><Icon name="list" size={20} /></span><div className="grow"><b>{tr('Try another time')}</b><div className="small muted">{tr('Someone may be free a little later')}</div></div><span className="chev">›</span></button>
        <button className="li" onClick={() => askPawly(sr.request.parsed?.time, async () => { await api(`${H}/requests/${sr.request.id}`, { method: 'PATCH', body: { maxBand: 3 } }); return api<SearchResult>(`${H}/requests/${sr.request.id}/search`, { body: {} }); })}><span className="avatar icon"><Icon name="search" size={20} /></span><div className="grow"><b>{tr('Search any distance')}</b><div className="small muted">{tr('Include friends further away')}</div></div><span className="chev">›</span></button>
        {onInvite && <button className="li" onClick={onInvite}><span className="avatar icon"><Icon name="friends" size={20} /></span><div className="grow"><b>{tr('Invite a friend')}</b><div className="small muted">{tr('More friends, more chances next time')}</div></div><span className="chev">›</span></button>}
        <a className="li" href={`tel:${pets[0]?.backup_phone?.replace(/\s/g, '') ?? ''}`}><span className="avatar icon"><Icon name="phone" size={20} /></span><div className="grow"><b>{tr('Call your backup')}</b><div className="small muted">{pets[0]?.backup_name ?? 'Your backup'}</div></div><span className="chev">›</span></a>
      </div>
      {nEx > 0 && <details className="card flat small"><summary><b>Why {nEx} friends weren’t suggested</b></summary>{ex.map(([k, n]) => <div key={k}>{n} · {k}</div>)}<div className="xs muted">{tr('Declining never counts against anyone.')}</div></details>}
      <div className="card flat"><div className="row"><b className="grow">{tr('Nearby ID-checked members')}</b><span className="tag flag-off">{tr('Switch OFF')}</span></div><div className="xs muted">{sr.nearbyFallback.reason}</div></div>
    </main></>;
    return <><AppBar title={tr('Suggestions')} onBack={() => setV({ k: 'review', id: sr.request.id })} /><main className="body">
      {prefer && !sr.top.some(t => t.id === prefer) && <Banner kind="info" icon="ℹ">The friend you picked can’t do this one at that time. Here are others who can.</Banner>}
      {byPawly && <div className="pawly-found"><span aria-hidden="true">✦</span> Pawly found {sr.top.length} {sr.top.length === 1 ? 'friend' : 'friends'} who can help</div>}
      <div className="card flat small"><b>{summary(sr.request)}</b> · {sr.request.parsed?.access}<br /><span className="xs muted">{tr('Your own friends only. Nearest first.')}</span></div>
      {sr.request.duplicateOf && <Banner kind="warn" icon="!"><b>You already have a request out to friends for this.</b> Same pet, about the same time. <button className="btn sm" onClick={() => setV({ k: 'request', id: sr.request.duplicateOf! })}>{tr('Open it')}</button></Banner>}
      {sr.top.map((t, i) => <div key={t.id} className="card"><div className="row"><PersonAvatar seed={t.id} name={t.name} /><div className="grow"><b>{i + 1}. {t.name}</b><div className="small muted">{t.distance} · {({ en: 'English', hi: 'Hindi', mr: 'Marathi' } as Record<string, string>)[t.language]}</div></div>
        <label className="check" style={{ padding: 0 }}><input type="checkbox" aria-label={'Select ' + t.name} checked={sel.includes(t.id)} onChange={e => { const on = e.target.checked; setSel(s => on ? [...s, t.id] : s.filter(x => x !== t.id)); }} /></label></div>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{t.reasons.slice(0, 3).map(r => <li key={r}>{r}</li>)}</ul>
        <button className="btn sm primary" onClick={() => { setApproved(false); setV({ k: 'approve', id: sr.request.id, ids: [t.id], mode: 'one' }); }}>Ask {t.name.split(' ')[0]}</button></div>)}
      {nEx > 0 && <details className="card flat small"><summary><b>{nEx} friends not shown</b>, why</summary>{ex.map(([k, n]) => <div key={k}>{n} · {k}</div>)}<div className="xs muted">{tr('Declining never counts against anyone.')}</div></details>}
      {sr.top.length > 1 && <button className="btn dark block" onClick={() => { setApproved(false); setV({ k: 'approve', id: sr.request.id, ids: sel.length > 1 ? sel : sr.top.map(t => t.id), mode: 'all3' }); }}>Ask {sel.length > 1 ? `these ${sel.length}` : `all ${sr.top.length}`}</button>}
      <p className="xs muted">{tr('Ranked by distance, free time, tasks and keys.')}</p></main></>;
  }

  if (v.k === 'approve' && sr) {
    const list = sr.top.filter(t => v.ids.includes(t.id));
    return <><AppBar title={v.mode === 'all3' ? `Ask ${list.length} friends?` : `Ask ${list[0]?.name.split(' ')[0]}?`} onBack={() => setV({ k: 'suggest', id: v.id })} /><main className="body">
      {v.mode === 'all3' && <Banner kind="info" icon="ℹ">The same request goes to {list.map(t => t.name.split(' ')[0]).join(', ')}. <b>The first valid Yes</b> is held for 10 minutes while you confirm.</Banner>}
      {list.map(t => <div key={t.id} className="card"><div className="row"><PersonAvatar seed={t.id} name={t.name} /><b className="grow">{t.name}</b><span className="tag">{({ en: 'English', hi: 'Hindi', mr: 'Marathi' } as Record<string, string>)[t.language]}</span></div>
        <div className="bub in" style={{ maxWidth: '100%', boxShadow: 'none', border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}>{t.message}</div>
        {t.language !== 'en' && <div className="xs muted">Meaning: {summary(sr.request)}. Access details only after you confirm. Yes / No / another time.</div>}</div>)}
      <div className="card flat small">{tr('Address and key details are shared only after you confirm.')}</div>
      <label className="check"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} /><span>I approve sending {list.length > 1 ? `these ${list.length} messages` : 'this message'}</span></label>
      {err && <span className="errtext" role="alert">{err}</span>}
      {dupErr && <button className="btn sm" onClick={() => setV({ k: 'request', id: dupErr })}>Open the active request</button>}
      {err && /Search again/.test(err) && <button className="btn sm" onClick={() => run(async () => { setSr(await api<SearchResult>(`${H}/requests/${v.id}/search`, { body: {} })); setSel([]); setV({ k: 'suggest', id: v.id }); })}>{tr('Search again')}</button>}
      <button className="btn primary block" disabled={!approved || busy} onClick={() => run(async () => { await api(`${H}/requests/${v.id}/approve`, { body: { friendIds: v.ids, mode: v.mode, approved: true } }); setV({ k: 'request', id: v.id }); })}>{tr('Send on WhatsApp')}</button>
    </main></>;
  }

  if (v.k === 'request' && req) {
    const act = (path: string, body: unknown = {}) => run(async () => { setReq(await api<ReqView>(`${H}/requests/${req.id}/${path}`, { body })); });
    return <><AppBar title={tr('Request')} onBack={() => setV({ k: 'ask' })} /><main className="body">
      <div className="card"><div className="row"><b className="grow">{summary(req)}</b><StateTag s={req.state} /></div>
        {req.origin && <div className="small origin"><b>{req.origin.text}</b></div>}
        <div className="small muted">{req.mode === 'all3' ? 'Ask all' : 'One friend'} · understood by {req.parsedBy ?? (req.parser === 'manual' ? 'simple form' : 'rules')}{req.correctedFields.length ? ' · you corrected: ' + req.correctedFields.join(', ') : ''}</div>
        {req.state === 'Provisional hold' && req.holdAt != null && <div className="small"><b>Hold ends {fmt(req.holdAt + 10)}.</b> If you don’t confirm, it’s released and others can accept.</div>}
        {req.searchClosesAt != null && ['Sent', 'Provisional hold', 'Accepted - pending owner confirmation'].includes(req.state) && <div className="xs muted">Search closes at {fmt(req.searchClosesAt)} (30 min before the task).</div>}</div>
      {req.recipients.length > 0 && <div className="list">{req.recipients.map(r => <div key={r.friendId} className="li"><PersonAvatar seed={r.friendId} name={r.name ?? ''} /><div className="grow"><b>{r.name}</b><div className="small muted">{r.state === 'sent' ? `Waiting · expires ${fmt(r.sentAt + 15)}${r.reminded ? ' · reminded' : ''}` : r.state === 'proposed' ? `Suggested ${fmt(r.proposal!)}` : REC[r.state]}</div></div>
        {['accepted', 'proposed'].includes(r.state) && !req.confirmedFriendId && <button className="btn sm primary" disabled={busy} onClick={() => act('confirm', { friendId: r.friendId })}>{r.state === 'proposed' ? 'Confirm ' + hm(r.proposal!) : 'Confirm'}</button>}</div>)}</div>}
      {req.state === 'Confirmed' && <div className="card"><span className="eyebrow">Shared with {req.confirmedName?.split(' ')[0]}, minimum needed, this visit only</span><div className="small">Flat, key, pet notes and the emergency card, for this visit only.</div></div>}
      {req.state === 'Confirmed' && req.lateMin ? <Banner kind="warn" icon="⏱">{req.confirmedName?.split(' ')[0]} is running about {req.lateMin} min late. New arrival about {fmt((req.taskTime ?? 0) + req.lateMin)}. Keep the visit, or cancel and ask your backups.</Banner> : null}
      {req.state === 'Interrupted' && <Banner kind="alert" icon="!"><b>{req.confirmedName?.split(' ')[0] ?? 'Your friend'} had an emergency and left.</b> {req.doneTasks?.length ? `Finished: ${req.doneTasks.map(t => TASKS.find(x => x[0] === t)?.[1] ?? t).join(', ')}. ` : 'Nothing was finished. '}Your backups are being asked for the rest now, see Cover. Access details were removed.</Banner>}
      {req.state === 'No-show' && <Banner kind="alert" icon="!">No check-in from {req.confirmedName} by {fmt((req.taskTime ?? 0) + 20)}. Your backup has been alerted. This stays private.</Banner>}
      {req.state === 'Cancelled by friend' && <Banner kind="alert" icon="!">{req.confirmedName ?? 'The friend'} cancelled. Access details were removed and a new search was opened without them, see Requests.</Banner>}
      {['Declined', 'Expired'].includes(req.state) && <Banner kind="warn" icon="!">Nobody accepted. <button className="btn sm" onClick={() => setV({ k: 'review', id: req.id })}>{tr('Try again')}</button></Banner>}
      {req.state === 'Completed' && <div className="card hero"><b>Done, thank you, {req.confirmedName?.split(' ')[0]}!</b><a className="btn" href={`https://wa.me/?text=${encodeURIComponent('Thank you so much for helping today! 🙏')}`} target="_blank" rel="noreferrer">{tr('Thank on WhatsApp')}</a><div className="small">Thank-you points: switched off until funding is approved.</div></div>}
      {err && <span className="errtext" role="alert">{err}</span>}
      <div className="btnrow">
        {req.editable && <button className="btn primary" onClick={() => setV({ k: 'review', id: req.id })}>{tr('Edit request')}</button>}
        {['Sent', 'Provisional hold', 'Accepted - pending owner confirmation', 'Confirmed', 'Awaiting owner approval', 'Ready for search', 'Draft'].includes(req.state) && <button className="btn" disabled={busy} onClick={() => act('cancel')}>{tr('Cancel request')}</button>}
        {['Confirmed', 'Provisional hold', 'Accepted - pending owner confirmation'].includes(req.state) && req.taskTime != null && <button className="btn" disabled={busy} onClick={() => act('change-time', { time: req.taskTime! + 30 })}>Change time +30 min</button>}
      </div>
      {!req.editable && ['Sent', 'Provisional hold', 'Accepted - pending owner confirmation', 'Confirmed'].includes(req.state) && <p className="xs muted">Already sent, so it can’t be edited. Cancel and ask again, or change the time once someone says yes.</p>}
      <History items={req.history} />
    </main></>;
  }

  return <><AppBar title={tr('Find cover')} /><main className="body">
    <div className="card"><span className="eyebrow">{tr('Ask Pawsure')}</span><label htmlFor="ask" className="sr">{tr('Describe what you need')}</label>
      <textarea id="ask" className="input" value={draft} onChange={e => onDraft(e.target.value)} placeholder={tr('e.g. Can someone feed Bruno and take him down at 5?')} />
      <div className="row"><button className="btn sm" onClick={startVoice} aria-label="Speak your request"><Icon name="bell" size={16} />{tr('Speak')}</button><span className="xs muted grow">{tr('Typing always works.')}</span></div>
      <div className="chips">{EXAMPLES.map(([l, t]) => <button key={l} className="tag" onClick={() => onDraft(t)}>{l}</button>)}</div>
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block" disabled={busy || !draft.trim()} onClick={understand}>{tr(busy ? 'Understanding… (up to 8 s)' : 'Understand my request')}</button>
      <div className="row"><span className="xs muted grow">{tr('Nothing is sent until you approve.')}</span><button className="btn ghost sm" onClick={() => setV({ k: 'manual' })}>{tr('Simple form')}</button></div></div>
    <h2 style={{ fontSize: 'var(--fs-l)' }}>{tr('Requests')}</h2>
    {reqs.length ? <div className="list">{reqs.map(r => <button key={r.id} className="li" onClick={() => setV(r.state === 'Draft' && r.parsed ? { k: 'review', id: r.id } : { k: 'request', id: r.id })}><div className="grow"><b>{summary(r) || 'Request'}</b><div className="small muted">{r.recipients.map(x => x.name?.split(' ')[0]).join(', ') || 'not sent'}</div></div><StateTag s={r.state} /></button>)}</div>
      : <div className="empty"><Art name="sleep" width={170} /><b>{tr('No requests yet')}</b><span>{tr('Ask in your own words. Nothing is sent until you approve it.')}</span></div>}
  </main></>;
}
