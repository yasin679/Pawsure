/** DEMO ONLY: friends’ WhatsApp phones, replying through the real webhook. Hidden unless the API runs in DEMO_MODE. */
import { useEffect, useState } from 'react';
import { api } from '../api';

const FRIENDS: [string, string, string][] = [['u_priya', 'Priya', '+919900000012'], ['u_arjun', 'Arjun', '+919800000077'], ['u_kavya', 'Kavya', '+919600000045'], ['u_meera', 'Meera', '+919700000090'], ['u_farhan', 'Farhan', '+919500000031'], ['u_rahul', 'Rahul', '+919300000002']];
interface Msg { request_id: string | null; direction: string; body: string; buttons: { id: string; label: string }[] | null; at: string }

export function FriendSim({ onChange }: { onChange: () => void }) {
  const [who, setWho] = useState(FRIENDS[0]!); const [thread, setThread] = useState<Msg[]>([]); const [text, setText] = useState(''); const [last, setLast] = useState<Record<string, unknown> | null>(null);
  const load = () => api<Msg[]>(`/demo/friend-thread/${who[0]}`, { auth: false }).then(setThread);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [who]);
  const send = async (body: Record<string, unknown>, replay = false) => {
    const msg = replay && last ? last : { messageId: 'fsim-' + Date.now(), from: who[2], ...body };
    if (!replay) setLast(msg);
    await api('/webhooks/whatsapp', { body: msg, auth: false }); await api('/jobs/tick', { body: {}, auth: false }); await load(); onChange();
  };
  const lastReq = [...thread].reverse().find(m => m.request_id)?.request_id;
  return <div className="sheet" style={{ maxHeight: 'none', borderRadius: 0, background: 'var(--wa-bg)', color: 'var(--wa-ink)' }}>
    <div className="banner sim"><span className="bi">⚙</span><div>Demo: friends’ phones, replying through the real webhook. Nothing reaches a real phone.</div></div>
    <div className="seg">{FRIENDS.map(f => <button key={f[0]} aria-pressed={who[0] === f[0]} onClick={() => setWho(f)}>{f[1]}</button>)}</div>
    <div className="wa-body" style={{ maxHeight: 280, overflow: 'auto', borderRadius: 12 }}>
      {thread.slice(-10).map((m, i) => <div key={i} className={`bub ${m.direction === 'out' ? 'in' : 'out'}`}>{m.body}{m.buttons && <div className="qr">{m.buttons.map(b => <button key={b.id} onClick={() => send({ type: 'button', payload: b.id })}>{b.label}</button>)}</div>}</div>)}
      {!thread.length && <div className="bub sys">No messages for {who[1]} yet.</div>}
    </div>
    <div className="row"><input className="input" aria-label="Reply text" placeholder="e.g. 5:30 la jamel / thoda late / haan" value={text} onChange={e => setText(e.target.value)} /><button className="btn sm" disabled={!text} onClick={() => send({ type: 'text', text }).then(() => setText(''))}>Send</button></div>
    <div className="chips">{lastReq && <button className="btn sm" onClick={() => send({ type: 'button', payload: 'ff_yes:' + lastReq })}>Late “Yes”</button>}{last && <button className="btn sm" onClick={() => send({}, true)}>⟲ Replay last webhook (duplicate)</button>}</div>
  </div>;
}
