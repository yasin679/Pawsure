/** Owner account screens: helper points wallet (PS-042) and data rights (PS-119). */
import { useEffect, useState } from 'react';
import { api, ApiError, type Me } from '../api';
import { AppBar, Icon, PersonAvatar } from '../ui';

interface WalletView { rewardsArm: boolean; policy: string; friendThankYouPoints: string; helpers: { name: string; thisMonth: number; cap: number; held: number; history: { points: number; state: string; month: string; created_at: string; reason: string; decision_note: string | null }[] }[] }
const STATE: Record<string, string> = { earned: 'Earned', held: 'On hold', released: 'Released after review', reversed: 'Not given after review', expired: 'Expired', redeemed: 'Used for a coupon' };

export function WalletScreen({ hh, onBack }: { hh: string; onBack: () => void }) {
  const [w, setW] = useState<WalletView | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<WalletView>(`/v1/households/${hh}/wallet`).then(setW).catch(e => setErr(e instanceof ApiError && e.status === 403 ? 'Only owners and co-owners can see helper points.' : 'Can’t reach Pawsure.')); }, [hh]);
  return <><AppBar title="Wallet and points" onBack={onBack} /><main className="body">
    {err && <div className="card danger">{err}</div>}
    {w && !w.rewardsArm && <div className="card flat"><b>Points are off for your home</b><div className="small muted">Pawsure is testing points in half of the pilot homes. Your helper’s check-ins work the same either way.</div></div>}
    {w?.helpers.map(h => <div key={h.name} className="card">
      <div className="row"><PersonAvatar seed={h.name} /><div className="grow"><b>{h.name}</b><div className="small muted">Points from your home this month</div></div><b className="mono" style={{ fontSize: 'var(--fs-xl)' }}>{h.thisMonth}<span className="small muted">/{h.cap}</span></b></div>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={h.cap} aria-valuenow={h.thisMonth} aria-label="Points this month"><span style={{ width: `${Math.min(100, (h.thisMonth / h.cap) * 100)}%` }} /></div>
      {h.held > 0 && <div className="card warn small"><b>{h.held} points on hold</b> while a mismatch is reviewed (decided within 7 days, with a reason {h.name.split(' ')[0]} can read).</div>}
      <div className="xs muted">You see points from your home only. Points from other homes they work in are never shown to you.</div>
      {h.history.length > 0 && <div className="list">{h.history.map((r, i) => <div key={i} className="li small"><div className="grow"><b>{STATE[r.state] ?? r.state}</b> · {r.reason}{r.decision_note && <div className="xs muted">Review: {r.decision_note}</div>}</div><span className="mono">{r.state === 'reversed' ? '—' : '+' + r.points}</span></div>)}</div>}
    </div>)}
    {w && <div className="card flat small"><span className="eyebrow">How points work</span><div>{w.policy}</div><div className="xs muted">Friend thank-you points: {w.friendThankYouPoints}.</div></div>}
  </main></>;
}

interface RightsRow { id: string; kind: string; channel: string; state: string; due_at: string; legal_due_at: string; created_at: string; reply: string | null }
const KINDS: [string, string, string][] = [['access', 'See my data', 'A copy of what Pawsure holds about you'], ['correction', 'Correct something', 'Fix a wrong detail'], ['withdrawal', 'Withdraw a consent', 'Stops future processing for that purpose'], ['erasure', 'Delete my data', 'Some records others rely on are kept as the law requires'], ['grievance', 'Raise a complaint', 'Goes to the grievance officer']];
const day = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function RightsScreen({ me, onBack, reload }: { me: Me | null; onBack: () => void; reload: () => void }) {
  const [rows, setRows] = useState<RightsRow[]>([]); const [kind, setKind] = useState<string | null>(null); const [detail, setDetail] = useState('');
  const [msg, setMsg] = useState<string | null>(null); const [exported, setExported] = useState<string | null>(null);
  const load = () => api<RightsRow[]>('/v1/me/rights').then(setRows);
  useEffect(() => { load(); }, []);
  const submit = async () => {
    const r = await api<{ id: string; dueAt: string; note?: string }>('/v1/me/rights', { body: { kind, detail: detail || undefined } });
    setMsg(`Request ${r.id} received. We aim to reply by ${day(r.dueAt)}.${r.note ? ' ' + r.note : ''}`); setKind(null); setDetail(''); load(); reload();
  };
  const exportData = async () => { const d = await api('/v1/me/export'); setExported(JSON.stringify(d, null, 2)); };
  const download = () => { if (!exported) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exported], { type: 'application/json' })); a.download = 'pawsure-my-data.json'; a.click(); URL.revokeObjectURL(a.href); };
  return <><AppBar title="Your data rights" onBack={onBack} /><main className="body">
    {msg && <div className="card info" role="status">{msg}</div>}
    <div className="card"><span className="eyebrow">Your data, right now</span><p className="small">See everything Pawsure holds about you: profile, consents, pets, requests. Other people’s details are not included.</p>
      <div className="row"><button className="btn sm" onClick={exportData}>Show my data</button>{exported && <button className="btn primary sm" onClick={download}>Save as file</button>}</div>
      {exported && <pre className="mono xs" style={{ maxHeight: 220, overflow: 'auto', background: 'var(--surface-2)', padding: 10, borderRadius: 8, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{exported}</pre>}</div>
    <span className="eyebrow">Make a request</span>
    <div className="list">{KINDS.map(([k, t, s]) => <button key={k} className="li" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}><span className="avatar icon"><Icon name={k === 'grievance' ? 'alert' : 'shield'} size={20} /></span><div className="grow"><b>{t}</b><div className="small muted">{s}</div></div><span className="chev">{kind === k ? '✓' : '›'}</span></button>)}</div>
    {kind && <div className="card"><div className="field"><label htmlFor="rd">Tell us more (optional)</label><textarea id="rd" className="input" rows={3} maxLength={1000} value={detail} onChange={e => setDetail(e.target.value)} /></div>
      <div className="xs muted">We aim to reply within 7 days.</div>
      <button className="btn primary block" onClick={submit}>Send request</button></div>}
    {rows.length > 0 && <><span className="eyebrow">Your requests</span><div className="list">{rows.map(r => <div key={r.id} className="li small"><div className="grow"><b>{r.id}</b> · {KINDS.find(k => k[0] === r.kind)?.[1] ?? r.kind}<div className="xs muted">Sent {day(r.created_at)} · reply by {day(r.due_at)}</div>{r.reply && <div className="small" style={{ marginTop: 4 }}>“{r.reply}”</div>}</div><span className={`tag ${r.state === 'closed' ? 'flag-on' : ''}`}>{r.state === 'closed' ? 'Answered' : r.state === 'in_review' ? 'In review' : 'Received'}</span></div>)}</div></>}
    <div className="card"><span className="eyebrow">Consents</span>{me?.consents.map((c, i) => <div key={i} className="row small"><span className="grow">{c.kind.replace(/_/g, ' ')} <span className="mono muted">{c.version}</span></span><span className={`tag ${c.granted ? 'flag-on' : 'flag-off'}`}>{c.granted ? 'Given' : 'Not given'}</span></div>)}
      <div className="xs muted">To withdraw an optional consent, choose “Withdraw a consent” above. Withdrawing stops future use; it doesn’t erase records others rely on.</div></div>
  </main></>;
}
