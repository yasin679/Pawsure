/**
 * Find cover, as a conversation: Pawly asks "How can I help?", the owner types or speaks what they need,
 * Pawly thinks for a moment and shows friends who can help. "Ask" hands the request to the full request
 * flow (understand → search → approve → WhatsApp), so nothing is sent without the owner's approval.
 */
import { t as tr } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { api, type FriendSummary, type Pet } from '../api';
import { AppBar, Icon } from '../ui';
import { useVoice } from '../voice';

const POOL = ['golden', 'calico', 'husky', 'boston', 'hedgehog', 'turtle', 'bird'];
/** A friend's avatar, chosen steadily from their id. */
export const friendAvatar = (id: string) => POOL[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % POOL.length]!;
const STEPS = ['Understanding what you need', 'Checking who is free', 'Finding friends nearby'];
type Msg = { role: 'bot'; text: string } | { role: 'me'; text: string } | { role: 'thinking' } | { role: 'friends'; ask: string; friends: FriendSummary[] };

export function CoverAssistant({ hh, pets, onAsk, onForm, onInvite }: { hh: string; pets: Pet[]; onAsk: (text: string) => void; onForm: () => void; onInvite?: () => void }) {
  const pet = pets[0]?.name ?? 'my pet';
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'bot', text: tr('How can I help?') }]);
  const [draft, setDraft] = useState(''); const [busy, setBusy] = useState(false); const [step, setStep] = useState(0);
  const mic = useVoice(); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [msgs, step]);
  useEffect(() => { if (!busy) return; setStep(0); const iv = setInterval(() => setStep(s => Math.min(STEPS.length - 1, s + 1)), 800); return () => clearInterval(iv); }, [busy]);

  const send = async (text: string) => {
    const ask = text.trim(); if (!ask || busy) return;
    if (mic.listening) mic.toggle(() => {});
    setDraft(''); setBusy(true);
    setMsgs(m => [...m, { role: 'me', text: ask }, { role: 'thinking' }]);
    const [friends] = await Promise.all([
      api<FriendSummary[]>(`/v1/households/${hh}/friends`).catch(() => [] as FriendSummary[]),
      new Promise(r => setTimeout(r, 2400))
    ]);
    // Friends who can be asked come first; invited ones who haven't joined yet can't be asked.
    const shown = friends.filter(f => f.findable).slice(0, 3);
    setMsgs(m => [...m.filter(x => x.role !== 'thinking'), shown.length
      ? { role: 'friends', ask, friends: shown }
      : { role: 'bot', text: tr('None of your friends can be asked yet. Invite a friend, or use the request form and I’ll suggest other options.') }]);
    setBusy(false);
  };

  return <>
    <AppBar title={tr('Find cover')} />
    <div className="ai-sub"><span className="ai-spark-sm" aria-hidden="true"><Sparkle size={16} /></span>{tr('Pawly, your cover assistant')}<button type="button" className="linkbtn ai-form" onClick={onForm}>{tr('Use the request form')}</button></div>
    <div className="body ai-chat" aria-live="polite">
      {msgs.map((m, i) => m.role === 'me' ? <div key={i} className="cb-row me"><div className="cb me">{m.text}</div></div>
        : m.role === 'bot' ? <div key={i} className="cb-row bot"><span className="ai-av" aria-hidden="true"><Sparkle size={20} /></span><div className="cb bot">{i === 0 ? <><h2 className="ai-hello">{m.text}</h2><span className="cb-note">{tr('Tell me what you need, by typing or speaking. For example:')} “{tr('Can someone feed')} {pet} {tr('at 6 PM today?')}”</span></> : m.text}</div></div>
        : m.role === 'thinking' ? <div key={i} className="ai-think" role="status" aria-label="Pawly is thinking">
            <div className="ai-orb"><span /><span /><span /><i /></div>
            <div className="ai-wave" aria-hidden="true">{Array.from({ length: 9 }, (_, k) => <b key={k} style={{ animationDelay: `${k * 0.09}s` }} />)}</div>
            <div className="ai-step">{tr(STEPS[step]!)}…</div></div>
        : <div key={i} className="ai-results">
            <div className="cb-row bot"><span className="ai-av" aria-hidden="true"><Sparkle size={20} /></span><div className="cb bot">{tr('Here are friends who can help.')} <span className="cb-note">{tr('Nothing is sent until you approve the message.')}</span></div></div>
            {m.friends.map(f => <div key={f.id} className="friend-card">
              <img className="friend-av" src={`${import.meta.env.BASE_URL}assets/avatars/${friendAvatar(f.id)}.webp`} alt="" width={52} height={52} />
              <div className="grow"><b>{f.name}</b><div className="small muted">{f.distance}</div>{f.availability && <div className="xs fc-free">● {f.availability}</div>}</div>
              <button type="button" className="btn primary sm" onClick={() => onAsk(m.ask)}>{tr('Ask')} {f.name.split(' ')[0]}</button></div>)}
          </div>)}
      {msgs.length === 1 && <div className="cb-chips ai-suggest">{[`${tr('Feed')} ${pet} ${tr('at 6 PM today')}`, `${tr('Walk')} ${pet} ${tr('this evening')}`, tr('Someone to look in while I travel')].map(sg => <button key={sg} type="button" className="chip" onClick={() => send(sg)}>{sg}</button>)}</div>}
      {onInvite && msgs.some(m => m.role === 'bot' && m.text.startsWith(tr('None of your friends'))) && <button className="btn sm" onClick={onInvite}>{tr('Invite a friend')}</button>}
      <div ref={end} />
    </div>
    <form className="composer ai-composer" onSubmit={e => { e.preventDefault(); send(draft); }}>
      {mic.listening && <div className="cb-live" role="status"><span className="geo-dot" aria-hidden="true" />{mic.partial || tr('Listening… speak now')}</div>}
      {mic.error && <div className="cb-err" role="alert">{mic.error}</div>}
      <div className="cb-input">
        <label htmlFor="ai-in" className="sr-only">{tr('Ask Pawly')}</label>
        <input id="ai-in" className="input" value={draft} onChange={e => setDraft(e.target.value)} placeholder={mic.listening ? tr('Listening…') : tr('Ask for help with your pet…')} autoComplete="off" disabled={busy} />
        {mic.available && <button type="button" className={`cb-mic${mic.listening ? ' on' : ''}`} aria-label={mic.listening ? 'Stop voice input' : 'Speak your request'} aria-pressed={mic.listening} disabled={busy} onClick={() => mic.toggle(t => setDraft(d => (d ? d + t : t.trimStart())))}><Icon name="mic" size={20} /></button>}
        <button type="submit" className="cb-send ai-send" aria-label="Send" disabled={!draft.trim() || busy}><Icon name="send" size={20} /></button>
      </div>
    </form>
  </>;
}

/** The sparkle ("glitter") icon in a shiny moving gradient that matches the green and gold theme. */
let gid = 0;
export function Sparkle({ size = 22 }: { size?: number }) {
  const [id] = useState(() => 'spk' + (++gid));
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="sparkle">
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#9DBE7C" /><stop offset=".45" stopColor="#F2C14E" /><stop offset=".75" stopColor="#CC7655" /><stop offset="1" stopColor="#6F8F4E" />
      <animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="4s" repeatCount="indefinite" />
    </linearGradient></defs>
    <path fill={`url(#${id})`} d="M10.2 2.5c.4 3.9 2.1 6 6.3 6.6-4.2.7-5.9 2.8-6.3 6.7-.4-3.9-2.1-6-6.3-6.7 4.2-.6 5.9-2.7 6.3-6.6Z" />
    <path fill={`url(#${id})`} d="M18.2 12.6c.2 2.2 1.1 3.3 3.3 3.6-2.2.3-3.1 1.4-3.3 3.6-.3-2.2-1.2-3.3-3.4-3.6 2.2-.3 3.1-1.4 3.4-3.6Z" />
    <circle cx="18.6" cy="5.2" r="1.3" fill={`url(#${id})`} />
  </svg>;
}
