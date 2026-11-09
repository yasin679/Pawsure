/** F1 privacy, F2 friends list + invite, F3 friend profile + block/report (PS-050–054, PS-064, PS-069). */
import { useEffect, useState } from 'react';
import { api, ApiError, type FriendProfileView, type FriendSummary, type Privacy } from '../api';
import { AppBar, Art, Banner, Icon } from '../ui';

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
    {open.invited ? <div className="empty"><Art name="wave" width={120} /><b>Invite sent</b><span>{open.note} An invitation isn’t the same as opting in.</span></div> : <>
      <div className="card"><div className="row"><span className="avatar lg">{open.name[0]}</span><div className="grow"><h2>{open.name}</h2><div className="small muted">{open.distance} · speaks {LANG[open.language ?? 'en']}</div></div></div></div>
      <div className="card"><span className="eyebrow">Comfortable with (their own choice)</span><div className="chips">{CAP.map(([k, l]) => <span key={k} className={`tag ${open.capabilities?.[k] ? 'flag-on' : 'flag-off'}`}>{open.capabilities?.[k] ? '✓' : '—'} {l}</span>)}</div>
        <dl className="kv"><dt>Usually free</dt><dd>{open.availability}</dd><dt>Key</dt><dd>{KEY[open.key ?? 'handover']}</dd><dt>Stairs</dt><dd>{open.stairsOk ? 'Fine with stairs' : 'Needs the lift'}</dd></dl><span className="xs muted">Profile updated {open.updated}. Availability isn’t a promise.</span></div>
      <div className="card flat"><span className="eyebrow">History in your network (shared with their consent)</span><dl className="kv"><dt>Helps</dt><dd>{open.history}</dd><dt>Usual reply</dt><dd>{open.responseBand}</dd></dl><span className="xs muted">{open.disclaimer}</span></div>
      <div className="small muted row">Thank-you points <span className="tag flag-off">Switch OFF</span></div>
      <div className="btnrow"><button className="btn primary" onClick={() => onAsk(open.name)}>Ask for help</button><button className="btn" onClick={() => setReport('block')}>Block</button><button className="btn" onClick={() => setReport('report')}>Report</button></div></>}
    {report && <div className="card warn"><b>{report === 'block' ? `Block ${open.name.split(' ')[0]}?` : `Report ${open.name.split(' ')[0]}`}</b>
      <div className="small">{report === 'block' ? 'They won’t appear in your searches and can’t get requests from you. They aren’t told why.' : 'Pawsure’s team reviews reports within 24 hours. They will also be blocked.'}</div>
      {report === 'report' && <div className="field"><label htmlFor="rr">Reason</label><select id="rr" className="input" value={reason} onChange={e => setReason(e.target.value)}>{['Made me uncomfortable', 'Unsafe behaviour', 'Shared my details', 'Spam', 'Other'].map(r => <option key={r}>{r}</option>)}</select></div>}
      <div className="btnrow"><button className="btn" onClick={() => setReport(null)}>Cancel</button><button className="btn danger" onClick={async () => { await api(`${H}/friends/${open.id}/${report}`, { body: report === 'report' ? { reason, block: true } : {} }); setOpen(null); setReport(null); setMsg(report === 'report' ? 'Report sent and friend blocked. An ops case was created.' : 'Blocked.'); load(); }}>{report === 'block' ? 'Block' : 'Send report'}</button></div></div>}
  </main></>;

  return <><AppBar title="Friends" right={<button className="btn sm primary" onClick={() => setInvite(true)}><Icon name="plus" size={16} />Invite</button>} /><main className="body">
    {msg && <Banner kind="info" icon="ℹ">{msg}</Banner>}
    <p className="small muted">Friends who chose to help. Distances are approximate. Each request still needs their Yes.</p>
    {invite && <div className="card"><h3>Invite a friend</h3>
      <div className="field"><label htmlFor="fn">Name</label><input id="fn" className="input" value={inv.name} onChange={e => setInv({ ...inv, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="fp">Phone</label><div className="row"><span className="tag">+91</span><input id="fp" className="input mono" inputMode="numeric" maxLength={10} value={inv.phone} onChange={e => setInv({ ...inv, phone: e.target.value })} /></div></div>
      <div className="field"><label htmlFor="fl">Message language</label><select id="fl" className="input" value={inv.language} onChange={e => setInv({ ...inv, language: e.target.value })}>{Object.entries(LANG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div className="card flat small"><b>Getting an invite isn’t the same as opting in.</b> They choose whether to be findable, what they can help with and when.</div>
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block" onClick={async () => { setErr(null); try { await api(`${H}/friends/invite`, { body: { ...inv, phone: '+91' + inv.phone.replace(/\D/g, '') } }); setInvite(false); setMsg('Invitation sent on WhatsApp (simulated).'); load(); } catch (e) { setErr(e instanceof ApiError ? 'Check the name and a 10-digit mobile number.' : 'Can’t reach Pawsure.'); } }}>Send WhatsApp invite</button></div>}
    <div className="list">{list.map(f => <button key={f.id} className="li" onClick={() => api<FriendProfileView>(`${H}/friends/${f.id}`).then(setOpen)}><span className="avatar">{f.name[0]}</span><div className="grow"><b>{f.name} {f.invited && <span className="tag">Invite sent</span>}</b><div className="small muted">{f.invited || !f.findable ? 'Not searchable until they opt in' : `${f.distance} · ${f.availability} · ${KEY[f.key]}`}</div></div><span className="chev">›</span></button>)}</div>
    <div className="card flat"><div className="row"><div className="grow"><b>Nearby Pawsure members</b><div className="small muted">ID-checked members who opted in, for when no friend is free.</div></div><span className="tag flag-off">Switch OFF</span></div><div className="xs muted">Not available until the identity-check process is approved.</div></div>
  </main></>;
}

export function PrivacyScreen({ hh, onBack }: { hh: string; onBack: () => void }) {
  const [p, setP] = useState<Privacy | null>(null);
  const load = () => api<Privacy>(`/v1/households/${hh}/privacy`).then(setP);
  useEffect(() => { load(); }, []);
  if (!p) return <><AppBar title="Profile and privacy" onBack={onBack} /><main className="body"><div className="empty">Loading…</div></main></>;
  return <><AppBar title="Profile and privacy" onBack={onBack} /><main className="body">
    <div className="card"><dl className="kv"><dt>Society</dt><dd>{p.society}</dd><dt>Tower</dt><dd>{p.tower}</dd></dl></div>
    <div className="card"><span className="eyebrow">What friends can see</span><div className="grid2 small"><div><b>Visible to friends</b><ul style={{ margin: '4px 0', paddingLeft: 16 }}>{p.friendsSee.map(x => <li key={x}>{x}</li>)}</ul></div><div><b>Hidden until you confirm someone</b><ul style={{ margin: '4px 0', paddingLeft: 16 }}>{p.hiddenUntilConfirmed.map(x => <li key={x}>{x}</li>)}</ul></div></div><div className="xs muted">No public map. No exact pin, ever.</div></div>
    <div className="card"><span className="eyebrow">Location sharing</span><div className="seg">{[['society', 'Society only'], ['tower', 'Society + tower']].map(([k, l]) => <button key={k} aria-pressed={p.loc_share === k} onClick={() => api(`/v1/households/${hh}/privacy`, { method: 'PUT', body: { locShare: k } }).then(load)}>{l}</button>)}</div><div className="xs muted">Default: society only. Distance shows as bands like “same tower”.</div></div>
    <div className="card"><div className="row"><b className="grow">Ask nearby members if no friend is free</b><span className="tag flag-off">Switch OFF</span></div><label className="switch"><span className="grow small muted">{p.nearbyFallback.reason}</span><input type="checkbox" role="switch" disabled checked={false} readOnly /></label></div>
  </main></>;
}
