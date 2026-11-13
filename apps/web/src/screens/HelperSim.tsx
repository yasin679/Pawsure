/**
 * DEMO ONLY: plays Sunita's WhatsApp / basic phone against the real webhooks so the flow can be tested end to end.
 * Hidden unless the API runs in DEMO_MODE. Real helpers use WhatsApp or a basic phone — never this screen.
 */
import { useEffect, useState } from 'react';
import { api, API, type DayView } from '../api';

interface Msg { gloss?: string | null; direction: 'in' | 'out'; body: string; buttons: { id: string; label: string }[] | null; at: string; task_id: string | null }
const HELPER = { mid: 'm_sunita', phone: '+919000000035' };

export function HelperSim({ hh, day, onChange }: { hh: string; day: DayView | null; onChange: () => void }) {
  const [thread, setThread] = useState<Msg[]>([]); const [code, setCode] = useState<string>(''); const [lookin, setLookin] = useState<string | null>(null);
  const load = async () => {
    setThread(await api<Msg[]>(`/demo/helper-thread/${HELPER.mid}`, { auth: false }));
    try { const c = await api<{ codes: Record<string, string>; today: number }>(`/v1/households/${hh}/code-cards/current`); setCode(c.codes[c.today] ?? ''); } catch { /* not owner */ }
    const out = await fetch(API + '/demo/outbox').then(r => r.json()) as { template: string; body: string }[];
    const l = out.find(o => o.template.startsWith('LOOKIN-15')); setLookin(l ? (JSON.parse(l.body) as { link: string }).link : null);
  };
  useEffect(() => { load(); }, [day?.now]);
  const send = async (body: Record<string, unknown>) => { await api('/webhooks/whatsapp', { body: { messageId: 'sim-' + Date.now(), from: HELPER.phone, ...body }, auth: false }); await api('/jobs/tick', { body: {}, auth: false }); await load(); onChange(); };
  const ivr = async (event: string, extra: Record<string, unknown>) => { await api('/webhooks/ivr', { body: { callId: 'sim-' + Date.now(), from: HELPER.phone, event, ...extra }, auth: false }); await api('/jobs/tick', { body: {}, auth: false }); onChange(); };
  const prompted = day?.tasks.filter(t => thread.some(m => m.task_id === t.id && m.direction === 'out')) ?? [];
  const [taskId, setTaskId] = useState('');
  const t = prompted.find(x => x.id === taskId) ?? prompted.find(x => !['Confirmed', 'Likely'].includes(x.ev.state)) ?? prompted[0];
  return <div className="sheet" style={{ maxHeight: 'none', borderRadius: 0, background: 'var(--wa-bg)', color: 'var(--wa-ink)' }}>
    <div className="banner sim"><span className="bi">⚙</span><div>Sunita’s phone (simulated). Nothing reaches a real phone.</div></div>
    <div className="wa-body" style={{ maxHeight: 280, overflow: 'auto', background: 'var(--wa-bg)', borderRadius: 12 }}>
      {thread.slice(-12).map((m, i) => <div key={i} className={`bub ${m.direction === 'out' ? 'in' : 'out'}`}>{m.body}{m.gloss && <div className="gloss">EN: {m.gloss}</div>}
        {m.buttons && <div className="qr">{m.buttons.map(b => <button key={b.id} onClick={() => send({ type: 'button', payload: b.id })}>{b.label}</button>)}</div>}</div>)}
      {!thread.length && <div className="bub sys">No messages yet.</div>}
    </div>
    {prompted.length > 0 && <div className="field"><label htmlFor="simt" className="xs">Replying to</label><select id="simt" className="input" value={t?.id} onChange={e => setTaskId(e.target.value)}>{prompted.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>}
    <div className="chips">
      {t && <><button className="btn sm" onClick={() => send({ type: 'photo', taskId: t.id, mediaRef: 'sim-' + Date.now(), caption: code })}>📷 Photo + today’s code</button>
        <button className="btn sm" onClick={() => send({ type: 'photo', taskId: t.id, mediaRef: 'sim-' + Date.now() })}>📷 Photo, no code</button>
        <button className="btn sm" onClick={() => send({ type: 'photo', taskId: t.id, mediaRef: 'sim-' + Date.now(), caption: '0000' })}>📷 Wrong code</button>
        <button className="btn sm" onClick={() => send({ type: 'photo', taskId: t.id, mediaRef: 'sim-reused', caption: code })}>📷 Re-send old photo</button>
        <button className="btn sm" onClick={() => send({ type: 'voice', taskId: t.id })}>🎤 Voice note</button>
        <button className="btn sm" onClick={() => ivr('code', { taskId: t.id, digits: code })}>☎ IVR code</button></>}
      {t?.visitId && <><button className="btn sm" onClick={() => ivr('arrive', { visitId: t.visitId })}>☎ Arrival call</button><button className="btn sm" onClick={() => ivr('exit', { visitId: t.visitId })}>☎ Exit call</button></>}
      <button className="btn sm" onClick={() => send({ type: 'button', payload: 'problem_pet_hurt:' + hh })}>⚠ Pet hurt</button>
      <button className="btn sm" onClick={() => send({ type: 'button', payload: 'problem_water_out:' + hh })}>⚠ Water ran out</button>
      <button className="btn sm" onClick={() => send({ type: 'text', text: 'येऊ शकत नाही' })}>✕ “येऊ शकत नाही” (can’t come)</button>
      <button className="btn sm" onClick={() => ivr('reminder', { digits: '1' })}>☎ Reminder call: press 1</button>
      <button className="btn sm" onClick={() => ivr('reminder', { digits: '2' })}>☎ Reminder call: press 2</button>
      <button className="btn sm" onClick={() => ivr('cant', {})}>☎ Missed-call line: press 2 (can’t come)</button>
      <button className="btn sm" onClick={() => send({ type: 'text', text: 'लता पवार 90000 00077' })}>Send name: लता पवार 90000 00077</button>
      <button className="btn sm" onClick={() => send({ type: 'text', text: 'change' })}>↺ Change method</button>
      <button className="btn sm" onClick={() => send({ type: 'text', text: 'stop' })}>⏹ Stop</button>
      <button className="btn sm" onClick={() => send({ type: 'text', text: 'start' })}>▶ Start again</button>
    </div>
    {lookin && <button className="btn sm block" onClick={() => { location.hash = 'lookin-' + lookin.replace(/^\/l\//, ''); }}>Open the backup’s look-in link (Ankita)</button>}
    {!prompted.length && <p className="xs">Task prompts arrive 10 minutes before each task. Move the clock forward.</p>}
  </div>;
}
