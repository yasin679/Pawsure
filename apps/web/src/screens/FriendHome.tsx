/** The friend’s side (F6 requests, F7 settings). Shown when a signed-in user is a friend, not a household member. */
import { useEffect, useState } from 'react';
import { api, ApiError, fmt, type FriendSelf } from '../api';
import { LanguageOptions, AppBar, Art, Banner } from '../ui';
import { ProofSheet } from './Proof';

const CAP: [string, string, string?][] = [['feed', 'Feeding / water'], ['walk', 'Short walks'], ['meds', 'Medicines', 'Only with the owner’s written instructions'], ['large', 'Large / anxious dogs']];
interface Access { flat: string; tower: string; access: string; pet: Record<string, string>; notice: string }
const TASK_LABEL: Record<string, string> = { feed: 'Fed', walk: 'Walk', meds: 'Medicine', water: 'Water', litter: 'Litter', toilet: 'Toilet pad' };
const day = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** Free-time choices across the whole day; an end before the start means overnight (R-13). */
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i * 30);

export function FriendHome({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const [me, setMe] = useState<FriendSelf | null>(null); const [tab, setTab] = useState<'requests' | 'settings'>('requests');
  const [text, setText] = useState(''); const [access, setAccess] = useState<Record<string, Access | string>>({}); const [msg, setMsg] = useState<string | null>(null); const [live, setLive] = useState(false);
  const [proofFor, setProofFor] = useState<{ id: string; hh?: string } | null>(null);
  const [late, setLate] = useState(15); const [sos, setSos] = useState<string | null>(null); const [doneNow, setDoneNow] = useState<string[]>([]);
  const load = () => api<FriendSelf>('/v1/me/friend').then(setMe);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  const save = async (body: Record<string, unknown>) => {
    try {
      const r = await api<{ removedFromSearch?: string; nearbyNote?: string; pauseActive?: boolean; resumesOn?: string | null; stillConfirmed?: number }>('/v1/me/friend', { method: 'PUT', body });
      const kept = r.stillConfirmed ? ` Your ${r.stillConfirmed} confirmed visit${r.stillConfirmed > 1 ? 's stay' : ' stays'} booked; cancel ${r.stillConfirmed > 1 ? 'them' : 'it'} separately if you can’t go.` : '';
      setMsg(r.removedFromSearch ? 'You’re no longer findable. Removed from search immediately.' : r.nearbyNote ?? ('pauseDays' in body || 'paused' in body ? (r.pauseActive ? (r.resumesOn ? `Paused. No new requests until ${day(r.resumesOn)}.` : 'Paused. No new requests until you turn this off.') + kept : 'Requests are back on.') : 'Saved.'));
    } catch (e) { setMsg(e instanceof ApiError ? String(e.body.message ?? 'Check your choices and try again.') : 'Can’t reach Pawsure.'); }
    load();
  };
  if (!me) return <><AppBar title="Pawsure" /><main className="body"><div className="empty">Loading…</div></main></>;
  const p = me.profile;
  return <>
    <AppBar title={tab === 'requests' ? 'Requests for you' : 'My helper settings'} />
    <main className="body">
      <div className="seg">{[['requests', 'Requests'], ['settings', 'My settings (F7)']].map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k as 'requests')}>{l}</button>)}</div>
      {msg && <Banner kind="info" icon="ℹ">{msg}</Banner>}
      {me.links.filter(l => l.status === 'invited').map(l => <div key={l.household_id} className="card info"><b>{l.owner.split(' ')[0]} ({l.society.split(',')[0]}, {l.tower}) invited you</b>
        <div className="small">You still choose if and when you help.</div>
        <button className="btn primary sm" onClick={() => api(`/v1/me/friend/links/${l.household_id}/accept`, { body: {} }).then(load)}>Accept</button></div>)}

      {tab === 'requests' && <>{me.requests.length ? me.requests.map(r => <div key={r.id} className="card">
        <div className="bub in" style={{ maxWidth: '100%', boxShadow: 'none', border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}>{r.message}</div>
        <div className="small muted">Status: {r.confirmedForMe ? 'confirmed, thank you!' : r.myState === 'sent' ? 'waiting for your reply' : r.myState}</div>
        {r.state === 'Interrupted' && <div className="small muted">This visit was interrupted. Thank you for letting the owner know.</div>}
        {r.myState === 'sent' || r.myState === 'unclear' ? <>
          {(r as { handlingNote?: string | null }).handlingNote && <div className="hnote"><b>Handling note, please read first</b><br />{(r as { handlingNote?: string }).handlingNote}<label className="check"><input type="checkbox" checked={!!(r as { noteRead?: boolean }).noteRead} onChange={() => api(`/v1/me/requests/${r.id}/reply`, { body: { reply: 'read' } }).then(load)} /><span>I have read this</span></label></div>}
          <div className="btnrow"><button className="btn primary" disabled={!!(r as { handlingNote?: string | null }).handlingNote && !(r as { noteRead?: boolean }).noteRead} onClick={() => api(`/v1/me/requests/${r.id}/reply`, { body: { reply: 'yes' } }).then(load)}>Yes</button><button className="btn" onClick={() => api(`/v1/me/requests/${r.id}/reply`, { body: { reply: 'no' } }).then(() => { setMsg('Thanks for letting them know. Declining never counts against you.'); load(); })}>No</button></div>
          <div className="row"><input className="input" aria-label="Suggest another time" placeholder="Another time, e.g. 5:30" value={text} onChange={e => setText(e.target.value)} /><button className="btn sm" onClick={() => api(`/v1/me/requests/${r.id}/reply`, { body: { reply: 'propose', text } }).then(() => { setText(''); load(); })}>Send</button></div></> : null}
        {r.confirmedForMe && r.state === 'Confirmed' && <>
          {typeof access[r.id] === 'object' ? (() => { const a = access[r.id] as Access; return <div className="card flat small"><b>Flat {a.flat}, {a.tower}</b><div>{a.access}</div><div>{a.pet.name}: {a.pet.food}. {a.pet.fears}</div><div>Allergies: {a.pet.allergies} · Medicine: {a.pet.medicines}</div><div>Vet: {a.pet.vet_name} · <span className="mono">{a.pet.vet_phone}</span></div><div className="xs muted">{a.notice} These details disappear after the visit.</div></div>; })()
            : <button className="btn sm" onClick={() => api<Access>(`/v1/me/requests/${r.id}/access`).then(a => setAccess(x => ({ ...x, [r.id]: a }))).catch(e => setMsg(e instanceof ApiError ? String(e.body.note) : 'Unavailable'))}>Show address, key and emergency card</button>}
          {r.lateMin ? <div className="small"><b>You said you’d be about {r.lateMin} min late.</b> The owner knows.</div> : null}
          {!r.arrived && <div className="row"><select className="input" aria-label="How late" value={late} onChange={e => setLate(Number(e.target.value))}>{[10, 15, 20, 30, 45, 60].map(m => <option key={m} value={m}>{m} min</option>)}</select><button className="btn sm" onClick={() => api(`/v1/me/requests/${r.id}/late`, { body: { minutes: late } }).then(() => { setMsg(`The owner has been told you’ll be about ${late} min late.`); load(); }).catch(e => setMsg(e instanceof ApiError ? String(e.body.message) : 'Can’t reach Pawsure.'))}>I’m running late</button></div>}
          <div className="btnrow"><button className="btn" onClick={() => api(`/v1/me/requests/${r.id}/arrived`, { body: {} }).then(() => { setMsg('The owner has been told you arrived.'); load(); })}>I’ve arrived</button>
            <button className="btn primary" onClick={() => setProofFor({ id: r.id, hh: (r as { householdId?: string }).householdId })}>Done: send proof</button>
            <button className="btn" onClick={() => api(`/v1/me/requests/${r.id}/cancel`, { body: {} }).then(() => { setMsg('Cancelled. The owner was told and the details were removed.'); load(); })}>Can’t make it</button></div>
          {sos !== r.id ? <button className="btn ghost sm" onClick={() => { setSos(r.id); setDoneNow([]); }}>Emergency: I have to leave</button>
            : <div className="card warn small"><b>Tick what you already finished</b>
              {(r.tasks ?? []).map(k => { return <label key={k} className="check"><input type="checkbox" checked={doneNow.includes(k)} onChange={e => setDoneNow(d => e.target.checked ? [...d, k] : d.filter(y => y !== k))} /><span>{TASK_LABEL[k]}</span></label>; })}
              <div className="xs muted">The owner is called and backups are asked at once.</div>
              <div className="btnrow"><button className="btn primary" onClick={() => api(`/v1/me/requests/${r.id}/emergency`, { body: { done: doneNow } }).then(() => { setSos(null); setMsg('The owner has been alerted and backups are being asked. Take care.'); load(); })}>Send emergency alert</button><button className="btn" onClick={() => setSos(null)}>Back</button></div></div>}
          {p?.live_location_allowed && <button className="btn sm" onClick={() => api(`/v1/me/requests/${r.id}/live`, { body: { on: !live } }).then(() => setLive(!live))}>{live ? 'Stop sharing live location' : 'Share live location (this visit only)'}</button>}</>}
      </div>) : <div className="empty"><Art name="wave" width={120} /><b>No requests right now</b><span>When a friend asks for help, it appears here and on WhatsApp.</span></div>}</>}

      {tab === 'settings' && <>
        <div className="card"><label className="switch"><span className="grow"><b>Friends can find me</b><br /><span className="xs muted">Off removes you from search at once.</span></span><input type="checkbox" role="switch" checked={!!p?.discoverable} onChange={e => save({ discoverable: e.target.checked })} /></label>
          <label className="switch"><span className="grow"><b>Pause all requests</b><br /><span className="xs muted">{p?.pause_active ? (p.resumes_on ? `Paused until ${day(p.paused_until!)}. Requests come back on ${day(p.resumes_on)}.` : 'Paused until you turn this off.') : 'Take a break any time, no need to contact support.'}</span></span><input type="checkbox" role="switch" checked={!!p?.pause_active} onChange={e => save({ paused: e.target.checked })} /></label>
          {!p?.pause_active && <button className="btn sm" onClick={() => save({ pauseDays: 6 })}>Pause for 6 days (today + 5)</button>}
          <span className="xs muted">Visits you already confirmed stay booked.</span></div>
        <div className="card"><span className="eyebrow">When I’m usually free</span><div className="grid2">
          <div className="field"><label htmlFor="wf">From</label><select id="wf" className="input" value={p?.windows?.[0]?.[0] ?? 1020} onChange={e => save({ windows: [[Number(e.target.value), p?.windows?.[0]?.[1] ?? 1260]] })}>{HALF_HOURS.map(m => <option key={m} value={m}>{fmt(m)}</option>)}</select></div>
          <div className="field"><label htmlFor="wt">To</label><select id="wt" className="input" value={p?.windows?.[0]?.[1] ?? 1260} onChange={e => save({ windows: [[p?.windows?.[0]?.[0] ?? 1020, Number(e.target.value)]] })}>{HALF_HOURS.map(m => <option key={m} value={m}>{fmt(m)}{m < (p?.windows?.[0]?.[0] ?? 1020) ? ' (next day)' : ''}</option>)}</select></div></div>
          <span className="xs muted">Not a promise. An end before the start means overnight.</span></div>
        <div className="card"><span className="eyebrow">How many pets at once</span>
          <div className="field"><label htmlFor="mxp">At most</label><select id="mxp" className="input" value={p?.max_pets ?? 1} onChange={e => save({ maxPets: Number(e.target.value) })}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 1 ? 'One pet at a time' : `${n} pets at a time`}</option>)}</select></div>
          <span className="xs muted">Counts every visit you’ve agreed to at the same time, in any home.</span>
          {['Dog', 'Cat', 'Other'].map(sp => <label key={sp} className="check"><input type="checkbox" checked={(p?.species ?? ['Dog', 'Cat', 'Other']).includes(sp)} onChange={e => { const cur = p?.species ?? ['Dog', 'Cat', 'Other']; const next = e.target.checked ? [...cur, sp] : cur.filter(x => x !== sp); if (next.length) save({ species: next }); }} /><span>{sp === 'Other' ? 'Other pets' : sp + 's'}</span></label>)}</div>
        <div className="card"><span className="eyebrow">Tasks I’m comfortable with</span>{CAP.map(([k, l, hint]) => <label key={k} className="switch"><span className="grow"><b>{l}</b>{hint && <><br /><span className="xs muted">{hint}</span></>}</span><input type="checkbox" role="switch" checked={!!p?.capabilities?.[k]} onChange={e => save({ capabilities: { ...(p?.capabilities ?? {}), [k]: e.target.checked } })} /></label>)}</div>
        <div className="card"><div className="field"><label htmlFor="km">Keys</label><select id="km" className="input" value={p?.key_mode ?? 'handover'} onChange={e => save({ keyMode: e.target.value })}><option value="yes">I can hold a spare key</option><option value="handover">I can collect a key when needed</option><option value="no">No key visits</option></select></div>
          <div className="field"><label htmlFor="lg">Message language</label><select id="lg" className="input" value={me.language} onChange={e => save({ language: e.target.value })}><LanguageOptions forMessages /></select></div>
          <label className="switch"><span className="grow"><b>Fine with stairs</b></span><input type="checkbox" role="switch" checked={p?.stairs_ok !== false} onChange={e => save({ stairsOk: e.target.checked })} /></label></div>
        <div className="card"><span className="eyebrow">Location</span><label className="switch"><span className="grow"><b>Live location only during an accepted visit</b><br /><span className="xs muted">Off by default. Deleted 24 h after the visit.</span></span><input type="checkbox" role="switch" checked={!!p?.live_location_allowed} onChange={e => save({ liveLocationAllowed: e.target.checked })} /></label></div>
        <div className="card"><label className="switch"><span className="grow"><b>Also help nearby Pawsure members</b><br /><span className="xs muted">Not active yet. Needs ID checks first.</span></span><input type="checkbox" role="switch" checked={!!p?.nearby_opt_in} onChange={e => save({ nearbyOptIn: e.target.checked })} /></label></div>
      </>}
      {proofFor && <ProofSheet title="Send proof" householdId={proofFor.hh} allowNoProof onClose={() => { setProofFor(null); load(); }} onSend={b => api<{ message?: string }>(`/v1/me/requests/${proofFor.id}/done`, { body: b })} />}
      <p className="xs muted">Signed in as {name}. Reply “help” on WhatsApp to reach a person.</p>
      <button className="btn ghost block" onClick={onSignOut}>Sign out</button>
    </main>
  </>;
}
