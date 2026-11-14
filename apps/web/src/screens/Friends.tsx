/** F1 privacy, F2 friends list + invite, F3 friend profile + block/report (PS-050–054, PS-064, PS-069). */
import { t as tr } from '../i18n';
import { useEffect, useState } from 'react';
import { api, ApiError, nameError, errMessage, type FriendProfileView, type FriendSummary, type HomeProfile, type Privacy, type Society } from '../api';
import { LanguageOptions, AppBar, Art, Banner, Icon } from '../ui';

const LANG: Record<string, string> = { en: 'English', hi: 'Hindi', mr: 'Marathi' };
const KEY: Record<string, string> = { yes: 'Key: yes', handover: 'Key: needs handover', no: 'Key: no' };
const CAP: [string, string][] = [['feed', 'Feeding / water'], ['walk', 'Short walks'], ['meds', 'Medicines'], ['large', 'Large / anxious dogs']];

export function Friends({ hh, onAsk }: { hh: string; onAsk: (name: string) => void }) {
  const [list, setList] = useState<FriendSummary[]>([]); const [open, setOpen] = useState<FriendProfileView | null>(null);
  const [invite, setInvite] = useState(false); const [inv, setInv] = useState({ name: '', phone: '', language: 'en' });
  const [report, setReport] = useState<null | 'block' | 'report'>(null); const [reason, setReason] = useState('Made me uncomfortable');
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const H = `/v1/households/${hh}`;
  const load = () => api<FriendSummary[]>(`${H}/friends`).then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  if (open) return <><AppBar title={open.name} onBack={() => { setOpen(null); setReport(null); }} /><main className="body">
    {open.invited ? <div className="empty"><Art name="wave" width={120} /><b>{tr('Invite sent')}</b><span>{open.note} An invitation isn’t the same as opting in.</span></div> : <>
      <div className="card"><div className="row"><span className="avatar lg">{open.name[0]}</span><div className="grow"><h2>{open.name}</h2><div className="small muted">{open.distance} · speaks {LANG[open.language ?? 'en']}</div></div></div></div>
      <div className="card"><span className="eyebrow">Comfortable with (their own choice)</span><div className="chips">{CAP.map(([k, l]) => <span key={k} className={`tag ${open.capabilities?.[k] ? 'flag-on' : 'flag-off'}`}>{open.capabilities?.[k] ? '✓' : '—'} {l}</span>)}</div>
        <dl className="kv"><dt>{tr('Usually free')}</dt><dd>{open.availability}</dd><dt>{tr('Key')}</dt><dd>{KEY[open.key ?? 'handover']}</dd><dt>{tr('Stairs')}</dt><dd>{open.stairsOk ? 'Fine with stairs' : 'Needs the lift'}</dd></dl><span className="xs muted">Profile updated {open.updated}. Availability isn’t a promise.</span></div>
      <div className="card flat"><span className="eyebrow">History in your network (shared with their consent)</span><dl className="kv"><dt>Helps</dt><dd>{open.history}</dd><dt>Usual reply</dt><dd>{open.responseBand}</dd></dl><span className="xs muted">{open.disclaimer}</span></div>
      <div className="small muted row">Thank-you points <span className="tag flag-off">{tr('Switch OFF')}</span></div>
      <div className="btnrow"><button className="btn primary" onClick={() => onAsk(open.name)}>{tr('Ask for help')}</button><button className="btn" onClick={() => setReport('block')}>{tr('Block')}</button><button className="btn" onClick={() => setReport('report')}>{tr('Report')}</button></div></>}
    {report && <div className="card warn"><b>{report === 'block' ? `Block ${open.name.split(' ')[0]}?` : `Report ${open.name.split(' ')[0]}`}</b>
      <div className="small">{report === 'block' ? 'They won’t appear in your searches and can’t get requests from you. They aren’t told why.' : 'Pawsure’s team reviews reports within 24 hours. They will also be blocked.'}</div>
      {report === 'report' && <div className="field"><label htmlFor="rr">{tr('Reason')}</label><select id="rr" className="input" value={reason} onChange={e => setReason(e.target.value)}>{['Made me uncomfortable', 'Unsafe behaviour', 'Shared my details', 'Spam', 'Other'].map(r => <option key={r}>{r}</option>)}</select></div>}
      <div className="btnrow"><button className="btn" onClick={() => setReport(null)}>{tr('Cancel')}</button><button className="btn danger" onClick={async () => { await api(`${H}/friends/${open.id}/${report}`, { body: report === 'report' ? { reason, block: true } : {} }); setOpen(null); setReport(null); setMsg(report === 'report' ? 'Report sent and friend blocked. An ops case was created.' : 'Blocked.'); load(); }}>{report === 'block' ? 'Block' : 'Send report'}</button></div></div>}
  </main></>;

  return <><AppBar title={tr('Friends')} right={<button className="btn sm primary" onClick={() => setInvite(true)}><Icon name="plus" size={16} />{tr('Invite')}</button>} /><main className="body">
    {msg && <Banner kind="info" icon="ℹ">{msg}</Banner>}
    <p className="small muted">{tr('Friends who chose to help. Each request still needs their Yes.')}</p>
    {invite && <div className="card"><h3>{tr('Invite a friend')}</h3>
      <div className="field"><label htmlFor="fn">{tr('Name')}</label><input id="fn" className="input" value={inv.name} onChange={e => setInv({ ...inv, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="fp">{tr('Phone')}</label><div className="row"><span className="tag">+91</span><input id="fp" className="input mono" inputMode="numeric" maxLength={10} value={inv.phone} onChange={e => setInv({ ...inv, phone: e.target.value })} /></div></div>
      <div className="field"><label htmlFor="fl">{tr('Message language')}</label><select id="fl" className="input" value={inv.language} onChange={e => setInv({ ...inv, language: e.target.value })}><LanguageOptions forMessages /></select></div>
      <div className="card flat small"><b>Getting an invite isn’t the same as opting in.</b> They choose if and when they help.</div>
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block" onClick={async () => { setErr(null); const ne = nameError(inv.name); if (ne) { setErr(ne); return; } try { await api(`${H}/friends/invite`, { body: { ...inv, phone: '+91' + inv.phone.replace(/\D/g, '') } }); setInvite(false); setMsg('Invitation sent on WhatsApp (simulated).'); load(); } catch (e) { setErr(errMessage(e, 'Check the name and a 10-digit mobile number.')); } }}>{tr('Send WhatsApp invite')}</button></div>}
    <div className="list">{list.map(f => <button key={f.id} className="li" onClick={() => api<FriendProfileView>(`${H}/friends/${f.id}`).then(setOpen)}><span className="avatar">{f.name[0]}</span><div className="grow"><b>{f.name} {f.invited && <span className="tag">{tr('Invite sent')}</span>}</b><div className="small muted">{f.invited || !f.findable ? 'Not searchable until they opt in' : `${f.distance} · ${f.availability} · ${KEY[f.key]}`}</div></div><span className="chev">›</span></button>)}</div>
    <div className="card flat"><div className="row"><div className="grow"><b>{tr('Nearby Pawsure members')}</b><div className="small muted">ID-checked members who opted in, for when no friend is free.</div></div><span className="tag flag-off">{tr('Switch OFF')}</span></div><div className="xs muted">Not available until the identity-check process is approved.</div></div>
  </main></>;
}

/**
 * PAW-018 / PAW-036: city first, then the society from that city's list, so two societies with the same name in
 * different cities never mix. A society that isn't listed can be typed; it is marked unverified until ops checks it.
 */
export interface SocietyValue { state: string; city: string; societyId: string; society: string }
/**
 * PAW-018 / PAW-036: state, then city, then society. Every Indian state and union territory is listed with its main
 * cities; a city or society that isn't listed can be typed (a typed society shows as Not verified yet).
 */
export function SocietyFields({ value, onChange }: { value: SocietyValue; onChange: (v: SocietyValue) => void }) {
  const [states, setStates] = useState<string[]>([]); const [cities, setCities] = useState<string[]>([]); const [list, setList] = useState<Society[]>([]);
  const [typedCity, setTypedCity] = useState(false); const [typed, setTyped] = useState(!value.societyId && !!value.society);
  useEffect(() => { api<{ states: string[] }>('/v1/societies').then(r => setStates(r.states)).catch(() => setStates([])); }, []);
  useEffect(() => { if (value.state) api<{ cities: { city: string }[] }>(`/v1/societies?state=${encodeURIComponent(value.state)}`).then(r => { const cs = r.cities.map(x => x.city); setCities(cs); if (value.city && !cs.includes(value.city)) setTypedCity(true); }).catch(() => setCities([])); else setCities([]); }, [value.state]);
  useEffect(() => { if (value.city) api<{ societies: Society[] }>(`/v1/societies?city=${encodeURIComponent(value.city)}`).then(r => { setList(r.societies); if (!r.societies.length) setTyped(true); }).catch(() => setList([])); else setList([]); }, [value.city]);
  return <>
    <div className="field"><label htmlFor="stt">{tr('State')}</label><select id="stt" className="input" value={value.state} onChange={e => { setTypedCity(false); setTyped(false); onChange({ state: e.target.value, city: '', societyId: '', society: '' }); }}><option value="">{tr('Choose your state')}</option>{states.map(x => <option key={x} value={x}>{x}</option>)}</select></div>
    {value.state && !typedCity && <div className="field"><label htmlFor="cty">{tr('City')}</label><select id="cty" className="input" value={value.city} onChange={e => { if (e.target.value === '__other') { setTypedCity(true); onChange({ ...value, city: '', societyId: '', society: '' }); } else { setTyped(false); onChange({ ...value, city: e.target.value, societyId: '', society: '' }); } }}><option value="">{tr('Choose your city')}</option>{cities.map(x => <option key={x} value={x}>{x}</option>)}<option value="__other">{tr('My city isn’t listed')}</option></select></div>}
    {value.state && typedCity && <div className="field"><label htmlFor="ctt">{tr('City')}</label><input id="ctt" className="input" value={value.city} onChange={e => { setTyped(true); onChange({ ...value, city: e.target.value, societyId: '', society: value.society }); }} placeholder="Your city or town" />
      <button type="button" className="btn ghost sm" onClick={() => { setTypedCity(false); onChange({ ...value, city: '', society: '' }); }}>{tr('Choose from the list')}</button></div>}
    {value.city && !typed && <div className="field"><label htmlFor="soc">{tr('Society')}</label><select id="soc" className="input" value={value.societyId} onChange={e => { const x = list.find(y => y.id === e.target.value); onChange({ ...value, societyId: e.target.value, society: x ? `${x.name}${x.area ? ', ' + x.area : ''}` : '' }); }}><option value="">{tr('Choose your society')}</option>{list.map(x => <option key={x.id} value={x.id}>{x.name}{x.area ? ' · ' + x.area : ''}</option>)}</select>
      <button type="button" className="btn ghost sm" onClick={() => { setTyped(true); onChange({ ...value, societyId: '', society: '' }); }}>{tr('My society isn’t listed')}</button></div>}
    {value.city && typed && <div className="field"><label htmlFor="sct">{tr('Society name')}</label><input id="sct" className="input" value={value.society} onChange={e => onChange({ ...value, societyId: '', society: e.target.value })} placeholder="e.g. Green Acres CHS, Andheri East" /><span className="hint">{tr('Pawsure support checks new societies.')}</span>
      {list.length > 0 && <button type="button" className="btn ghost sm" onClick={() => { setTyped(false); onChange({ ...value, society: '' }); }}>{tr('Choose from the list')}</button>}</div>}
  </>;
}

/** PAW-017: owner edits their name and home details; the flat stays private. */
function HomeDetails({ hh, onSaved }: { hh: string; onSaved: () => void }) {
  const [h, setH] = useState<HomeProfile | null>(null); const [edit, setEdit] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ displayName: '', state: '', city: '', societyId: '', society: '', tower: '', flat: '' });
  const load = () => api<HomeProfile>(`/v1/households/${hh}/profile`).then(x => { setH(x); setF({ displayName: x.displayName ?? '', state: x.state ?? '', city: x.city ?? '', societyId: x.society_id ?? '', society: x.society_id ? '' : x.society, tower: x.tower ?? '', flat: x.flat ?? '' }); });
  useEffect(() => { load(); }, []);
  if (!h) return null;
  if (!edit) return <div className="card">{msg && <div className="small" role="status">{msg}</div>}
    <dl className="kv"><dt>{tr('Name')}</dt><dd>{h.displayName}</dd><dt>{tr('City')}</dt><dd>{h.city ? `${h.city}${h.state ? ', ' + h.state : ''}` : 'Not set'}</dd><dt>{tr('Society')}</dt><dd>{h.society} {!h.society_verified && <span className="tag">{tr('Not verified yet')}</span>}</dd><dt>{tr('Tower')}</dt><dd>{h.tower ?? '—'}</dd>{h.flat != null && <><dt>{tr('Flat (private)')}</dt><dd>{h.flat}</dd></>}</dl>
    {h.canEdit && <button className="btn sm" onClick={() => { setEdit(true); setMsg(null); }}>{tr('Edit profile')}</button>}</div>;
  const save = async () => {
    setErr(null);
    try {
      const r = await api<{ changed: string[]; note?: string }>(`/v1/households/${hh}/profile`, { method: 'PUT', body: { displayName: f.displayName, state: f.state || undefined, city: f.city || undefined, ...(f.societyId ? { societyId: f.societyId } : { society: f.society }), tower: f.tower || null, flat: f.flat || null } });
      setEdit(false); setMsg(r.changed.length ? `Saved: ${r.changed.join(', ')}.${r.note ? ' ' + r.note : ''}` : 'Nothing changed.'); load(); onSaved();
    } catch (e) { setErr(e instanceof ApiError ? String(e.body.message ?? 'Check the details and try again.') : 'Can’t reach Pawsure.'); }
  };
  return <div className="card"><span className="eyebrow">{tr('Edit profile')}</span>
    <div className="field"><label htmlFor="pn">{tr('Your name')}</label><input id="pn" className="input" value={f.displayName} onChange={e => setF({ ...f, displayName: e.target.value })} /></div>
    <SocietyFields value={f} onChange={v => setF({ ...f, ...v })} />
    <div className="grid2"><div className="field"><label htmlFor="ptw">{tr('Tower / wing')}</label><input id="ptw" className="input" value={f.tower} onChange={e => setF({ ...f, tower: e.target.value })} /></div><div className="field"><label htmlFor="pfl">{tr('Flat (private)')}</label><input id="pfl" className="input" value={f.flat} onChange={e => setF({ ...f, flat: e.target.value })} /></div></div>
    <div className="xs muted">{tr('Friends see your society and tower. The flat only after you confirm them.')}</div>
    {err && <span className="errtext" role="alert">{err}</span>}
    <div className="btnrow"><button className="btn primary" disabled={!f.displayName.trim() || (!f.societyId && f.society.trim().length < 2)} onClick={() => { const ne = nameError(f.displayName); if (ne) { setErr(ne); return; } save(); }}>{tr('Save')}</button><button className="btn" onClick={() => { setEdit(false); load(); }}>{tr('Cancel')}</button></div></div>;
}

export function PrivacyScreen({ hh, onBack }: { hh: string; onBack: () => void }) {
  const [p, setP] = useState<Privacy | null>(null);
  const load = () => api<Privacy>(`/v1/households/${hh}/privacy`).then(setP);
  useEffect(() => { load(); }, []);
  if (!p) return <><AppBar title={tr('Profile and privacy')} onBack={onBack} /><main className="body"><div className="empty">{tr('Loading…')}</div></main></>;
  return <><AppBar title={tr('Profile and privacy')} onBack={onBack} /><main className="body">
    <HomeDetails hh={hh} onSaved={load} />
    <div className="card"><span className="eyebrow">{tr('What friends can see')}</span><div className="grid2 small"><div><b>{tr('Visible to friends')}</b><ul style={{ margin: '4px 0', paddingLeft: 16 }}>{p.friendsSee.map(x => <li key={x}>{x}</li>)}</ul></div><div><b>{tr('Hidden until you confirm someone')}</b><ul style={{ margin: '4px 0', paddingLeft: 16 }}>{p.hiddenUntilConfirmed.map(x => <li key={x}>{x}</li>)}</ul></div></div><div className="xs muted">{tr('No public map. No exact pin, ever.')}</div></div>
    <div className="card"><span className="eyebrow">{tr('Location sharing')}</span><div className="seg">{[['society', 'Society only'], ['tower', 'Society + tower']].map(([k, l]) => <button key={k} aria-pressed={p.loc_share === k} onClick={() => api(`/v1/households/${hh}/privacy`, { method: 'PUT', body: { locShare: k } }).then(load)}>{l}</button>)}</div><div className="xs muted">Default: society only. Distance shows as bands like “same tower”.</div></div>
    <div className="card"><div className="row"><b className="grow">Ask nearby members if no friend is free</b><span className="tag flag-off">{tr('Switch OFF')}</span></div><label className="switch"><span className="grow small muted">{p.nearbyFallback.reason}</span><input type="checkbox" role="switch" disabled checked={false} readOnly /></label></div>
  </main></>;
}
