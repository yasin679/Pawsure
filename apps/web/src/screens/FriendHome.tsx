/** The friend’s side (F6 requests, F7 settings). Shown when a signed-in user is a friend, not a household member. */
import { useEffect, useState } from 'react';
import { api, ApiError, fmt, type FriendSelf } from '../api';
import { AppBar, Art, Banner } from '../ui';

const CAP: [string, string, string?][] = [['feed', 'Feeding / water'], ['walk', 'Short walks'], ['meds', 'Medicines', 'Only with the owner’s written instructions'], ['large', 'Large / anxious dogs']];
interface Access { flat: string; tower: string; access: string; pet: Record<string, string>; notice: string }

export function FriendHome({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const [me, setMe] = useState<FriendSelf | null>(null); const [tab, setTab] = useState<'requests' | 'settings'>('requests');
  const [text, setText] = useState(''); const [access, setAccess] = useState<Record<string, Access | string>>({}); const [msg, setMsg] = useState<string | null>(null); const [live, setLive] = useState(false);
  const load = () => api<FriendSelf>('/v1/me/friend').then(setMe);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  const save = async (body: Record<string, unknown>) => { const r = await api<{ removedFromSearch?: string; nearbyNote?: string }>('/v1/me/friend', { method: 'PUT', body }); setMsg(r.removedFromSearch ? 'You’re no longer findable. Removed from search immediately.' : r.nearbyNote ?? 'Saved.'); load(); };
  if (!me) return <><AppBar title="Pawsure" /><main className="body"><div className="empty">Loading…</div></main></>;
  const p = me.profile;
  return <>
    <AppBar title={tab === 'requests' ? 'Requests for you' : 'My helper settings'} />
    <main className="body">
      <div className="seg">{[['requests', 'Requests'], ['settings', 'My settings (F7)']].map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k as 'requests')}>{l}</button>)}</div>
      {msg && <Banner kind="info" icon="ℹ">{msg}</Banner>}
      {me.links.filter(l => l.status === 'invited').map(l => <div key={l.household_id} className="card info"><b>{l.owner.split(' ')[0]} ({l.society.split(',')[0]}, {l.tower}) invited you</b>
        <div className="small">Accepting connects you. You still choose separately whether you can be found, what you’ll help with and when.</div>
        <button className="btn primary sm" onClick={() => api(`/v1/me/friend/links/${l.household_id}/accept`, { body: {} }).then(load)}>Accept</button></div>)}

      {tab === 'requests' && <>{me.requests.length ? me.requests.map(r => <div key={r.id} className="card">
        <div className="bub in" style={{ maxWidth: '100%', boxShadow: 'none', border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}>{r.message}</div>
        <div className="small muted">Status: {r.confirmedForMe ? 'confirmed — thank you!' : r.myState === 'sent' ? 'waiting for your reply' : r.myState}</div>
        {r.myState === 'sent' || r.myState === 'unclear' ? <>
          <div className="btnrow"><button className="btn primary" onClick={() => api(`/v1/me/requests/${r.id}/reply`, { body: { reply: 'yes' } }).then(load)}>Yes</button><button className="btn" onClick={() => api(`/v1/me/requests/${r.id}/reply`, { body: { reply: 'no' } }).then(() => { setMsg('Thanks for letting them know. Declining never counts against you.'); load(); })}>No</button></div>
          <div className="row"><input className="input" aria-label="Suggest another time" placeholder="Another time, e.g. 5:30" value={text} onChange={e => setText(e.target.value)} /><button className="btn sm" onClick={() => api(`/v1/me/requests/${r.id}/reply`, { body: { reply: 'propose', text } }).then(() => { setText(''); load(); })}>Send</button></div></> : null}
        {r.confirmedForMe && r.state === 'Confirmed' && <>
          {typeof access[r.id] === 'object' ? (() => { const a = access[r.id] as Access; return <div className="card flat small"><b>Flat {a.flat}, {a.tower}</b><div>{a.access}</div><div>{a.pet.name}: {a.pet.food}. {a.pet.fears}</div><div>Allergies: {a.pet.allergies} · Medicine: {a.pet.medicines}</div><div>Vet: {a.pet.vet_name} · <span className="mono">{a.pet.vet_phone}</span></div><div className="xs muted">{a.notice} These details disappear after the visit.</div></div>; })()
            : <button className="btn sm" onClick={() => api<Access>(`/v1/me/requests/${r.id}/access`).then(a => setAccess(x => ({ ...x, [r.id]: a }))).catch(e => setMsg(e instanceof ApiError ? String(e.body.note) : 'Unavailable'))}>Show address, key and emergency card</button>}
          <div className="btnrow"><button className="btn" onClick={() => api(`/v1/me/requests/${r.id}/arrived`, { body: {} }).then(() => setMsg('The owner has been told you arrived.'))}>I’ve arrived</button>
            <button className="btn primary" onClick={() => api(`/v1/me/requests/${r.id}/done`, { body: {} }).then(() => { setMsg('Done — thank you! Access details have been removed.'); load(); })}>Done</button>
            <button className="btn" onClick={() => api(`/v1/me/requests/${r.id}/cancel`, { body: {} }).then(() => { setMsg('Cancelled. The owner was told and the details were removed.'); load(); })}>Can’t make it</button></div>
          {p?.live_location_allowed && <button className="btn sm" onClick={() => api(`/v1/me/requests/${r.id}/live`, { body: { on: !live } }).then(() => setLive(!live))}>{live ? 'Stop sharing live location' : 'Share live location (this visit only)'}</button>}</>}
      </div>) : <div className="empty"><Art name="wave" width={120} /><b>No requests right now</b><span>When a friend asks for help, it appears here and on WhatsApp.</span></div>}</>}

      {tab === 'settings' && <>
        <div className="card"><label className="switch"><span className="grow"><b>Friends can find me</b><br /><span className="xs muted">Turning this off removes you from search at once (target within 60 s).</span></span><input type="checkbox" role="switch" checked={!!p?.discoverable} onChange={e => save({ discoverable: e.target.checked })} /></label>
          <label className="switch"><span className="grow"><b>Pause all requests</b><br /><span className="xs muted">Take a break any time — no need to contact support.</span></span><input type="checkbox" role="switch" checked={!!p?.paused} onChange={e => save({ paused: e.target.checked })} /></label>
          <button className="btn sm" onClick={() => { const d = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10); save({ pausedUntil: d }); }}>Pause for the next 6 days</button></div>
        <div className="card"><span className="eyebrow">When I’m usually free</span><div className="grid2">
          <div className="field"><label htmlFor="wf">From</label><select id="wf" className="input" value={p?.windows?.[0]?.[0] ?? 1020} onChange={e => save({ windows: [[Number(e.target.value), p?.windows?.[0]?.[1] ?? 1260]] })}>{Array.from({ length: 30 }, (_, i) => 480 + i * 30).map(m => <option key={m} value={m}>{fmt(m)}</option>)}</select></div>
          <div className="field"><label htmlFor="wt">To</label><select id="wt" className="input" value={p?.windows?.[0]?.[1] ?? 1260} onChange={e => save({ windows: [[p?.windows?.[0]?.[0] ?? 1020, Number(e.target.value)]] })}>{Array.from({ length: 30 }, (_, i) => 540 + i * 30).map(m => <option key={m} value={m}>{fmt(m)}</option>)}</select></div></div>
          <span className="xs muted">Shown as “usually free” with when you last updated it. It’s not a promise.</span></div>
        <div className="card"><span className="eyebrow">Tasks I’m comfortable with</span>{CAP.map(([k, l, hint]) => <label key={k} className="switch"><span className="grow"><b>{l}</b>{hint && <><br /><span className="xs muted">{hint}</span></>}</span><input type="checkbox" role="switch" checked={!!p?.capabilities?.[k]} onChange={e => save({ capabilities: { ...(p?.capabilities ?? {}), [k]: e.target.checked } })} /></label>)}</div>
        <div className="card"><div className="field"><label htmlFor="km">Keys</label><select id="km" className="input" value={p?.key_mode ?? 'handover'} onChange={e => save({ keyMode: e.target.value })}><option value="yes">I can hold a spare key</option><option value="handover">I can collect a key when needed</option><option value="no">No key visits</option></select></div>
          <div className="field"><label htmlFor="lg">Message language</label><select id="lg" className="input" value={me.language} onChange={e => save({ language: e.target.value })}><option value="en">English</option><option value="hi">हिन्दी Hindi</option><option value="mr">मराठी Marathi</option></select></div>
          <label className="switch"><span className="grow"><b>Fine with stairs</b></span><input type="checkbox" role="switch" checked={p?.stairs_ok !== false} onChange={e => save({ stairsOk: e.target.checked })} /></label></div>
        <div className="card"><span className="eyebrow">Location</span><label className="switch"><span className="grow"><b>Live location only during an accepted visit</b><br /><span className="xs muted">Off by default. You can stop it any time; it’s deleted 24 h after the visit.</span></span><input type="checkbox" role="switch" checked={!!p?.live_location_allowed} onChange={e => save({ liveLocationAllowed: e.target.checked })} /></label></div>
        <div className="card"><label className="switch"><span className="grow"><b>Also help nearby Pawsure members</b><br /><span className="xs muted">Separate opt-in. Not active: nearby matching is switched off until ID checks are approved.</span></span><input type="checkbox" role="switch" checked={!!p?.nearby_opt_in} onChange={e => save({ nearbyOptIn: e.target.checked })} /></label></div>
      </>}
      <p className="xs muted">Signed in as {name}. Reply “help” on WhatsApp to reach a person.</p>
      <button className="btn ghost block" onClick={onSignOut}>Sign out</button>
    </main>
  </>;
}
