/** Find cover — F4 Ask Pawsure, F5 suggestions, approval, request detail (PS-055–068, PS-123, PS-125). */
import { useEffect, useState } from 'react';
import { api, ApiError, fmt, hm, type FFTask, type Pet, type ReqView, type SearchResult } from '../api';
import { AppBar, Art, Banner, Icon } from '../ui';

const TASKS: [FFTask, string][] = [['feed', 'Feed'], ['walk', 'Short walk'], ['meds', 'Medicine'], ['water', 'Water'], ['litter', 'Litter tray'], ['toilet', 'Toilet pad']];
const EXAMPLES: [string, string][] = [['Clear request', 'I am stuck in a meeting until 8. Can someone feed Bruno and take him down at 5?'], ['Medicine + vague time', 'Can someone give Bruno his medicine this evening and let themselves in?'], ['Urgent', 'Can someone feed Bruno and Misty right now? Spare key with Ankita.']];
const STATE_CLS: Record<string, string> = { Draft: 'c-pending', 'Ready for search': 'c-pending', 'Awaiting owner approval': 'c-pending', Sent: 'c-likely', 'Accepted - pending owner confirmation': 'c-notconfirmed', 'Provisional hold': 'c-notconfirmed', Confirmed: 'c-confirmed', Completed: 'c-confirmed', Declined: 'c-cancelled', Expired: 'c-cancelled', Cancelled: 'c-cancelled', 'Cancelled by friend': 'c-mismatch', 'No-show': 'c-missed' };
export const StateTag = ({ s }: { s: string }) => <span className={`conf ${STATE_CLS[s] ?? 'c-pending'}`}>{s}</span>;
const REC: Record<string, string> = { sent: 'Waiting', accepted: 'Said yes', waiting: 'Said yes — waiting (no double booking)', proposed: 'Suggested another time', unclear: 'Replied unclearly — asked again', declined: 'Declined', expired: 'No reply — expired', withdrawn: 'Closed politely', released: 'Hold released', confirmed: 'Confirmed', cancelled: 'Cancelled after confirming' };
type View = { k: 'ask' } | { k: 'review'; id: string } | { k: 'manual'; id?: string; reason?: string } | { k: 'suggest'; id: string } | { k: 'approve'; id: string; ids: string[]; mode: 'one' | 'all3' } | { k: 'request'; id: string };

export function FindCover({ hh, pets, draft, onDraft }: { hh: string; pets: Pet[]; draft: string; onDraft: (s: string) => void }) {
  const [v, setV] = useState<View>({ k: 'ask' });
  const [reqs, setReqs] = useState<ReqView[]>([]); const [req, setReq] = useState<ReqView | null>(null); const [sr, setSr] = useState<SearchResult | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [approved, setApproved] = useState(false); const [sel, setSel] = useState<string[]>([]);
  const [manual, setManual] = useState<{ tasks: FFTask[]; petId: string; time: number; access: string }>({ tasks: [], petId: pets[0]?.id ?? '', time: 1080, access: 'Key handover' });
  const H = `/v1/households/${hh}`;
  const loadList = () => api<ReqView[]>(`${H}/requests`).then(setReqs).catch(() => {});
  const loadReq = async (id: string) => { const r = await api<ReqView>(`${H}/requests/${id}`); setReq(r); return r; };
  useEffect(() => { if (v.k === 'ask') loadList(); if (v.k === 'request' || v.k === 'review') loadReq(v.id); }, [v]);
  useEffect(() => { if (v.k !== 'request') return; const t = setInterval(() => loadReq(v.id), 5000); return () => clearInterval(t); }, [v]);
  const run = async (fn: () => Promise<void>) => { setErr(null); setBusy(true); try { await fn(); } catch (e) { setErr(e instanceof ApiError ? (e.body.error === 'clarification_needed' ? 'Answer the highlighted questions first.' : e.body.error === 'not_eligible' ? 'That friend is no longer eligible. Search again.' : String(e.body.message ?? e.body.error)) : 'Can’t reach Pawsure.'); } finally { setBusy(false); } };
  const petName = (id: string | null) => pets.find(p => p.id === id)?.name ?? '';
  const summary = (r: ReqView) => r.parsed ? `${r.parsed.tasks.map(t => TASKS.find(x => x[0] === t)?.[1]).join(' + ')} for ${petName(r.parsed.petId)}${r.parsed.time != null ? ' at ' + fmt(r.parsed.time) : ''}` : (r.text ?? '');
  const startVoice = () => {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => { lang: string; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; start(): void } }).webkitSpeechRecognition;
    if (!SR) { setErr('Voice input isn’t available in this browser. Type instead.'); return; }
    const r = new SR(); r.lang = 'en-IN'; r.onresult = (e) => onDraft(e.results[0]![0].transcript); r.start();
  };

  if (v.k === 'review' && req) {
    const p = req.parsed;
    const patch = (body: unknown) => run(async () => setReq(await api<ReqView>(`${H}/requests/${req.id}`, { method: 'PATCH', body })));
    return <><AppBar title="Check the details" onBack={() => setV({ k: 'ask' })} /><main className="body">
      <div className="card flat small"><span className="eyebrow">You said</span>“{req.text}”</div>
      {req.clarifications.map(c => <div key={c.field} className="card warn" role="alert"><b>{c.question}</b><div className="chips">{c.options.map(o => <button key={o.value} className="btn sm" onClick={() => patch({ clarify: { field: c.field, value: o.value } })}>{o.label}</button>)}</div></div>)}
      {p && <div className="card"><span className="eyebrow">Pawsure understood — tap to correct</span>
        <div className="chips">{TASKS.map(([k, l]) => <button key={k} className={`tag ${p.tasks.includes(k) ? 'flag-on' : 'flag-off'}`} aria-pressed={p.tasks.includes(k)} onClick={() => patch({ fields: { tasks: p.tasks.includes(k) ? p.tasks.filter(t => t !== k) : [...p.tasks, k] } })}>{p.tasks.includes(k) ? '✓ ' : '+ '}{l}</button>)}</div>
        <div className="grid2"><div className="field"><label htmlFor="rp">Pet</label><select id="rp" className="input" value={p.petId ?? ''} onChange={e => patch({ fields: { petId: e.target.value } })}>{pets.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div className="field"><label htmlFor="rt">Time</label><select id="rt" className="input" value={p.time ?? ''} onChange={e => patch({ fields: { time: Number(e.target.value) } })}>{p.time == null && <option value="">Needs an answer</option>}{p.time != null && p.time % 30 !== 0 && <option value={p.time}>{fmt(p.time)}</option>}{Array.from({ length: 34 }, (_, i) => 420 + i * 30).map(m => <option key={m} value={m}>{fmt(m)}</option>)}</select></div></div>
        <div className="grid2"><div className="field"><label htmlFor="rd">Duration</label><select id="rd" className="input" value={p.durationMin} onChange={e => patch({ fields: { durationMin: Number(e.target.value) } })}>{[5, 10, 15, 20, 25, 30, 45].map(m => <option key={m} value={m}>{m} min</option>)}</select></div>
          <div className="field"><label htmlFor="ra">Access</label><select id="ra" className="input" value={p.access ?? ''} onChange={e => patch({ fields: { access: e.target.value } })}>{!p.access && <option value="">Needs an answer</option>}{['Key handover', 'Someone at home', 'Friend has key'].map(a => <option key={a}>{a}</option>)}</select></div></div>
        <div className="xs muted">{[p.sources.time && 'Time: ' + p.sources.time, p.sources.access && 'Access: ' + p.sources.access, p.sources.pet && 'Pet: ' + p.sources.pet].filter(Boolean).join(' · ')}</div></div>}
      {p?.tasks.includes('meds') && <Banner kind="info" icon="✚">Medicine requests only go to friends who chose “Medicines”. They get your written instructions; Pawsure never suggests a dose.</Banner>}
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block" disabled={busy || req.blocked.length > 0} onClick={() => run(async () => { setSr(await api<SearchResult>(`${H}/requests/${req.id}/search`, { body: {} })); setSel([]); setV({ k: 'suggest', id: req.id }); })}>Search my friends</button>
      {req.blocked.length > 0 && <p className="xs muted">Search is blocked until the highlighted questions are answered.</p>}
      <button className="btn ghost block" onClick={() => setV({ k: 'manual', id: req.id })}>Use the simple form instead</button>
    </main></>;
  }

  if (v.k === 'manual') return <><AppBar title="Simple request form" onBack={() => setV({ k: 'ask' })} /><main className="body">
    {v.reason && <Banner kind="warn" icon="⚙"><b>{v.reason}.</b> Use this form instead — matching works exactly the same.</Banner>}
    <div className="card"><span className="eyebrow">What needs doing?</span>{TASKS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={manual.tasks.includes(k)} onChange={e => { const on = e.target.checked; setManual(m => ({ ...m, tasks: on ? [...m.tasks, k] : m.tasks.filter(t => t !== k) })); }} /><span>{l}</span></label>)}</div>
    <div className="grid2"><div className="field"><label htmlFor="mp">Pet</label><select id="mp" className="input" value={manual.petId} onChange={e => { const val = e.target.value; setManual(m => ({ ...m, petId: val })); }}>{pets.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
      <div className="field"><label htmlFor="mt">Time</label><select id="mt" className="input" value={manual.time} onChange={e => { const val = Number(e.target.value); setManual(m => ({ ...m, time: val })); }}>{Array.from({ length: 34 }, (_, i) => 420 + i * 30).map(m => <option key={m} value={m}>{fmt(m)}</option>)}</select></div></div>
    <div className="field"><label htmlFor="mk">Key needed?</label><select id="mk" className="input" value={manual.access} onChange={e => { const val = e.target.value; setManual(m => ({ ...m, access: val })); }}><option value="Key handover">Yes — key handover</option><option value="Someone at home">No — someone is home</option></select></div>
    {err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn primary block" disabled={busy || !manual.tasks.length} onClick={() => run(async () => { const r = await api<ReqView>(`${H}/requests`, { body: { manual } }); setSr(await api<SearchResult>(`${H}/requests/${r.id}/search`, { body: {} })); setSel([]); setV({ k: 'suggest', id: r.id }); })}>Search my friends</button>
  </main></>;

  if (v.k === 'suggest' && sr) {
    const ex = Object.entries(sr.excludedCounts), nEx = ex.reduce((a, [, n]) => a + n, 0);
    if (!sr.top.length) return <><AppBar title="No friend is free" onBack={() => setV({ k: 'ask' })} /><main className="body">
      <div className="card flat small">{summary(sr.request)}</div>
      <div className="empty"><Art name="box" width={140} /><b>None of your friends can do this right now.</b><span>We won’t guess or contact anyone you haven’t chosen.</span></div>
      {nEx > 0 && <details className="card flat small"><summary><b>{nEx} friends not shown</b> — why</summary>{ex.map(([k, n]) => <div key={k}>{n} · {k}</div>)}<div className="xs muted">Names aren’t shown. Declining or pausing never counts against anyone.</div></details>}
      <div className="card"><span className="eyebrow">Safe next steps</span><div className="stack">
        <button className="btn" onClick={() => setV({ k: 'review', id: sr.request.id })}>Try a different time</button>
        <button className="btn" onClick={() => run(async () => { await api(`${H}/requests/${sr.request.id}`, { method: 'PATCH', body: { maxBand: 3 } }); setSr(await api<SearchResult>(`${H}/requests/${sr.request.id}/search`, { body: {} })); })}>Widen to any distance</button>
        <a className="btn" href={`tel:${pets[0]?.backup_phone?.replace(/\s/g, '') ?? ''}`}>Call your backup</a></div></div>
      <div className="card flat"><div className="row"><b className="grow">Nearby ID-checked members</b><span className="tag flag-off">Switch OFF</span></div><div className="xs muted">{sr.nearbyFallback.reason}</div></div>
      <p className="xs muted">{sr.laterOptions}</p></main></>;
    return <><AppBar title="Suggestions" onBack={() => setV({ k: 'review', id: sr.request.id })} /><main className="body">
      <div className="card flat small"><b>{summary(sr.request)}</b> · {sr.request.parsed?.access}<br /><span className="xs muted">Your own friends only. Nearest first. No paid placement, ever.</span></div>
      {sr.top.map((t, i) => <div key={t.id} className="card"><div className="row"><span className="avatar">{t.name[0]}</span><div className="grow"><b>{i + 1}. {t.name}</b><div className="small muted">{t.distance} · {({ en: 'English', hi: 'Hindi', mr: 'Marathi' } as Record<string, string>)[t.language]}</div></div>
        <label className="check" style={{ padding: 0 }}><input type="checkbox" aria-label={'Select ' + t.name} checked={sel.includes(t.id)} onChange={e => { const on = e.target.checked; setSel(s => on ? [...s, t.id] : s.filter(x => x !== t.id)); }} /></label></div>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{t.reasons.map(r => <li key={r}>{r}</li>)}</ul>
        <button className="btn sm primary" onClick={() => { setApproved(false); setV({ k: 'approve', id: sr.request.id, ids: [t.id], mode: 'one' }); }}>Ask {t.name.split(' ')[0]}</button></div>)}
      {nEx > 0 && <details className="card flat small"><summary><b>{nEx} friends not shown</b> — why</summary>{ex.map(([k, n]) => <div key={k}>{n} · {k}</div>)}<div className="xs muted">Names aren’t shown. Declining or pausing never counts against anyone.</div></details>}
      {sr.top.length > 1 && <button className="btn dark block" onClick={() => { setApproved(false); setV({ k: 'approve', id: sr.request.id, ids: sel.length > 1 ? sel : sr.top.map(t => t.id), mode: 'all3' }); }}>Ask {sel.length > 1 ? `these ${sel.length}` : `all ${sr.top.length}`}</button>}
      <p className="xs muted">Ranking uses only distance band, free time, task choices, key readiness and consented reply history.</p></main></>;
  }

  if (v.k === 'approve' && sr) {
    const list = sr.top.filter(t => v.ids.includes(t.id));
    return <><AppBar title={v.mode === 'all3' ? `Ask ${list.length} friends?` : `Ask ${list[0]?.name.split(' ')[0]}?`} onBack={() => setV({ k: 'suggest', id: v.id })} /><main className="body">
      {v.mode === 'all3' && <Banner kind="info" icon="ℹ">The same request goes to {list.map(t => t.name.split(' ')[0]).join(', ')}. <b>The first valid Yes</b> is held for 10 minutes while you confirm; the others see “waiting for the owner to confirm”. When you confirm, the rest are closed politely.</Banner>}
      {list.map(t => <div key={t.id} className="card"><div className="row"><span className="avatar">{t.name[0]}</span><b className="grow">{t.name}</b><span className="tag">{({ en: 'English', hi: 'Hindi', mr: 'Marathi' } as Record<string, string>)[t.language]}</span></div>
        <div className="bub in" style={{ maxWidth: '100%', boxShadow: 'none', border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}>{t.message}</div>
        {t.language !== 'en' && <div className="xs muted">Meaning: {summary(sr.request)}. Access details only after you confirm. Yes / No / another time.</div>}</div>)}
      <div className="card flat small">Not included until you confirm: flat number, key location, emergency card, when the home is empty.</div>
      <label className="check"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} /><span>I approve sending {list.length > 1 ? `these ${list.length} messages` : 'this message'}</span></label>
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block" disabled={!approved || busy} onClick={() => run(async () => { await api(`${H}/requests/${v.id}/approve`, { body: { friendIds: v.ids, mode: v.mode, approved: true } }); setV({ k: 'request', id: v.id }); })}>Send on WhatsApp</button>
    </main></>;
  }

  if (v.k === 'request' && req) {
    const act = (path: string, body: unknown = {}) => run(async () => { setReq(await api<ReqView>(`${H}/requests/${req.id}/${path}`, { body })); });
    return <><AppBar title="Request" onBack={() => setV({ k: 'ask' })} /><main className="body">
      <div className="card"><div className="row"><b className="grow">{summary(req)}</b><StateTag s={req.state} /></div>
        <div className="small muted">{req.mode === 'all3' ? 'Ask all' : 'One friend'} · parsed by {req.parser === 'manual' ? 'simple form' : 'AI (structured)'}{req.correctedFields.length ? ' · you corrected: ' + req.correctedFields.join(', ') : ''}</div>
        {req.state === 'Provisional hold' && req.holdAt != null && <div className="small"><b>Hold ends {fmt(req.holdAt + 10)}.</b> If you don’t confirm, it’s released and others can accept.</div>}
        {req.searchClosesAt != null && ['Sent', 'Provisional hold', 'Accepted - pending owner confirmation'].includes(req.state) && <div className="xs muted">Search closes at {fmt(req.searchClosesAt)} (30 min before the task).</div>}</div>
      {req.recipients.length > 0 && <div className="list">{req.recipients.map(r => <div key={r.friendId} className="li"><span className="avatar">{r.name?.[0]}</span><div className="grow"><b>{r.name}</b><div className="small muted">{r.state === 'sent' ? `Waiting · expires ${fmt(r.sentAt + 15)}${r.reminded ? ' · reminded' : ''}` : r.state === 'proposed' ? `Suggested ${fmt(r.proposal!)}` : REC[r.state]}</div></div>
        {['accepted', 'proposed'].includes(r.state) && !req.confirmedFriendId && <button className="btn sm primary" onClick={() => act('confirm', { friendId: r.friendId })}>{r.state === 'proposed' ? 'Confirm ' + hm(r.proposal!) : 'Confirm'}</button>}</div>)}</div>}
      {req.state === 'Confirmed' && <div className="card"><span className="eyebrow">Shared with {req.confirmedName?.split(' ')[0]} — minimum needed, this visit only</span><div className="small">Flat number, key arrangement, pet food and fears, emergency card during the visit. Removed automatically afterwards.</div></div>}
      {req.state === 'No-show' && <Banner kind="alert" icon="!">No check-in from {req.confirmedName} by {fmt((req.taskTime ?? 0) + 20)}. Your backup has been alerted. This stays private.</Banner>}
      {req.state === 'Cancelled by friend' && <Banner kind="alert" icon="!">{req.confirmedName ?? 'The friend'} cancelled. Access details were removed and a new search was opened without them — see Requests.</Banner>}
      {['Declined', 'Expired'].includes(req.state) && <Banner kind="warn" icon="!">Nobody accepted. <button className="btn sm" onClick={() => setV({ k: 'review', id: req.id })}>Try again</button></Banner>}
      {req.state === 'Completed' && <div className="card hero"><b>Done — thank you, {req.confirmedName?.split(' ')[0]}!</b><a className="btn" href={`https://wa.me/?text=${encodeURIComponent('Thank you so much for helping today! 🙏')}`} target="_blank" rel="noreferrer">Thank on WhatsApp</a><div className="small">Thank-you points: switched off until funding is approved.</div></div>}
      {err && <span className="errtext" role="alert">{err}</span>}
      <div className="btnrow">
        {['Sent', 'Provisional hold', 'Accepted - pending owner confirmation', 'Confirmed', 'Awaiting owner approval', 'Ready for search', 'Draft'].includes(req.state) && <button className="btn" onClick={() => act('cancel')}>Cancel request</button>}
        {['Confirmed', 'Provisional hold', 'Accepted - pending owner confirmation'].includes(req.state) && req.taskTime != null && <button className="btn" onClick={() => act('change-time', { time: req.taskTime! + 30 })}>Change time +30 min</button>}
      </div>
      <div className="card flat"><span className="eyebrow">Event history</span>{req.history.map((x, i) => <div key={i} className="row small top"><span className="mono muted" style={{ minWidth: 48 }}>{hm(x.at)}</span><span className="grow"><b>{x.state}</b>{x.note ? ' — ' + x.note : ''}</span></div>)}</div>
    </main></>;
  }

  return <><AppBar title="Find cover" /><main className="body">
    <div className="card"><span className="eyebrow">Ask Pawsure</span><label htmlFor="ask" className="sr">Describe what you need</label>
      <textarea id="ask" className="input" value={draft} onChange={e => onDraft(e.target.value)} placeholder="e.g. Can someone feed Bruno and take him down at 5?" />
      <div className="row"><button className="btn sm" onClick={startVoice} aria-label="Speak your request"><Icon name="bell" size={16} />Speak</button><span className="xs muted grow">Typing always works.</span></div>
      <div className="chips">{EXAMPLES.map(([l, t]) => <button key={l} className="tag" onClick={() => onDraft(t)}>{l}</button>)}</div>
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block" disabled={busy || !draft.trim()} onClick={() => run(async () => { const r = await api<ReqView>(`${H}/requests`, { body: { text: draft } }); if (r.needsManualForm) setV({ k: 'manual', reason: r.fallbackReason }); else { setReq(r); setV({ k: 'review', id: r.id }); } })}>{busy ? 'Understanding… (up to 8 s)' : 'Understand my request'}</button>
      <div className="row"><span className="xs muted grow">Pawsure checks your own friends first and sends nothing until you approve.</span><button className="btn ghost sm" onClick={() => setV({ k: 'manual' })}>Simple form</button></div></div>
    <h2 style={{ fontSize: 'var(--fs-l)' }}>Requests</h2>
    {reqs.length ? <div className="list">{reqs.map(r => <button key={r.id} className="li" onClick={() => setV(['Draft'].includes(r.state) && r.parsed ? { k: 'review', id: r.id } : { k: 'request', id: r.id })}><div className="grow"><b>{summary(r) || 'Request'}</b><div className="small muted">{r.recipients.map(x => x.name?.split(' ')[0]).join(', ') || 'not sent'}</div></div><StateTag s={r.state} /></button>)}</div>
      : <div className="empty"><Art name="sleep" width={170} /><b>No requests yet</b><span>Ask in your own words. Nothing is sent until you approve it.</span></div>}
  </main></>;
}
