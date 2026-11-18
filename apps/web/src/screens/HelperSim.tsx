/**
 * DEMO ONLY: plays Sunita's WhatsApp / basic phone against the real webhooks so the flow can be tested end to end.
 * Hidden unless the API runs in DEMO_MODE. Real helpers use WhatsApp or a basic phone — never this screen.
 */
import { useEffect, useRef, useState } from 'react';
import { api, API, type DayView } from '../api';

interface Msg { template?: string | null; gloss?: string | null; direction: 'in' | 'out'; body: string; buttons: { id: string; label: string }[] | null; at: string; task_id: string | null }
/** Sunita in the seeded demo; in a new home, whoever the owner invited (looked up below). */
const SUNITA = { mid: 'm_sunita', phone: '+919000000035' };

export function HelperSim({ hh, day, onChange }: { hh: string; day: DayView | null; onChange: () => void }) {
  const [HELPER, setHelper] = useState({ ...SUNITA, name: 'Sunita' });
  useEffect(() => { api<{ mid: string; phone: string; name: string }>(`/demo/helper-of/${hh}`, { auth: false }).then(h => setHelper({ mid: h.mid, phone: h.phone, name: h.name.split(' ')[0] || 'Sunita' })).catch(() => setHelper({ ...SUNITA, name: 'Sunita' })); }, [hh]);
  const [thread, setThread] = useState<Msg[]>([]); const [code, setCode] = useState<string>(''); const [lookin, setLookin] = useState<string | null>(null);
  /** Today's code from the owner's card (the simulated helper reads it off the card on the food box). */
  const todayCode = async () => { try { const c = await api<{ codes: Record<string, string>; today: number }>(`/v1/households/${hh}/code-cards/current`); return c.codes[c.today] ?? ''; } catch { return ''; } };
  const load = async () => {
    setThread(await api<Msg[]>(`/demo/helper-thread/${HELPER.mid}`, { auth: false }));
    setCode(await todayCode());
    const out = await fetch(API + '/demo/outbox').then(r => r.json()) as { template: string; body: string }[];
    const l = out.find(o => o.template.startsWith('LOOKIN-15')); setLookin(l ? (JSON.parse(l.body) as { link: string }).link : null);
  };
  useEffect(() => { load(); }, [day?.now, HELPER.mid]);
  const send = async (body: Record<string, unknown>) => { await api('/webhooks/whatsapp', { body: { messageId: 'sim-' + Date.now(), from: HELPER.phone, ...body }, auth: false }); await api('/jobs/tick', { body: {}, auth: false }); await load(); onChange(); };
  const ivr = async (event: string, extra: Record<string, unknown>) => { await api('/webhooks/ivr', { body: { callId: 'sim-' + Date.now(), from: HELPER.phone, event, ...extra }, auth: false }); await api('/jobs/tick', { body: {}, auth: false }); await load(); onChange(); };
  const prompted = day?.tasks.filter(t => thread.some(m => m.task_id === t.id && m.direction === 'out')) ?? [];
  const [taskId, setTaskId] = useState('');
  const t = prompted.find(x => x.id === taskId) ?? prompted.find(x => !['Confirmed', 'Likely'].includes(x.ev.state)) ?? prompted[0];
  // The latest random start / end code Pawsure sent after an arrival or exit call (read back from her chat).
  const lastCode = [...thread].reverse().find(m => m.direction === 'out' && (m.template === 'W_VISIT_CODE_START' || m.template === 'W_VISIT_CODE_END'));
  const visitCode = lastCode?.body.match(/\b(\d{3})\b/)?.[1] ?? null;
  const codeVisit = t?.visitId ?? day?.tasks.find(x => x.visitId)?.visitId ?? null;
  return <div className="sheet" style={{ maxHeight: 'none', borderRadius: 0, background: 'var(--wa-bg)', color: 'var(--wa-ink)' }}>
    <div className="banner sim"><span className="bi">⚙</span><div>{HELPER.name}’s phone (simulated). Nothing reaches a real phone.</div></div>
    <div className="wa-body" style={{ maxHeight: 280, overflow: 'auto', background: 'var(--wa-bg)', borderRadius: 12 }}>
      {thread.slice(-12).map((m, i) => <div key={i} className={`bub ${m.direction === 'out' ? 'in' : 'out'}`}>{m.body}{m.gloss && <div className="gloss">EN: {m.gloss}</div>}
        {m.buttons && <div className="qr">{m.buttons.map(b => <button key={b.id} onClick={() => send({ type: 'button', payload: b.id })}>{b.label}</button>)}</div>}</div>)}
      {!thread.length && <div className="bub sys">No messages yet.</div>}
    </div>
    {prompted.length > 0 && <div className="field"><label htmlFor="simt" className="xs">Replying to</label><select id="simt" className="input" value={t?.id} onChange={e => setTaskId(e.target.value)}>{prompted.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>}
    <div className="chips">
      {t && <><button className="btn sm" onClick={async () => send({ type: 'photo', taskId: t.id, mediaRef: 'sim-' + Date.now(), caption: code || await todayCode() })}>📷 Photo + today’s code</button>
        <button className="btn sm" onClick={() => send({ type: 'photo', taskId: t.id, mediaRef: 'sim-' + Date.now() })}>📷 Photo, no code</button>
        <button className="btn sm" onClick={() => send({ type: 'photo', taskId: t.id, mediaRef: 'sim-' + Date.now(), caption: '0000' })}>📷 Wrong code</button>
        <button className="btn sm" onClick={() => send({ type: 'photo', taskId: t.id, mediaRef: 'sim-reused', caption: code })}>📷 Re-send old photo</button>
        <button className="btn sm" onClick={() => send({ type: 'voice', taskId: t.id })}>🎤 Voice note</button>
        <button className="btn sm" onClick={() => ivr('code', { taskId: t.id, digits: code })}>☎ IVR code</button></>}
      {t?.visitId && <><button className="btn sm" onClick={() => ivr('arrive', { visitId: t.visitId })}>☎ Arrival call</button><button className="btn sm" onClick={() => ivr('exit', { visitId: t.visitId })}>☎ Exit call</button></>}
      {visitCode && codeVisit && <><button className="btn sm" onClick={() => send({ type: 'photo', visitId: codeVisit, mediaRef: 'sim-' + Date.now(), caption: visitCode })}>📷 Photo with the {lastCode!.template === 'W_VISIT_CODE_START' ? 'start' : 'end'} code</button>
        <button className="btn sm" onClick={() => send({ type: 'photo', visitId: codeVisit, mediaRef: 'sim-' + Date.now(), caption: visitCode === '999' ? '998' : '999' })}>📷 Photo with a wrong visit code</button></>}
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

/**
 * DEMO ONLY: the helper's WhatsApp, as she sees it (the same page reviewers get as the helper journey), shown
 * beside the owner's phone. Her taps there are sent here and played against the real webhooks, so the owner's
 * Home changes from "Invite pending" to "Accepted" while you watch.
 */
export function HelperWhatsApp({ hh, owner, pets, onChange, onClose }: { hh: string; owner: string; pets: string[]; onChange: () => void; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [helper, setHelper] = useState<{ mid: string; phone: string; name: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { api<{ mid: string; phone: string; name: string }>(`/demo/helper-of/${hh}`, { auth: false }).then(setHelper).catch(() => setHelper(null)); }, [hh]);
  const first = helper?.name.split(' ')[0] ?? 'Your helper';
  // '*' with a source check on the way back: the phone page may be served from the artifact's own file host.
  const setup = () => frame.current?.contentWindow?.postMessage({ pawsure: 'setup', names: { helper: first, owner: owner.split(' ')[0] || 'Your owner', pets: pets.length ? pets : ['your pet'] } }, '*');
  useEffect(setup, [first, owner, pets.join()]);
  useEffect(() => {
    const on = async (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.pawsure !== 'helper-phone') return;
      if (e.data.action === 'joined') await join(e.data.method ?? 'photo');
      if (e.data.action === 'id_sent') setNote(`${first} sent a photo ID.`);
    };
    addEventListener('message', on); return () => removeEventListener('message', on);
  }, [helper, hh, first]);
  /** She said Yes and chose how to check in: the same WhatsApp replies a real helper sends. */
  const [joined, setJoined] = useState(false); const joinedRef = useRef(false);
  async function join(method: string) {
      const h = helper ?? await api<{ mid: string; phone: string; name: string }>(`/demo/helper-of/${hh}`, { auth: false }).catch(() => null);
      if (!h || joinedRef.current) return;
      joinedRef.current = true;
      const reply = (payload: string) => api('/webhooks/whatsapp', { body: { messageId: 'wa-' + Date.now() + Math.random().toString(36).slice(2, 6), from: h.phone, type: 'button', payload: `${payload}:${hh}` }, auth: false });
      setJoined(true);
      await reply('consent_yes'); await reply('method_' + method);
      await api('/jobs/tick', { body: {}, auth: false });
      setNote(`${first} joined with ${method === 'photo' ? 'photo' : method === 'voice' ? 'voice-note' : 'missed-call'} check-ins. Her invite is now accepted on your Home.`);
      onChange();
  }
  return <div className="wa-dock" aria-label={`${first}’s WhatsApp (simulated)`}>
    <div className="banner sim"><span className="bi">⚙</span><div className="grow">{first}’s WhatsApp (simulated). Tap the highlighted part of her phone.</div><button className="btn ghost sm" onClick={onClose}>Hide</button></div>
    {note && <div className="banner info wa-note" role="status">{note}</div>}
    {!joined && <button type="button" className="btn ghost sm" onClick={() => join('photo')}>{first} said Yes (if her phone doesn’t respond)</button>}
    <iframe ref={frame} title={`${first}’s WhatsApp (simulated)`} src={`${import.meta.env.BASE_URL}helper-phone.html`} onLoad={setup} />
  </div>;
}
