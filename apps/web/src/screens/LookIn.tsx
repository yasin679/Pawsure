/** Backup 15-minute look-in page (PS-102). Opened from a WhatsApp link; no sign-in; token-scoped; every open is logged. */
import { useEffect, useState } from 'react';
import { api, ApiError, fmt } from '../api';
import { Art, Banner, PetAvatar } from '../ui';

interface LookInData { task: { title: string; due_minute: number }; pet: { name: string; species: string; allergies: string; medicines: string; vet_name: string; vet_phone: string; clinic24_name: string; clinic24_phone: string; notes: string }; expiresAt: string; spareKeyNote: string; address: string | null }

export function LookIn({ token }: { token: string }) {
  const [data, setData] = useState<LookInData | null>(null); const [err, setErr] = useState<string | null>(null); const [acked, setAcked] = useState(false);
  useEffect(() => { api<LookInData>(`/l/${token}`, { auth: false }).then(setData).catch(e => setErr(e instanceof ApiError ? String(e.body.error) : 'offline')); }, [token]);
  if (err) return <main className="body"><div className="empty"><Art name="sleep" width={170} /><b>{err === 'expired' ? 'This link has expired' : err === 'revoked' ? 'This link was switched off' : 'This link can’t be opened'}</b><span>Look-in links open for 15 minutes and only for the person they were sent to.</span></div></main>;
  if (!data) return <main className="body"><div className="empty">Opening…</div></main>;
  const p = data.pet;
  return <main className="body">
    <div className="card warn"><div className="row"><b className="grow">Look-in for {p.name}</b><span className="tag sim">Until {new Date(data.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div><div className="small">Missed: <b>{data.task.title}</b> (due {fmt(data.task.due_minute)}). The owner hasn’t responded.</div></div>
    <div className="card"><div className="row"><PetAvatar species={p.species} size={56} /><h2>{p.name}</h2></div>
      <dl className="kv"><dt>Allergies</dt><dd>{p.allergies || '—'}</dd><dt>Medicine</dt><dd>Not for backups to give. {p.medicines ? 'Owner’s instructions on file.' : ''}</dd><dt>Own vet</dt><dd>{p.vet_name} · <span className="mono">{p.vet_phone}</span></dd><dt>24x7 clinic</dt><dd>{p.clinic24_name} · <span className="mono">{p.clinic24_phone}</span></dd><dt>Spare key</dt><dd>{data.spareKeyNote}</dd><dt>Address</dt><dd>{data.address ?? 'Not shown — you aren’t authorised for the address. Call the owner.'}</dd></dl></div>
    {acked ? <Banner kind="info" icon="✓">Thanks — the owner will see that you’re on it.</Banner> : <button className="btn warn block" onClick={() => api(`/l/${token}/ack`, { body: {}, auth: false }).then(() => setAcked(true))}>I’m on it</button>}
    <p className="xs muted">This link can’t be forwarded into a new session. Every open is logged. Pawsure is not an emergency service.</p>
  </main>;
}
