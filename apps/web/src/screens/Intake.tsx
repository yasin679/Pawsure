/**
 * Conversation-first onboarding (replaces the "About you" form and the "Your circle" question).
 * Pawly asks one thing at a time; answers appear as chat bubbles and can be tapped to change them until the home is created.
 * It saves exactly what the old form saved: POST /v1/households (name, language, state, city, society, tower, flat).
 */
import { t as tr } from '../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LANGUAGES } from '@pawsure/domain';
import { api, ApiError, nameError, type Society } from '../api';
import { AppBar, Art, Icon, LanguageOptions } from '../ui';
import { CircleBuilder } from './Cover';

type Q = 'name' | 'lang' | 'state' | 'city' | 'society' | 'tower' | 'flat' | 'confirm';
const ORDER: Q[] = ['name', 'lang', 'state', 'city', 'society', 'tower', 'flat', 'confirm'];
type Circle = null | 'ask' | 'yes' | 'no';
const QUICK_LANGS = ['en', 'hi', 'mr'];
const langLabel = (code: string) => { const l = LANGUAGES.find(x => x.code === code); return l ? (l.native === l.name ? l.name : `${l.native} · ${l.name}`) : code; };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function Bot({ children }: { children: ReactNode }) {
  return <div className="cb-row bot"><span className="cb-av" aria-hidden="true"><Art name="dogFace" width={30} /></span><div className="cb bot">{children}</div></div>;
}
function Me({ text, onEdit }: { text: string; onEdit?: () => void }) {
  return <div className="cb-row me">{onEdit
    ? <button type="button" className="cb me edit" onClick={onEdit} aria-label={`Change: ${text}`}>{text}<span className="cb-edit" aria-hidden="true">✎</span></button>
    : <div className="cb me">{text}</div>}</div>;
}
function Typing() { return <div className="cb-row bot"><span className="cb-av" aria-hidden="true"><Art name="dogFace" width={30} /></span><div className="cb bot typing" aria-label="Pawly is typing"><i /><i /><i /></div></div>; }

export function Intake({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState({ displayName: '', language: 'en', state: '', city: '', societyId: '', society: '', tower: '', flat: '' });
  const [q, setQ] = useState<Q>('name');
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');
  const [otherLang, setOtherLang] = useState(false);
  const [typedCity, setTypedCity] = useState(false); const [typedSoc, setTypedSoc] = useState(false);
  const [states, setStates] = useState<string[]>([]); const [cities, setCities] = useState<string[]>([]); const [socs, setSocs] = useState<Society[] | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [hh, setHh] = useState<string | null>(null); const [circle, setCircle] = useState<Circle>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { api<{ states: string[] }>('/v1/societies').then(r => setStates(r.states)).catch(() => setStates([])); }, []);
  useEffect(() => { if (p.state) api<{ cities: { city: string }[] }>(`/v1/societies?state=${encodeURIComponent(p.state)}`).then(r => setCities(r.cities.map(x => x.city))).catch(() => setCities([])); else setCities([]); }, [p.state]);
  useEffect(() => { setSocs(null); if (p.city) api<{ societies: Society[] }>(`/v1/societies?city=${encodeURIComponent(p.city)}`).then(r => { setSocs(r.societies); if (!r.societies.length) setTypedSoc(true); }).catch(() => { setSocs([]); setTypedSoc(true); }); }, [p.city]);
  // Pawly "types" for a moment before each new question (skipped for reduced motion).
  const stage = hh ? 'circle:' + circle : q;
  useEffect(() => { setReady(false); setErr(null); const t = setTimeout(() => setReady(true), reduced() ? 0 : 450); return () => clearTimeout(t); }, [stage]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: reduced() ? 'auto' : 'smooth' }); }, [stage, ready, err, socs, otherLang, typedCity, typedSoc]);

  const first = p.displayName.trim().split(/\s+/)[0] ?? '';
  const next = (from: Q) => { setDraft(''); setQ(ORDER[ORDER.indexOf(from) + 1]!); };
  const goTo = (to: Q) => {
    if (hh) return;
    setDraft(to === 'name' ? p.displayName : to === 'tower' ? p.tower : to === 'flat' ? p.flat : to === 'city' && typedCity ? p.city : to === 'society' && typedSoc ? p.society : '');
    setQ(to);
  };
  const answer: Record<Q, string> = {
    name: p.displayName, lang: langLabel(p.language), state: p.state, city: p.city, society: p.society,
    tower: p.tower || tr('Skip'), flat: p.flat ? '•••• ' + tr('(private)') : tr('Skip'), confirm: ''
  };
  const question = (k: Q): ReactNode => ({
    name: <>{tr('Hi, I’m Pawly')} 🐾 {tr('I’ll set up your Pawsure home with you. It takes about a minute.')}<br /><b>{tr('What should I call you?')}</b></>,
    lang: <>{tr('Nice to meet you')}, {first}! <b>{tr('Which language should messages to you be in?')}</b><span className="cb-note">{tr('The app is in English for now. Messages use your language where they’re written.')}</span></>,
    state: <><b>{tr('Where’s home?')}</b> {tr('Choose your state.')}</>,
    city: <><b>{tr('Which city?')}</b> {p.state ? `${tr('In')} ${p.state}.` : ''}</>,
    society: <><b>{tr('Which society or building do you live in?')}</b><span className="cb-note">{tr('This is your location anchor. Friends see your society and tower only.')}</span></>,
    tower: <><b>{tr('Which tower or wing?')}</b> {tr('Friends can see this, so they can find you.')}</>,
    flat: <><b>{tr('And your flat number?')}</b><span className="cb-note">🔒 {tr('Private. Only shown to a friend you confirm for a visit.')}</span></>,
    confirm: <>{tr('Here’s your home. Tap any answer above to change it.')}
      <dl className="cb-sum"><dt>{tr('Name')}</dt><dd>{p.displayName}</dd><dt>{tr('Language')}</dt><dd>{langLabel(p.language)}</dd>
        <dt>{tr('Society')}</dt><dd>{p.society}</dd>{p.tower && <><dt>{tr('Tower')}</dt><dd>{p.tower}</dd></>}<dt>{tr('City')}</dt><dd>{p.city}, {p.state}</dd>
        {p.flat && <><dt>{tr('Flat (private)')}</dt><dd>{p.flat}</dd></>}</dl></>
  })[k];

  const create = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await api<{ id: string }>('/v1/households', { body: { displayName: p.displayName.trim(), language: p.language, state: p.state, city: p.city, ...(p.societyId ? { societyId: p.societyId } : { society: p.society.trim() }), tower: p.tower.trim() || undefined, flat: p.flat.trim() || undefined } });
      setHh(r.id); setCircle('ask');
    } catch (e) { setErr(e instanceof ApiError ? 'Something didn’t save. Check your answers and try again.' : 'Can’t reach Pawsure. Check your connection.'); } finally { setBusy(false); }
  };
  const yes = () => { setCircle('yes'); setTimeout(onDone, reduced() ? 0 : 1100); };

  /** The answer area for the current question. */
  const send = (label: string, disabled: boolean, onSend: () => void) => <button type="submit" className="cb-send" disabled={disabled} aria-label={label} onClick={e => { e.preventDefault(); onSend(); }}><Icon name="send" size={20} /></button>;
  const text = (id: string, label: string, placeholder: string, onSend: (v: string) => void, opts: { optional?: boolean; validate?: (v: string) => string | null; mono?: boolean } = {}) => {
    const problem = draft.trim() && opts.validate ? opts.validate(draft) : null;
    const ok = !!draft.trim() && !problem;
    return <>{problem && <div className="cb-err" role="alert">{problem}</div>}
      <form className="cb-input" onSubmit={e => { e.preventDefault(); if (ok) onSend(draft.trim()); }}>
        <label htmlFor={id} className="sr-only">{label}</label>
        <input id={id} className={`input${opts.mono ? ' mono' : ''}`} autoFocus value={draft} placeholder={placeholder} onChange={e => setDraft(e.target.value)} autoComplete="off" />
        {send('Send', !ok, () => ok && onSend(draft.trim()))}
      </form>
      {opts.optional && <div className="cb-chips"><button type="button" className="chip" onClick={() => onSend('')}>{tr('Skip')}</button></div>}</>;
  };
  const composer = (): ReactNode => {
    switch (q) {
      case 'name': return text('nm', tr('Your name'), tr('Your name'), v => { setP({ ...p, displayName: v }); next('name'); }, { validate: v => nameError(v) });
      case 'lang': return <>
        <div className="cb-chips">{QUICK_LANGS.map(c => <button key={c} type="button" className="chip" aria-pressed={p.language === c} onClick={() => { setP({ ...p, language: c }); next('lang'); }}>{langLabel(c)}</button>)}
          <button type="button" className="chip" aria-pressed={otherLang} onClick={() => setOtherLang(true)}>{tr('Another language')}</button></div>
        {otherLang && <div className="cb-input"><label htmlFor="lg" className="sr-only">{tr('Your language')}</label><select id="lg" className="input" value={p.language} onChange={e => setP({ ...p, language: e.target.value })}><LanguageOptions /></select>{send('Send', false, () => next('lang'))}</div>}</>;
      case 'state': return <div className="cb-input"><label htmlFor="stt" className="sr-only">{tr('State')}</label>
        <select id="stt" className="input" value={p.state} onChange={e => { if (!e.target.value) return; setTypedCity(false); setTypedSoc(false); setP({ ...p, state: e.target.value, city: '', societyId: '', society: '' }); next('state'); }}>
          <option value="">{tr('Choose your state')}</option>{states.map(x => <option key={x} value={x}>{x}</option>)}</select></div>;
      case 'city': return typedCity
        ? <>{text('ctt', tr('City'), tr('Your city or town'), v => { setTypedSoc(true); setP({ ...p, city: v, societyId: '', society: '' }); next('city'); })}
          <div className="cb-chips"><button type="button" className="chip" onClick={() => { setTypedCity(false); setDraft(''); }}>{tr('Choose from the list')}</button></div></>
        : <><div className="cb-input"><label htmlFor="cty" className="sr-only">{tr('City')}</label>
          <select id="cty" className="input" value={p.city} onChange={e => { if (!e.target.value) return; setTypedSoc(false); setP({ ...p, city: e.target.value, societyId: '', society: '' }); next('city'); }}>
            <option value="">{tr('Choose your city')}</option>{cities.map(x => <option key={x} value={x}>{x}</option>)}</select></div>
          <div className="cb-chips"><button type="button" className="chip" onClick={() => { setTypedCity(true); setDraft(''); }}>{tr('My city isn’t listed')}</button></div></>;
      case 'society': return typedSoc || (socs && !socs.length)
        ? <>{text('sct', tr('Society name'), 'e.g. Green Acres CHS, Andheri East', v => { setP({ ...p, societyId: '', society: v }); next('society'); }, { validate: v => v.trim().length < 2 ? tr('Enter at least 2 letters.') : null })}
          <div className="cb-note small">{tr('Pawsure support checks new societies.')}</div>
          {!!socs?.length && <div className="cb-chips"><button type="button" className="chip" onClick={() => { setTypedSoc(false); setDraft(''); }}>{tr('Choose from the list')}</button></div>}</>
        : <><div className="cb-input"><label htmlFor="soc" className="sr-only">{tr('Society')}</label>
          <select id="soc" className="input" value={p.societyId} onChange={e => { const x = socs?.find(y => y.id === e.target.value); if (!x) return; setP({ ...p, societyId: x.id, society: `${x.name}${x.area ? ', ' + x.area : ''}` }); next('society'); }}>
            <option value="">{socs ? tr('Choose your society') : tr('Loading…')}</option>{(socs ?? []).map(x => <option key={x.id} value={x.id}>{x.name}{x.area ? ' · ' + x.area : ''}</option>)}</select></div>
          <div className="cb-chips"><button type="button" className="chip" onClick={() => { setTypedSoc(true); setDraft(''); }}>{tr('My society isn’t listed')}</button></div></>;
      case 'tower': return text('tw', tr('Tower / wing'), tr('e.g. C or Wing 2'), v => { setP({ ...p, tower: v }); next('tower'); }, { optional: true });
      case 'flat': return text('fl', tr('Flat (private)'), tr('e.g. C-702'), v => { setP({ ...p, flat: v }); next('flat'); }, { optional: true, mono: true });
      case 'confirm': return <>{err && <div className="cb-err" role="alert">{err}</div>}<button className="btn primary block" disabled={busy} onClick={create}>{busy ? tr('Creating your home…') : tr('Create my home')}</button></>;
    }
  };

  const done = ORDER.slice(0, ORDER.indexOf(q));
  const progress = hh ? 100 : Math.round(done.length / (ORDER.length - 1) * 100);
  return <>
    <AppBar title={hh ? tr('Your circle') : tr('About you')} />
    <div className="intake-progress" role="progressbar" aria-label="Setup progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: progress + '%' }} /></div>
    <div className="body intake">
      <div className="chat" aria-live="polite">
        {done.map(k => <div key={k} className="cb-pair"><Bot>{question(k)}</Bot><Me text={answer[k]} onEdit={hh ? undefined : () => goTo(k)} /></div>)}
        {!hh && (ready ? <Bot>{question(q)}</Bot> : <Typing />)}
        {hh && <>
          <Bot>{question('confirm')}</Bot><Me text={tr('Create my home')} />
          {circle === 'ask' && !ready ? <Typing /> : <Bot>{tr('Your home is ready')} 🎉<h2 className="cb-h">{tr('Do you have anyone who can look in on your pet?')}</h2><span className="cb-note">{tr('A family member, neighbour or friend who could step in if your helper can’t come.')}</span></Bot>}
          {circle === 'yes' && <><Me text={tr('Yes, I have someone')} /><Bot>{tr('Great. You can add them any time in Me → Backups. Taking you to your home…')}</Bot></>}
          {circle === 'no' && <><Me text={tr('No one yet')} />{!ready ? <Typing /> : <><Bot><b>{tr('Cover is limited until you have a circle.')}</b> {tr('No problem, most people start here. Here are four easy ways to find someone who can step in:')}</Bot>
            <div className="cb-builder"><CircleBuilder hh={hh} embedded onDone={onDone} /></div></>}</>}
        </>}
        <div ref={end} />
      </div>
    </div>
    {ready && (!hh || circle === 'ask') && <div className="composer">
      {!hh && composer()}
      {hh && circle === 'ask' && <><div className="cb-chips big"><button type="button" className="chip primary" onClick={yes}>{tr('Yes, I have someone')}</button><button type="button" className="chip" onClick={() => setCircle('no')}>{tr('No one yet')}</button></div>
        <div className="xs muted cb-foot">{tr('You can change this later in Me → Backups.')}</div></>}
    </div>}
  </>;
}
