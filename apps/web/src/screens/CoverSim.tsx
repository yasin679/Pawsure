/**
 * DEMO ONLY: the phones of backups, a substitute and any "ask someone else" number, replying through the real webhook,
 * plus the one-time task link page they open. Hidden unless the API runs in DEMO_MODE. Nothing reaches a real phone.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, fmt } from '../api';
import { AppBar, Banner } from '../ui';

interface Person { id: string; name: string; kind: string; phone: string }
interface Msg { direction: string; body: string; gloss: string | null; buttons: { id: string; label: string }[] | null; at: string }

export function CoverPhones({ hh, stamp, onChange }: { hh: string; stamp: unknown; onChange: () => void }) {
  const [people, setPeople] = useState<Person[]>([]); const [who, setWho] = useState<string>(''); const [thread, setThread] = useState<Msg[]>([]); const [text, setText] = useState(''); const [link, setLink] = useState<string | null>(null);
  const load = async () => { const p = await api<Person[]>(`/demo/cover-people/${hh}`, { auth: false }); setPeople(p); const id = who || p[0]?.id || ''; if (!who) setWho(id); if (id) setThread(await api<Msg[]>(`/demo/cover-thread/${hh}/${id}`, { auth: false })); };
  useEffect(() => { load(); }, [who, stamp]);
  const me = people.find(p => p.id === who);
  const send = async (body: Record<string, unknown>) => { if (!me) return; await api('/webhooks/whatsapp', { body: { messageId: 'csim-' + Date.now(), from: me.phone, ...body }, auth: false }); await api('/jobs/tick', { body: {}, auth: false }); await load(); onChange(); };
  const tap = (b: { id: string }) => b.id.startsWith('link:') ? setLink(b.id.slice(5)) : send({ type: b.id.includes('done') ? 'photo' : 'button', payload: b.id });
  if (link) return <div className="sheet simphone" style={{ maxHeight: 'none', borderRadius: 0 }}><TaskLink token={link} onBack={() => { setLink(null); load(); onChange(); }} /></div>;
  return <div className="sheet simphone" style={{ maxHeight: 'none', borderRadius: 0, background: 'var(--wa-bg)', color: 'var(--wa-ink)' }}>
    <div className="banner sim"><span className="bi">⚙</span><div>Backups’ and one-time visitors’ phones (simulated). Nothing reaches a real phone.</div></div>
    <div className="seg" style={{ flexWrap: 'wrap' }}>{people.map(p => <button key={p.id} aria-pressed={who === p.id} onClick={() => setWho(p.id)}>{p.name.split(' ').slice(0, p.name.startsWith('Mrs') ? 2 : 1).join(' ')}</button>)}</div>
    <div className="wa-body" style={{ maxHeight: 320, overflow: 'auto', borderRadius: 12 }}>
      {thread.slice(-10).map((m, i) => <div key={i} className={`bub ${m.direction === 'out' ? 'in' : 'out'}`}>{m.body}{m.gloss && <div className="gloss">EN: {m.gloss}</div>}
        {m.buttons && <div className="qr">{m.buttons.map(b => <button key={b.id} onClick={() => tap(b)}>{b.label}</button>)}</div>}</div>)}
      {!thread.length && <div className="bub sys">No messages for {me?.name ?? 'this person'} yet. Backups hear from Pawsure only when a task is at risk.</div>}
    </div>
    <div className="row"><input className="input" aria-label="Reply text" placeholder="e.g. yes / no / can’t come" value={text} onChange={e => setText(e.target.value)} /><button className="btn sm" disabled={!text} onClick={() => send({ type: 'text', text }).then(() => setText(''))}>Send</button></div>
  </div>;
}

interface LinkView { kind: string; name: string; owner: string; tower: string | null; pet: string; handlingNote: string | null; tasks: { id: string; title: string; time: string; label: string }[]; accepted: boolean; approved: boolean; canAccept: boolean; details: { flat: string; tower: string; gate: string; key: string; instructions: string } | null; notice: string }
/** The one-time task link (/t/<token>, or #task-<token> in the shareable demo). No account; task-scoped; expires. */
export function TaskLink({ token, onBack }: { token: string; onBack?: () => void }) {
  const [v, setV] = useState<LinkView | null>(null); const [err, setErr] = useState<string | null>(null); const [read, setRead] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const load = () => api<LinkView>(`/t/${token}`, { auth: false }).then(x => { setV(x); setErr(null); }).catch(e => setErr(e instanceof ApiError ? String(e.body.note ?? 'This link has expired or was switched off.') : 'Can’t reach Pawsure.'));
  useEffect(() => { load(); }, [token]);
  const act = (a: string, body: Record<string, unknown> = {}) => api<{ status?: string }>(`/t/${token}/${a}`, { body, auth: false }).then(r => { setMsg(a === 'accept' ? (r.status === 'hold' ? `Thank you! ${v?.owner} will confirm in a few minutes. Please wait for the confirmation before going.` : 'Thank you. The details are below.') : a === 'decline' ? 'Thank you for replying.' : a === 'done' ? 'Thank you! The owner has been told.' : 'Thanks for telling us. The details have been removed.'); load(); }).catch(e => setErr(e instanceof ApiError ? String(e.body.note ?? e.body.error) : 'Can’t reach Pawsure.'));
  return <><AppBar title="Pawsure task link" onBack={onBack} /><main className="body">
    {err && <div className="empty"><b>{err}</b><p>Links work for one task only.</p></div>}
    {v && <>
      <div className="card"><span className="eyebrow">{v.kind === 'substitute' ? 'Sent on behalf of the helper' : 'Asked by ' + v.owner}</span><h2>{v.pet} · {v.tasks.map(t => t.title).join(', ')}</h2><div className="small">{v.tasks[0]?.time} · {v.tower}</div></div>
      {v.handlingNote && !v.accepted && <div className="hnote"><b>Handling note for {v.pet}: read this first</b><br />{v.handlingNote}<label className="check"><input type="checkbox" checked={read} onChange={e => setRead(e.target.checked)} /><span>I have read this</span></label></div>}
      {v.canAccept && <div className="btnrow"><button className="btn primary" disabled={!!v.handlingNote && !read} onClick={() => act('accept', { noteRead: read })}>{v.kind === 'substitute' ? 'Open the details' : 'Accept'}</button>{v.kind !== 'substitute' && <button className="btn" onClick={() => act('decline')}>Decline</button>}</div>}
      {msg && <Banner kind="info" icon="ℹ">{msg}</Banner>}
      {v.details ? <div className="card"><span className="eyebrow">Only for this visit</span><div><b>Flat {v.details.flat}, {v.details.tower}</b></div><div className="small">Gate: {v.details.gate}</div><div className="small">Key: {v.details.key}</div><div className="small">{v.details.instructions}</div>
        <div className="btnrow"><button className="btn primary" onClick={() => act('done')}>📷 Done: send photo</button><button className="btn" onClick={() => act('cant')}>Can’t make it</button></div></div>
        : <p className="xs muted">{v.notice}</p>}
      <p className="xs muted">Pawsure is not an emergency or vet service. {v.tasks.map(t => `${t.title}: ${t.label}`).join(' · ')}</p>
    </>}
  </main></>;
}
export const linkTime = fmt;
