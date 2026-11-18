/**
 * Find cover, as a conversation. Pawly asks "How can I help?", the owner types or speaks what they need, and
 * Pawly shows friends who can help. Asking a friend stays in the chat: a short progressive form (what, which pet,
 * when, access), a preview of the WhatsApp message, Send, then the friend's reply and Confirm, all as messages.
 * Nothing is sent without the owner tapping Send.
 */
import { t as tr } from '../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, fmt, type FFTask, type FriendSummary, type Pet, type ReqView, type SearchResult } from '../api';
import { AppBar, Icon, personSrc } from '../ui';
import { useVoice } from '../voice';
import { StepForm } from './Intake';

const avatarSrc = (f: { id: string; name: string }) => personSrc(f.id, f.name); // friends are people: the people portraits
const STEPS = ['Understanding what you need', 'Checking who is free', 'Finding friends nearby'];
const TASKS: [FFTask, string][] = [['feed', 'Feed'], ['walk', 'Short walk'], ['meds', 'Medicine'], ['water', 'Water'], ['litter', 'Litter tray'], ['toilet', 'Toilet pad']];
const ACCESS = ['Key handover', 'Someone at home', 'Friend has key'];
const TIMES = Array.from({ length: 34 }, (_, i) => 420 + i * 30); // 7:00 AM to 11:30 PM
const first = (name: string) => name.split(' ')[0] ?? name;

/** A first guess at the form's answers from what the owner said; every guess can be changed in the form. */
function guess(text: string, pets: Pet[]) {
  const s = text.toLowerCase();
  const RX: Record<FFTask, RegExp> = { feed: /feed|food|lunch|dinner|breakfast|meal|eat/, walk: /walk|take (him|her|them) down/, meds: /medicine|meds|tablet|pill|dose/, water: /water/, litter: /litter/, toilet: /toilet|pad/ };
  const tasks = TASKS.filter(([k]) => RX[k].test(s)).map(([, l]) => l);
  const named = pets.filter(p => s.includes(p.name.toLowerCase())).map(p => p.name);
  let time: number | null = null;
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (m) { let h = Number(m[1]) % 12; if (m[3] === 'pm') h += 12; time = h * 60 + Number(m[2] ?? 0); }
  else if (/morning/.test(s)) time = 540; else if (/afternoon/.test(s)) time = 840; else if (/evening|tonight/.test(s)) time = 1080; else if (/night/.test(s)) time = 1260;
  if (time != null) time = Math.min(1410, Math.max(420, Math.round(time / 30) * 30));
  return { tasks: tasks.length ? tasks : ['Feed'], pets: named.length ? named : pets[0] ? [pets[0].name] : [], time };
}

type Friend = { id: string; name: string; distance: string; availability?: string };
type Msg =
  | { role: 'bot'; text: string; note?: string }
  | { role: 'me'; text: string }
  | { role: 'thinking'; label?: string }
  | { role: 'friends'; ask: string; friends: Friend[]; reqId?: string; sr?: SearchResult }
  | { role: 'form'; ask: string; friend: Friend }
  | { role: 'preview'; reqId: string; friend: Friend; message: string; summary: string; sent?: boolean }
  | { role: 'status'; reqId: string; friend: Friend };
type Of<R extends Msg['role']> = Extract<Msg, { role: R }>;

const PAWLY = `${import.meta.env.BASE_URL}assets/pawly-sparkle.webp`;
const PawlyAv = () => <span className="ai-av" aria-hidden="true"><img src={PAWLY} alt="" width={46} height={46} /></span>;
function Bot({ children }: { children: ReactNode }) {
  return <div className="cb-row bot"><PawlyAv /><div className="cb bot">{children}</div></div>;
}

export function CoverAssistant({ hh, pets, me = '', meName = '', onForm, onInvite }: { hh: string; pets: Pet[]; me?: string; meName?: string; onForm: () => void; onInvite?: () => void }) {
  const pet = pets[0]?.name ?? 'my pet';
  const H = `/v1/households/${hh}`;
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'bot', text: tr('How can I help?') }]);
  const [draft, setDraft] = useState(''); const [busy, setBusy] = useState(false); const [step, setStep] = useState(0);
  const mic = useVoice(); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [msgs, step]);
  useEffect(() => { if (!busy) return; setStep(0); const iv = setInterval(() => setStep(s => Math.min(STEPS.length - 1, s + 1)), 800); return () => clearInterval(iv); }, [busy]);
  const say = (...m: Msg[]) => setMsgs(x => [...x.filter(y => y.role !== 'thinking'), ...m]);
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  const errText = (e: unknown) => e instanceof ApiError ? String(e.body.message ?? e.body.error) : tr('I can’t reach Pawsure right now.');
  const petNames = (r: ReqView) => { const p = r.parsed; const ids = p?.petIds?.length ? p.petIds : p?.petId ? [p.petId] : []; return ids.map(i => pets.find(x => x.id === i)?.name).filter(Boolean).join(' and '); };
  const summaryOf = (r: ReqView) => { const p = r.parsed; if (!p) return r.text ?? ''; return [p.tasks.map(t => TASKS.find(x => x[0] === t)?.[1]).join(' + '), petNames(r), p.time != null ? fmt(p.time) : '', p.access ?? ''].filter(Boolean).join(' · '); };

  /** Any request: think for a moment, then show friends who can be asked. */
  const send = async (text: string) => {
    const ask = text.trim(); if (!ask || busy) return;
    if (mic.listening) mic.toggle(() => {});
    setDraft(''); setBusy(true);
    setMsgs(m => [...m, { role: 'me', text: ask }, { role: 'thinking' }]);
    const [friends] = await Promise.all([api<FriendSummary[]>(`${H}/friends`).catch(() => [] as FriendSummary[]), wait(2400)]);
    const shown = friends.filter(f => f.findable).slice(0, 3);
    say(shown.length ? { role: 'friends', ask, friends: shown } : { role: 'bot', text: tr('None of your friends can be asked yet. Invite a friend, or use the request form and I’ll suggest other options.') });
    setBusy(false);
  };

  /** Ask: open the small form in the chat; from a search result the details are known, so go straight to the message. */
  const ask = (m: Of<'friends'>, f: Friend) => {
    if (busy) return;
    const known = m.reqId && m.sr ? m.sr.top.find(t => t.id === f.id) : undefined;
    setMsgs(x => [...x, { role: 'me', text: `${tr('Ask')} ${first(f.name)}` },
      known ? { role: 'preview', reqId: m.reqId!, friend: f, message: known.message, summary: summaryOf(m.sr!.request) } : { role: 'form', ask: m.ask, friend: f }]);
  };

  /** The form is done: make the request, check the friend can do it, and show the message for approval. */
  const submit = async (f: Friend, v: Record<string, string>) => {
    const what = v.what!.split('|'); const names = v.pets ? v.pets.split('|') : pets[0] ? [pets[0].name] : [];
    const tasks = what.map(l => TASKS.find(x => x[1] === l)![0]);
    const ids = names.map(n => pets.find(p => p.name === n)?.id).filter(Boolean) as string[];
    const time = TIMES.find(t => fmt(t) === v.when) ?? 1080;
    const summary = [what.join(' + '), names.join(' and '), v.when, v.access].filter(Boolean).join(' · ');
    setBusy(true);
    setMsgs(x => [...x, { role: 'me', text: summary }, { role: 'thinking', label: `${tr('Checking')} ${first(f.name)} ${tr('is free')}` }]);
    try {
      const r = await api<ReqView>(`${H}/requests`, { body: { manual: { tasks, petId: ids[0], petIds: ids, time, access: v.access } } });
      const [sr] = await Promise.all([api<SearchResult>(`${H}/requests/${r.id}/search`, { body: {} }), wait(1200)]);
      const mine = sr.top.find(t => t.id === f.id);
      if (mine) say({ role: 'preview', reqId: r.id, friend: f, message: mine.message, summary: summaryOf(sr.request) });
      else if (sr.top.length) say({ role: 'bot', text: `${first(f.name)} ${tr('can’t do this one at')} ${v.when}.`, note: tr('These friends can. Nothing is sent until you tap Send.') }, { role: 'friends', ask: summary, reqId: r.id, sr, friends: sr.top.map(t => ({ id: t.id, name: t.name, distance: t.distance })) });
      else say({ role: 'bot', text: `${tr('No friend is free for this at')} ${v.when}.`, note: tr('Try another time, or invite more friends.') });
    } catch (e) { say({ role: 'bot', text: errText(e) }); }
    setBusy(false);
  };

  const approve = async (m: Of<'preview'>) => {
    setBusy(true);
    try {
      await api(`${H}/requests/${m.reqId}/approve`, { body: { friendIds: [m.friend.id], mode: 'one', approved: true } });
      setMsgs(x => [...x.map(y => y === m ? { ...m, sent: true } : y), { role: 'status', reqId: m.reqId, friend: m.friend }]);
    } catch (e) { say({ role: 'bot', text: errText(e) }); }
    setBusy(false);
  };

  // Only the latest form or preview takes input; earlier ones stay in the chat as history.
  const live = [...msgs].reverse().find(m => m.role === 'form' || m.role === 'preview' || m.role === 'status' || m.role === 'friends');
  return <>
    <AppBar title={tr('Find cover')} />
    <div className="ai-sub"><span className="ai-spark-sm" aria-hidden="true">✦</span><span><b>Pawly</b>, {tr('your cover assistant')}</span></div>
    <div className="body ai-chat" aria-live="polite">
      {msgs.map((m, i) => {
        if (m.role === 'me') return <div key={i} className="cb-row me"><div className="cb me">{m.text}</div><img className="me-av" src={personSrc(me, meName)} alt="" width={30} height={30} /></div>;
        if (m.role === 'bot') return <Bot key={i}>{i === 0 ? <><h2 className="ai-hello">{m.text} <span aria-hidden="true">👋</span></h2><span className="cb-note">{tr('Tell me what you need, by typing or speaking. For example:')} “{tr('Can someone feed')} {pet} {tr('at 6 PM today?')}”</span></> : <>{m.text}{m.note && <span className="cb-note">{m.note}</span>}</>}</Bot>;
        if (m.role === 'thinking') return <div key={i} className="ai-think" role="status" aria-label="Pawly is thinking">
          <div className="ai-orb"><span /><span /><span /><i /></div>
          <div className="ai-wave" aria-hidden="true">{Array.from({ length: 9 }, (_, k) => <b key={k} style={{ animationDelay: `${k * 0.09}s` }} />)}</div>
          <div className="ai-step">{m.label ?? tr(STEPS[step]!)}…</div></div>;
        if (m.role === 'friends') return <div key={i} className="ai-results">
          {!m.reqId && <Bot>{tr('Here are friends who can help.')} <span className="cb-note">{tr('Nothing is sent until you approve the message.')}</span></Bot>}
          {m.friends.map(f => <div key={f.id} className="friend-card">
            <img className="friend-av" src={avatarSrc(f)} alt="" width={52} height={52} />
            <div className="grow"><b>{f.name}</b><div className="small muted">{f.distance}</div>{f.availability && <div className="xs fc-free">● {f.availability}</div>}</div>
            {m === live && <button type="button" className="btn primary sm" disabled={busy} onClick={() => ask(m, f)}>{tr('Ask')} {first(f.name)}</button>}</div>)}
        </div>;
        if (m.role === 'form') {
          if (m !== live) return null; // a finished form shows as the owner's reply instead
          const g = guess(m.ask, pets); const who = first(m.friend.name);
          return <div key={i} className="ai-form-wrap"><Bot>{tr('A few quick details for')} {who}.</Bot>
            <StepForm key={`f${i}`} title={`${tr('Ask')} ${who}`} mic={mic} busy={busy} submit="Review message" fields={[
              { id: 'what', label: `${tr('What should')} ${who} ${tr('do?')}`, kind: 'multi', options: TASKS.map(t => t[1]), initial: g.tasks.join('|') },
              ...(pets.length > 1 ? [{ id: 'pets', label: tr('For which pet?'), kind: 'multi' as const, options: pets.map(p => p.name), initial: g.pets.join('|') }] : []),
              { id: 'when', label: tr('When?'), kind: 'pick', placeholder: tr('Choose a time'), choices: TIMES.map(t => ({ value: fmt(t), label: fmt(t) })), initial: g.time != null ? fmt(g.time) : '' },
              { id: 'access', label: tr('How will they get in?'), kind: 'choice', options: ACCESS, hint: tr('Flat and key details are shared only after you confirm.') }]}
              onSubmit={v => submit(m.friend, v)} /></div>;
        }
        if (m.role === 'preview') return <div key={i} className="ai-preview">
          <Bot>{tr('Here’s the WhatsApp message for')} {first(m.friend.name)}. <span className="cb-note">{m.summary}</span></Bot>
          <div className="wa-preview"><img src={avatarSrc(m.friend)} alt="" width={32} height={32} /><div className="wa-bub">{m.message}</div></div>
          {!m.sent && m === live && <div className="btnrow even ai-actions"><button type="button" className="btn sm" disabled={busy} onClick={() => setMsgs(x => [...x, { role: 'form', ask: m.summary, friend: m.friend }])}>{tr('Change details')}</button>
            <button type="button" className="btn primary sm" disabled={busy} onClick={() => approve(m)}><Icon name="send" size={16} />{tr('Send on WhatsApp')}</button></div>}
        </div>;
        return <ReplyStatus key={i} H={H} m={m} />;
      })}
      {msgs.length === 1 && <div className="ai-suggest">{([[`${tr('Feed')} ${pet} ${tr('at 6 PM today')}`, 'food'], [`${tr('Walk')} ${pet} ${tr('this evening')}`, 'walk'], [tr('Someone to look in while I travel'), 'home']] as const).map(([sg, ic]) => <button key={sg} type="button" className="ai-chip" onClick={() => send(sg)}><span className={`ai-chip-ic ic-${ic}`} aria-hidden="true"><Icon name={ic} size={20} /></span>{sg}</button>)}</div>}
      {onInvite && msgs.some(m => m.role === 'bot' && m.text.startsWith(tr('None of your friends'))) && <button className="btn sm" onClick={onInvite}>{tr('Invite a friend')}</button>}
      <div ref={end} />
    </div>
    <form className="composer ai-composer" onSubmit={e => { e.preventDefault(); send(draft); }}>
      {mic.listening && <div className="cb-live" role="status"><span className="geo-dot" aria-hidden="true" />{mic.partial || tr('Listening… speak now')}</div>}
      {mic.error && <div className="cb-err" role="alert">{mic.error}</div>}
      <div className="cb-input">
        <label htmlFor="ai-in" className="sr-only">{tr('Ask Pawly')}</label>
        <input id="ai-in" className="input" value={draft} onChange={e => setDraft(e.target.value)} placeholder={mic.listening ? tr('Listening…') : tr('Ask Pawly for help with your pet…')} autoComplete="off" disabled={busy} />
        {mic.available && <button type="button" className={`cb-mic${mic.listening ? ' on' : ''}`} aria-label={mic.listening ? 'Stop voice input' : 'Speak your request'} aria-pressed={mic.listening} disabled={busy} onClick={() => mic.toggle(t => setDraft(d => (d ? d + t : t.trimStart())))}><Icon name="mic" size={20} /></button>}
        <button type="submit" className="cb-send ai-send" aria-label="Send" disabled={!draft.trim() || busy}><Icon name="send" size={20} /></button>
      </div>
    </form>
  </>;
}

/** After Send: the friend's reply, live, with Confirm when they say yes. */
function ReplyStatus({ H, m }: { H: string; m: Of<'status'> }) {
  const [r, setR] = useState<ReqView | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const load = () => api<ReqView>(`${H}/requests/${m.reqId}`).then(setR).catch(() => {}); load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [H, m.reqId]);
  const who = first(m.friend.name);
  const rec = r?.recipients.find(x => x.friendId === m.friend.id);
  const confirm = async () => { setBusy(true); setErr(null); try { setR(await api<ReqView>(`${H}/requests/${m.reqId}/confirm`, { body: { friendId: m.friend.id } })); } catch (e) { setErr(e instanceof ApiError ? String(e.body.message ?? e.body.error) : 'Can’t reach Pawsure.'); } setBusy(false); };
  let text = `${tr('Sent to')} ${who} ${tr('on WhatsApp.')}`, note = '', tone = 'wait', action = false;
  if (r && rec) {
    if (r.state === 'Completed') { text = `${tr('Done. Thank you,')} ${who}!`; tone = 'ok'; }
    else if (r.state === 'Confirmed' || rec.state === 'confirmed') { text = `${tr('Confirmed.')} ${who} ${tr('is covering this.')}`; note = tr('Flat, key and pet notes are shared with them for this visit only.'); tone = 'ok'; }
    else if (rec.state === 'accepted' || rec.state === 'waiting') { text = `${who} ${tr('said yes!')}`; note = tr('Confirm to share the access details.'); tone = 'ok'; action = true; }
    else if (rec.state === 'proposed' && rec.proposal != null) { text = `${who} ${tr('suggested')} ${fmt(rec.proposal)}.`; note = tr('Confirm to keep that time.'); action = true; }
    else if (['declined', 'expired', 'withdrawn', 'cancelled'].includes(rec.state)) { text = `${who} ${tr('can’t do it this time.')}`; note = tr('Type a new request to ask someone else.'); tone = 'no'; }
    else note = `${tr('Waiting for a reply · expires')} ${fmt(rec.sentAt + 15)}`;
  }
  return <div className="cb-row bot"><PawlyAv />
    <div className={`cb bot ai-status ${tone}`} role="status" aria-label={text}>{tone === 'wait' && <span className="geo-dot" aria-hidden="true" />}{text}{note && <span className="cb-note">{note}</span>}
      {action && <button type="button" className="btn primary sm" disabled={busy} onClick={confirm}>{rec?.state === 'proposed' ? `${tr('Confirm')} ${fmt(rec.proposal!)}` : `${tr('Confirm')} ${who}`}</button>}
      {err && <span className="cb-err" role="alert">{err}</span>}</div></div>;
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
