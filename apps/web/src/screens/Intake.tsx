/**
 * Conversation-first onboarding with Pawly, in three playbooks: Your information, Your pet, Care details.
 * Pawly asks one thing at a time; answers appear as chat bubbles and can be tapped to change them until that part is saved.
 * Each playbook opens with a card listing what it covers, ticked off as you answer. It saves through the normal API:
 * POST /v1/households (end of Your information), POST /pets (end of each pet), POST /routine (end of Care details),
 * then asks the circle question (PS-140).
 */
import { t as tr } from '../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LANGUAGES, hasLetter, stateOfCity } from '@pawsure/domain';
import { api, API, ApiError, nameError, type Society } from '../api';
import { AppBar, Art, Icon } from '../ui';
import { CircleBuilder } from './Cover';
import { useVoice } from '../voice';

type Circle = null | 'ask' | 'yes' | 'no';
interface Near { city: string | null; state: string | null; society: { id: string; name: string; area: string | null; city: string; state: string } | null }
/** Lake Vista CHS, Powai: the demo's "use a demo location", for browsers (or the shared demo) where location is blocked. */
const DEMO_SPOT = { lat: 19.1178, lng: 72.9058 };
type Species = 'Dog' | 'Cat' | 'Other';
interface PetDraft { name: string; species: Species | ''; age: string; food: string; allergies: string; medicines: string; vet_name: string; vet_phone: string; sameVet: boolean; id?: string }
const blankPet = (): PetDraft => ({ name: '', species: '', age: '', food: '', allergies: '', medicines: '', vet_name: '', vet_phone: '', sameVet: false });
/** One question in the conversation. `chapter` is the playbook it belongs to (0 info, 1 pet, 2 care). */
interface Step { key: string; chapter: 0 | 1 | 2; ask: ReactNode; answer: string; compose: () => ReactNode; draft?: string; pet?: number }
const CHAPTERS = ['Your information', 'Your pet', 'Care details'] as const;
const FEEDS: [number, string, string][] = [[480, 'Morning · 8 AM', 'Breakfast'], [780, 'Afternoon · 1 PM', 'Lunch'], [1140, 'Evening · 7 PM', 'Dinner'], [1320, 'Night · 10 PM', 'Late snack']];
const WALKS: [number, string, string][] = [[420, 'Morning · 7 AM', 'Morning walk'], [720, 'Midday · 12 PM', 'Midday walk'], [1080, 'Evening · 6 PM', 'Evening walk'], [1260, 'Night · 9 PM', 'Night walk']];
const LITTER: [number, string][] = [[600, 'Morning · 10 AM'], [1200, 'Evening · 8 PM']];
const AGES = ['Under 1 year', '1–3 years', '4–7 years', '8+ years'];
const names = (xs: string[]) => xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} & ${xs.at(-1)}`;
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
/** The card that opens each playbook: its number, title and what it is for. */
function Playbook({ n, title, intro }: { n: number; title: string; intro: string }) {
  return <section className="pb-card" aria-label={`${title}: step ${n} of 3`}>
    <div className="pb-head"><span className="pb-num" aria-hidden="true">{n}</span><div className="grow"><h2 className="pb-title">{title}</h2></div></div>
    <p className="pb-intro">{intro}</p>
  </section>;
}
function Typing() { return <div className="cb-row bot"><span className="cb-av" aria-hidden="true"><Art name="dogFace" width={30} /></span><div className="cb bot typing" aria-label="Pawly is typing"><i /><i /><i /></div></div>; }

/**
 * In-app list picker: a field that opens a searchable list sliding up inside the phone. Used instead of a native
 * <select>, whose pop-up is drawn by the browser outside the scaled phone frame.
 */
function Picker({ id, label, placeholder, options, value, onPick, loading }: { id: string; label: string; placeholder: string; options: { value: string; label: string }[]; value: string; onPick: (v: string) => void; loading?: boolean }) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState('');
  const shown = q.trim() ? options.filter(o => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  const current = options.find(o => o.value === value);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [open]);
  return <>
    <button type="button" id={id} className={`picker${current ? '' : ' empty'}`} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current?.label ?? placeholder}`} disabled={loading} onClick={() => { setQ(''); setOpen(true); }}>
      <span className="grow">{loading ? tr('Loading…') : current?.label ?? placeholder}</span><span className="picker-chev" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></span>
    </button>
    {open && <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={label} onClick={() => setOpen(false)}>
      <div className="sheet picker-sheet" onClick={e => e.stopPropagation()}>
        <div className="picker-grab" aria-hidden="true" />
        <div className="row"><h2 className="grow">{label}</h2><button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>{tr('Close')}</button></div>
        {options.length > 7 && <div className="picker-search"><Icon name="search" size={18} /><input className="input" autoFocus placeholder={tr('Search')} aria-label={`Search ${label.toLowerCase()}`} value={q} onChange={e => setQ(e.target.value)} /></div>}
        <div className="picker-list" role="listbox" aria-label={label}>
          {shown.map(o => <button key={o.value} type="button" role="option" aria-selected={o.value === value} className="picker-opt" onClick={() => { setOpen(false); onPick(o.value); }}><span>{o.label}</span>{o.value === value && <Icon name="check" size={18} />}</button>)}
          {!shown.length && <div className="small muted picker-none">{tr('No match. Try another spelling.')}</div>}
        </div>
      </div>
    </div>}
  </>;
}

export function Intake({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState({ displayName: '', language: 'en', state: '', city: '', societyId: '', society: '', tower: '', flat: '' });
  const [pets, setPets] = useState<PetDraft[]>([blankPet()]);
  const [more, setMore] = useState<Record<number, boolean>>({});
  const [helper, setHelper] = useState({ name: '', phone: '', language: 'mr' });
  const [care, setCare] = useState({ feeds: [] as number[], walks: [] as number[], walksDone: false, litter: null as number | null | 'none', who: '' });
  const [pos, setPos] = useState(0);
  const [lock, setLock] = useState(0);
  // Which step Pawly has finished "typing" for. Derived per step, so a new question's answer box never shows
  // for a frame before the typing pause (text typed into that frame would be lost when the box is replaced).
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [picks, setPicks] = useState<number[]>([]);
  const [otherLang, setOtherLang] = useState(false);
  const [typedCity, setTypedCity] = useState(false); const [typedSoc, setTypedSoc] = useState(false);
  const [states, setStates] = useState<string[]>([]); const [cities, setCities] = useState<string[]>([]); const [socs, setSocs] = useState<Society[] | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState<{ msg: string; back: number } | null>(null);
  // Home location from the phone (a suggestion the owner confirms or changes; the position itself is not stored).
  const [geo, setGeo] = useState<{ status: 'idle' | 'finding' | 'found' | 'failed'; found?: Near; why?: string }>({ status: 'idle' });
  const [geoOk, setGeoOk] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => { fetch(API + '/health').then(r => r.json()).then(h => setDemoMode(!!h.demoMode)).catch(() => setDemoMode(false)); }, []);
  const [hh, setHh] = useState<string | null>(null);
  const [routineCount, setRoutineCount] = useState<number | null>(null);
  const [circle, setCircle] = useState<Circle>(null);
  const end = useRef<HTMLDivElement>(null);
  const mic = useVoice();

  useEffect(() => { api<{ states: string[] }>('/v1/societies').then(r => setStates(r.states)).catch(() => setStates([])); }, []);
  useEffect(() => { if (p.state) api<{ cities: { city: string }[] }>(`/v1/societies?state=${encodeURIComponent(p.state)}`).then(r => setCities(r.cities.map(x => x.city))).catch(() => setCities([])); else setCities([]); }, [p.state]);
  useEffect(() => { setSocs(null); if (p.city) api<{ societies: Society[] }>(`/v1/societies?city=${encodeURIComponent(p.city)}`).then(r => { setSocs(r.societies); if (!r.societies.length) setTypedSoc(true); }).catch(() => { setSocs([]); setTypedSoc(true); }); }, [p.city]);

  const first = p.displayName.trim().split(/\s+/)[0] ?? '';
  const pet = (i: number) => pets[i]!;
  const setPet = (i: number, v: Partial<PetDraft>) => setPets(ps => ps.map((x, j) => j === i ? { ...x, ...v } : x));
  const dogs = pets.filter(x => x.species === 'Dog').map(x => x.name), cats = pets.filter(x => x.species === 'Cat').map(x => x.name);
  const allNames = names(pets.map(x => x.name).filter(Boolean));

  /* ---------- the conversation, as a list of steps built from the answers so far ---------- */
  const all: Step[] = [];
  const text = (id: string, label: string, placeholder: string, onSend: (v: string) => void, opts: { optional?: boolean; validate?: (v: string) => string | null; mono?: boolean; max?: number; chips?: string[]; numeric?: boolean; voice?: boolean; prefix?: string } = {}) => {
    const problem = draft.trim() && opts.validate ? opts.validate(draft) : null;
    const ok = !!draft.trim() && !problem;
    return <>{problem && <div className="cb-err" role="alert">{problem}</div>}
      {opts.voice && mic.listening && <div className="cb-live" role="status"><span className="geo-dot" aria-hidden="true" />{mic.partial || tr('Listening… speak now')}</div>}
      {opts.voice && mic.error && <div className="cb-err" role="alert">{mic.error}</div>}
      {opts.chips && <div className="cb-chips">{opts.chips.map(c => <button key={c} type="button" className="chip" onClick={() => onSend(c)}>{c}</button>)}</div>}
      <form className="cb-input" onSubmit={e => { e.preventDefault(); if (ok) onSend(draft.trim()); }}>
        <label htmlFor={id} className="sr-only">{label}</label>
        {opts.prefix && <span className="cb-prefix">{opts.prefix}</span>}
        <input id={id} className={`input${opts.mono ? ' mono' : ''}`} autoFocus maxLength={opts.max} value={draft} placeholder={mic.listening ? tr('Listening…') : placeholder} inputMode={opts.numeric ? 'tel' : undefined} onChange={e => setDraft(e.target.value)} autoComplete="off" />
        {opts.voice && mic.available && <button type="button" className={`cb-mic${mic.listening ? ' on' : ''}`} aria-label={mic.listening ? 'Stop voice input' : 'Speak your answer'} aria-pressed={mic.listening} onClick={() => mic.toggle(t => setDraft(d => (d ? d + t : t.trimStart())))}><Icon name="mic" size={20} /></button>}
        {send('Send', !ok, () => ok && onSend(draft.trim()))}
      </form>
      {opts.optional && <div className="cb-chips"><button type="button" className="chip" onClick={() => onSend('')}>{tr('Skip')}</button></div>}</>;
  };
  /** Several chips can be chosen, then Done. */
  const multi = (options: [number, string][], onDone: (v: number[]) => void, none?: string) => <>
    <div className="cb-chips">{options.map(([v, l]) => <button key={v} type="button" className="chip" aria-pressed={picks.includes(v)} onClick={() => setPicks(x => x.includes(v) ? x.filter(y => y !== v) : [...x, v].sort((a, b) => a - b))}>{picks.includes(v) && '✓ '}{l}</button>)}
      {none && <button type="button" className="chip" onClick={() => onDone([])}>{none}</button>}</div>
    <button type="button" className="btn primary block" disabled={!picks.length} onClick={() => onDone(picks)}>{tr('Done')}{picks.length ? ` · ${picks.length} ${tr('chosen')}` : ''}</button></>;
  const timesOf = (list: [number, string, ...string[]][], v: number[]) => v.map(m => list.find(x => x[0] === m)![1].split(' · ')[1]).join(', ');

  // Playbook 1: Your information
  all.push(
    { key: 'name', chapter: 0, draft: p.displayName, answer: p.displayName,
      ask: <>{tr('Hi, I’m Pawly')} 🐾 {tr('I’ll set up Pawsure with you in three short playbooks. First, a little about you.')}<br /><b>{tr('What should I call you?')}</b></>,
      compose: () => text('nm', tr('Your name'), tr('Your name'), v => { setP({ ...p, displayName: v }); next(); }, { validate: v => nameError(v), max: 60 }) },
    { key: 'lang', chapter: 0, answer: langLabel(p.language),
      ask: <>{tr('Nice to meet you')}, {first}! <b>{tr('Which language should messages to you be in?')}</b><span className="cb-note">{tr('The app is in English for now. Messages use your language where they’re written.')}</span></>,
      compose: () => <>
        <div className="cb-chips">{QUICK_LANGS.map(c => <button key={c} type="button" className="chip" aria-pressed={p.language === c} onClick={() => { setP({ ...p, language: c }); next(); }}>{langLabel(c)}</button>)}
          <button type="button" className="chip" aria-pressed={otherLang} onClick={() => setOtherLang(true)}>{tr('Another language')}</button></div>
        {otherLang && <Picker id="lg" label={tr('Your language')} placeholder={tr('Choose a language')} value={QUICK_LANGS.includes(p.language) ? '' : p.language} options={LANGUAGES.map(l => ({ value: l.code, label: langLabel(l.code) + (l.messages ? '' : ' ' + tr('(messages in English for now)')) }))} onPick={v => { setP({ ...p, language: v }); next(); }} />}</> },
    { key: 'locate', chapter: 0, answer: geoOk ? `📍 ${p.society || p.city}` : tr('Choose manually'),
      ask: geo.status === 'found' && geo.found ? <><b>{tr('Is this home?')}</b>
          <dl className="cb-sum">{geo.found.society && <><dt>{tr('Society')}</dt><dd>{geo.found.society.name}{geo.found.society.area ? ', ' + geo.found.society.area : ''}</dd></>}<dt>{tr('City')}</dt><dd>{geo.found.city}</dd><dt>{tr('State')}</dt><dd>{geo.found.state}</dd></dl>
          <span className="cb-note">📍 {tr('From your phone’s location. The location itself isn’t saved.')}{!geo.found.society ? ' ' + tr('I couldn’t find your society nearby, so I’ll ask for it next.') : ''}</span></>
        : geo.status === 'failed' ? <>{geo.why ?? tr('I couldn’t get your location.')} <b>{tr('Where’s home?')}</b> {tr('You can choose it yourself.')}</>
        : <><span className="geo-dot" aria-hidden="true" />{tr('Let me find where home is from your phone’s location…')}</>,
      compose: () => geo.status === 'found'
        ? <div className="cb-chips big"><button type="button" className="chip primary" onClick={() => useFound(true)}>{tr('Yes, that’s home')}</button><button type="button" className="chip" onClick={() => useFound(false)}>{tr('Change')}</button></div>
        : <div className="cb-chips">{geo.status === 'failed' && demoMode && <button type="button" className="chip" onClick={() => lookup(DEMO_SPOT.lat, DEMO_SPOT.lng)}>📍 {tr('Use a demo location (Powai, Mumbai)')}</button>}
            <button type="button" className="chip" onClick={() => { setGeoOk(false); next(); }}>{tr('Choose manually')}</button></div> },
    { key: 'state', chapter: 0, answer: p.state, ask: <><b>{tr('Where’s home?')}</b> {tr('Choose your state.')}</>,
      compose: () => <Picker id="stt" label={tr('State')} placeholder={tr('Choose your state')} value={p.state} loading={!states.length} options={states.map(x => ({ value: x, label: x }))}
        onPick={v => { setTypedCity(false); setTypedSoc(false); setP({ ...p, state: v, city: '', societyId: '', society: '' }); next(); }} /> },
    { key: 'city', chapter: 0, answer: p.city, draft: typedCity ? p.city : '', ask: <><b>{tr('Which city?')}</b> {p.state ? `${tr('In')} ${p.state}.` : ''}</>,
      compose: () => typedCity
        ? <>{text('ctt', tr('City'), tr('Your city or town'), v => { setTypedSoc(true); setP({ ...p, city: v, societyId: '', society: '' }); next(); }, { max: 60, validate: v => {
          if (v.trim().length < 2 || !hasLetter(v)) return tr('Enter your city’s name, not numbers.');
          const st = stateOfCity(v); return st && st !== p.state ? `${v.trim()} ${tr('is in')} ${st}, ${tr('not')} ${p.state}. ${tr('Tap your state above to change it.')}` : null; } })}
          <div className="cb-chips"><button type="button" className="chip" onClick={() => { setTypedCity(false); setDraft(''); }}>{tr('Choose from the list')}</button></div></>
        : <><Picker id="cty" label={tr('City')} placeholder={tr('Choose your city')} value={p.city} loading={!cities.length} options={cities.map(x => ({ value: x, label: x }))}
          onPick={v => { setTypedSoc(false); setP({ ...p, city: v, societyId: '', society: '' }); next(); }} />
          <div className="cb-chips"><button type="button" className="chip" onClick={() => { setTypedCity(true); setDraft(''); }}>{tr('My city isn’t listed')}</button></div></> },
    { key: 'society', chapter: 0, answer: p.society, draft: typedSoc ? p.society : '',
      ask: <><b>{tr('Which society or building do you live in?')}</b><span className="cb-note">{tr('This is your location anchor. Friends see your society and tower only.')}</span></>,
      compose: () => typedSoc || (socs && !socs.length)
        ? <>{text('sct', tr('Society name'), 'e.g. Green Acres CHS, Andheri East', v => { setP({ ...p, societyId: '', society: v }); next(); }, { max: 120, validate: v => v.trim().length < 2 ? tr('Enter at least 2 letters.') : !hasLetter(v) ? tr('Enter your society’s name, not just numbers.') : null })}
          <div className="cb-note small">{tr('Pawsure support checks new societies.')}</div>
          {!!socs?.length && <div className="cb-chips"><button type="button" className="chip" onClick={() => { setTypedSoc(false); setDraft(''); }}>{tr('Choose from the list')}</button></div>}</>
        : <><Picker id="soc" label={tr('Society')} placeholder={tr('Choose your society')} value={p.societyId} loading={!socs} options={(socs ?? []).map(x => ({ value: x.id, label: `${x.name}${x.area ? ' · ' + x.area : ''}` }))}
          onPick={v => { const x = socs?.find(y => y.id === v); if (!x) return; setP({ ...p, societyId: x.id, society: `${x.name}${x.area ? ', ' + x.area : ''}` }); next(); }} />
          <div className="cb-chips"><button type="button" className="chip" onClick={() => { setTypedSoc(true); setDraft(''); }}>{tr('My society isn’t listed')}</button></div></> },
    { key: 'tower', chapter: 0, answer: p.tower || tr('Skip'), draft: p.tower, ask: <><b>{tr('Which tower or wing?')}</b> {tr('Friends can see this, so they can find you.')}</>,
      compose: () => text('tw', tr('Tower / wing'), tr('e.g. C or Wing 2'), v => { setP({ ...p, tower: v }); next(); }, { optional: true, max: 40 }) },
    { key: 'flat', chapter: 0, answer: p.flat ? '•••• ' + tr('(private)') : tr('Skip'), draft: p.flat,
      ask: <><b>{tr('And your flat number?')}</b><span className="cb-note">🔒 {tr('Private. Only shown to a friend you confirm for a visit.')}</span></>,
      compose: () => text('fl', tr('Flat (private)'), tr('e.g. C-702'), v => { setP({ ...p, flat: v }); next(); }, { optional: true, mono: true, max: 20 }) },
    { key: 'home', chapter: 0, answer: tr('Create my home'),
      ask: <>{tr('Here’s your home. Tap any answer above to change it.')}
        <dl className="cb-sum"><dt>{tr('Name')}</dt><dd>{p.displayName}</dd><dt>{tr('Language')}</dt><dd>{langLabel(p.language)}</dd>
          <dt>{tr('Society')}</dt><dd>{p.society}</dd>{p.tower && <><dt>{tr('Tower')}</dt><dd>{p.tower}</dd></>}<dt>{tr('City')}</dt><dd>{p.city}, {p.state}</dd>
          {p.flat && <><dt>{tr('Flat (private)')}</dt><dd>{p.flat}</dd></>}</dl></>,
      compose: () => <>{err && <div className="cb-err" role="alert">{err}</div>}<button className="btn primary block" disabled={busy} onClick={createHome}>{busy ? tr('Creating your home…') : tr('Create my home')}</button></> }
  );

  // Playbook 2: Your pet (repeats for each pet)
  pets.forEach((x, i) => {
    const nm = x.name || tr('your pet');
    all.push(
      { key: `p${i}.name`, chapter: 1, pet: i, answer: x.name, draft: x.name,
        ask: i === 0 ? <>{tr('Your home is set up')} 🏡 {tr('Now the star of the show.')}<br /><b>{tr('What’s your pet’s name?')}</b></> : <><b>{tr('What’s your other pet’s name?')}</b></>,
        compose: () => text(`pn${i}`, tr('Pet’s name'), tr('e.g. Bruno'), v => { setPet(i, { name: v }); next(); }, { max: 40, validate: v => hasLetter(v) ? null : tr('Give your pet a name with letters.') }) },
      { key: `p${i}.species`, chapter: 1, pet: i, answer: x.species, ask: <><b>{tr('Is')} {nm} {tr('a dog, a cat or something else?')}</b></>,
        compose: () => <div className="cb-chips big">{(['Dog', 'Cat', 'Other'] as Species[]).map(sp => <button key={sp} type="button" className="chip" aria-pressed={x.species === sp} onClick={() => { setPet(i, { species: sp }); next(); }}>{sp === 'Dog' ? '🐶 ' : sp === 'Cat' ? '🐱 ' : '🐾 '}{tr(sp)}</button>)}</div> },
      { key: `p${i}.age`, chapter: 1, pet: i, answer: x.age || tr('Skip'), draft: x.age, ask: <><b>{tr('How old is')} {nm}?</b></>,
        compose: () => text(`pa${i}`, tr('Age'), tr('Or type it, e.g. 3 years'), v => { setPet(i, { age: v }); next(); }, { optional: true, max: 30, chips: AGES }) },
      { key: `p${i}.food`, chapter: 1, pet: i, answer: x.food, draft: x.food,
        ask: <><b>{tr('What does')} {nm} {tr('eat, and how much?')}</b><span className="cb-note">{tr('Your helper and any friend who covers will see this.')}</span></>,
        compose: () => text(`pf${i}`, tr('Food and feeding'), tr('e.g. 1 cup kibble, curd rice at lunch'), v => { setPet(i, { food: v }); next(); }, { max: 300 , voice: true }) },
      { key: `p${i}.allergies`, chapter: 1, pet: i, answer: x.allergies, draft: x.allergies === 'None known' ? '' : x.allergies, ask: <><b>{tr('Any allergies?')}</b></>,
        compose: () => text(`pl${i}`, tr('Allergies'), tr('e.g. Chicken'), v => { setPet(i, { allergies: v }); next(); }, { max: 200, chips: ['None known'] , voice: true }) },
      { key: `p${i}.medicines`, chapter: 1, pet: i, answer: x.medicines, draft: x.medicines === 'None' ? '' : x.medicines,
        ask: <><b>{tr('Does')} {nm} {tr('take any medicines?')}</b><span className="cb-note">{tr('Write it as on the vet’s card. A medicine is never handed to a backup.')}</span></>,
        compose: () => text(`pm${i}`, tr('Medicines'), tr('e.g. Joint supplement, 1 chewable with lunch'), v => { setPet(i, { medicines: v }); next(); }, { max: 300, chips: ['None'] , voice: true }) },
      { key: `p${i}.vet`, chapter: 1, pet: i, answer: x.sameVet ? `${tr('Same as')} ${pets[0]!.name}` : x.vet_name, draft: x.sameVet ? '' : x.vet_name,
        ask: <><b>{tr('Who is')} {nm}{tr('’s vet?')}</b> {tr('Name and clinic.')}</>,
        compose: () => <>{i > 0 && pets[0]!.vet_name && <div className="cb-chips"><button type="button" className="chip" onClick={() => finishPet(i, { sameVet: true, vet_name: pets[0]!.vet_name, vet_phone: pets[0]!.vet_phone })}>{tr('Same as')} {pets[0]!.name}</button></div>}
          {text(`pv${i}`, tr('Vet'), tr('e.g. Dr. Rao, Powai Pet Clinic'), v => { setPet(i, { vet_name: v, sameVet: false }); next(); }, { max: 120, validate: v => hasLetter(v) ? null : tr('Enter your vet’s name.') })}</> }
    );
    if (!x.sameVet) all.push({ key: `p${i}.vetPhone`, chapter: 1, pet: i, answer: x.vet_phone, draft: x.vet_phone, ask: <><b>{tr('And the vet’s phone number?')}</b></>,
      compose: () => text(`pp${i}`, tr('Vet phone'), '+91 22 5555 0101', v => finishPet(i, { vet_phone: v }), { max: 30, mono: true, numeric: true, validate: v => v.replace(/\D/g, '').length < 8 ? tr('Enter the full phone number.') : null }) });
    all.push({ key: `p${i}.more`, chapter: 1, pet: i, answer: more[i] ? tr('Add another pet') : tr('No, that’s all'),
      ask: <>✓ {x.name}{tr('’s profile is saved.')} <b>{tr('Do you have another pet?')}</b></>,
      compose: () => <div className="cb-chips big"><button type="button" className="chip" onClick={() => { setMore(m => ({ ...m, [i]: true })); setPets(ps => [...ps, blankPet()]); next(); }}>{tr('Add another pet')}</button><button type="button" className="chip primary" onClick={() => { setMore(m => ({ ...m, [i]: false })); next(); }}>{tr('No, that’s all')}</button></div> });
  });

  // Playbook 3: Care details
  all.push({ key: 'feed', chapter: 2, answer: timesOf(FEEDS, care.feeds),
    ask: <>{tr('Last part: the daily routine for')} {allNames}. {tr('I’ll turn it into tasks with reminders.')}<br /><b>{tr('When do your pets usually eat?')}</b> {tr('Choose all that apply.')}</>,
    compose: () => multi(FEEDS.map(f => [f[0], f[1]]), v => { setCare(c => ({ ...c, feeds: v })); next(); }) });
  if (dogs.length) all.push({ key: 'walk', chapter: 2, answer: care.walks.length ? timesOf(WALKS, care.walks) : tr('No walks'),
    ask: <><b>{tr('When does')} {names(dogs)} {tr('go for walks?')}</b></>,
    compose: () => multi(WALKS.map(w => [w[0], w[1]]), v => { setCare(c => ({ ...c, walks: v, walksDone: true })); next(); }, tr('No walks')) });
  if (cats.length) all.push({ key: 'litter', chapter: 2, answer: care.litter === 'none' ? tr('No reminder') : LITTER.find(l => l[0] === care.litter)?.[1].split(' · ')[1] ?? '',
    ask: <><b>{tr('When should')} {names(cats)}{tr('’s litter tray be cleaned?')}</b></>,
    compose: () => <div className="cb-chips">{LITTER.map(([m, l]) => <button key={m} type="button" className="chip" onClick={() => { setCare(c => ({ ...c, litter: m })); next(); }}>{l}</button>)}<button type="button" className="chip" onClick={() => { setCare(c => ({ ...c, litter: 'none' })); next(); }}>{tr('No reminder')}</button></div> });
  all.push({ key: 'who', chapter: 2, answer: tr(care.who),
    ask: <><b>{tr('Who usually looks after')} {allNames} {tr('when you’re out?')}</b></>,
    compose: () => <>{err && <div className="cb-err" role="alert">{err}</div>}<div className="cb-chips big col">{['Me or my family', 'My house help', 'Nobody yet'].map(w => <button key={w} type="button" className="chip" disabled={busy} onClick={() => { if (w === 'My house help') { setCare(c => ({ ...c, who: w })); next(); } else saveCare(w); }}>{tr(w)}</button>)}</div></> });
  // "My house help": her details, then a WhatsApp invite to join (her tasks move to her once she accepts).
  if (care.who === 'My house help') all.push(
    { key: 'hname', chapter: 2, answer: helper.name, draft: helper.name, ask: <><b>{tr('What’s your helper’s name?')}</b></>,
      compose: () => text('hn', tr('Helper’s name'), tr('e.g. Sunita Pawar'), v => { setHelper(h => ({ ...h, name: v })); next(); }, { max: 60, validate: v => nameError(v), voice: true }) },
    { key: 'hphone', chapter: 2, answer: helper.phone ? '+91 ' + helper.phone.replace(/^(\d{5})(\d{5})$/, '$1 $2') : '', draft: helper.phone,
      ask: <><b>{tr('And her WhatsApp number?')}</b><span className="cb-note">{tr('Pawsure sends her a WhatsApp message to join. Nothing is recorded until she says Yes.')}</span></>,
      compose: () => text('hp', tr('WhatsApp number'), '98765 43210', v => { setHelper(h => ({ ...h, phone: v.replace(/\D/g, '') })); next(); }, { max: 11, mono: true, numeric: true, prefix: '+91', validate: v => /^[6-9]\d{9}$/.test(v.replace(/\D/g, '')) ? null : tr('Enter a 10-digit mobile number starting with 6–9.') }) },
    { key: 'hlang', chapter: 2, answer: langLabel(helper.language), ask: <><b>{tr('Which language should her messages be in?')}</b></>,
      compose: () => <>{err && <div className="cb-err" role="alert">{err}</div>}<div className="cb-chips">{['mr', 'hi', 'en'].map(c => <button key={c} type="button" className="chip" disabled={busy} onClick={() => { setHelper(h => ({ ...h, language: c })); saveCare('My house help', { ...helper, language: c }); }}>{langLabel(c)}</button>)}</div></> });

  // A confirmed location answers state and city (and society when one was found nearby).
  const steps = all.filter(x => !(geoOk && (x.key === 'state' || x.key === 'city' || (x.key === 'society' && !!p.societyId))));

  /* ---------- moving through the steps ---------- */
  const cur = steps[Math.min(pos, steps.length - 1)]!;
  const atCircle = pos >= steps.length;
  const chapter: 0 | 1 | 2 = atCircle ? 2 : cur.chapter;
  const stage = atCircle ? 'circle:' + circle : cur.key;
  const ready = readyFor === stage;
  useEffect(() => { setErr(null); setPicks([]); const t = setTimeout(() => setReadyFor(stage), reduced() ? 0 : 450); return () => clearTimeout(t); }, [stage]);
  useEffect(() => { if (cur.key === 'locate' && geo.status === 'idle') detect(); }, [cur.key]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: reduced() ? 'auto' : 'smooth' }); }, [stage, ready, err, socs, otherLang, typedCity, typedSoc, geo.status]);

  /** After a fix, jump straight back to where saving failed; otherwise ask the next question. */
  function next() { setDraft(''); setOtherLang(false); if (fix) { setPos(fix.back); setFix(null); return; } setPos(x => x + 1); }
  async function lookup(lat: number, lng: number) {
    setGeo({ status: 'finding' });
    try {
      const r = await api<Near>(`/v1/societies/near?lat=${lat}&lng=${lng}`);
      setGeo(r.city && r.state ? { status: 'found', found: r } : { status: 'failed', why: tr('Your location is outside the cities I know so far.') });
    } catch { setGeo({ status: 'failed', why: tr('I couldn’t look up your location.') }); }
  }
  function detect() {
    if (!('geolocation' in navigator)) { setGeo({ status: 'failed', why: tr('This browser can’t share its location.') }); return; }
    setGeo({ status: 'finding' });
    let settled = false; const stop = setTimeout(() => { if (!settled) { settled = true; setGeo({ status: 'failed', why: tr('Finding your location took too long.') }); } }, 9000);
    navigator.geolocation.getCurrentPosition(pos => { if (settled) return; settled = true; clearTimeout(stop); lookup(pos.coords.latitude, pos.coords.longitude); },
      err => { if (settled) return; settled = true; clearTimeout(stop); setGeo({ status: 'failed', why: err.code === err.PERMISSION_DENIED ? tr('Location is switched off or blocked here.') : tr('I couldn’t get your location.') }); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 });
  }
  /** Yes: use the suggestion and skip the questions it answers. Change: fill the pickers with it and ask them. */
  function useFound(yes: boolean) {
    const f = geo.found!; const so = f.society;
    setTypedCity(false); setTypedSoc(false);
    setP(x => ({ ...x, state: f.state ?? '', city: f.city ?? '', societyId: so?.id ?? '', society: so ? `${so.name}${so.area ? ', ' + so.area : ''}` : '' }));
    setGeoOk(yes); next();
  }
  function goTo(i: number) { if (i < lock) return; setDraft(steps[i]!.draft ?? ''); setPos(i); }
  const failed = (e: unknown, back: number, field: (f: string, msg: string) => string) => {
    if (!(e instanceof ApiError)) { setErr('Can’t reach Pawsure. Check your connection and try again.'); return; }
    const b = e.body as { error?: string; message?: string; issues?: string[] };
    const msg = typeof b.message === 'string' ? b.message : (b.issues?.[0]?.split(': ').slice(1).join(': ') || 'One of your answers didn’t save.');
    const key = field(b.issues?.[0]?.split(':')[0] ?? '', msg); const to = steps.findIndex(s => s.key === key);
    // Say exactly what was wrong and go back to that question, instead of a generic error.
    setFix({ msg, back }); goTo(to < 0 ? back : to);
  };

  async function createHome() {
    setErr(null); setBusy(true); const here = pos;
    try {
      const r = await api<{ id: string }>('/v1/households', { body: { displayName: p.displayName.trim(), language: p.language, state: p.state, city: p.city, ...(p.societyId ? { societyId: p.societyId } : { society: p.society.trim() }), tower: p.tower.trim() || undefined, flat: p.flat.trim() || undefined } });
      setHh(r.id); setLock(here + 1); setPos(here + 1);
    } catch (e) {
      failed(e, here, (f, msg) => f === 'displayName' ? 'name' : f === 'language' ? 'lang' : f === 'tower' ? 'tower' : f === 'flat' ? 'flat' : f === 'city' ? 'city'
        : /Check the state|state from the list/.test(msg) ? 'city' : /Check the city/.test(msg) ? 'society' : 'society');
    } finally { setBusy(false); }
  }
  async function finishPet(i: number, last: Partial<PetDraft>) {
    const x = { ...pet(i), ...last }; setPet(i, last); setErr(null); setBusy(true); setDraft('');
    const here = pos;
    try {
      const body = { name: x.name, species: x.species || 'Other', age: x.age || undefined, food: x.food, allergies: x.allergies, medicines: x.medicines, vet_name: x.vet_name, vet_phone: x.vet_phone };
      if (x.id) await api(`/v1/households/${hh}/pets/${x.id}`, { method: 'PATCH', body });
      else { const r = await api<{ id: string }>(`/v1/households/${hh}/pets`, { body }); setPet(i, { id: r.id }); }
      setFix(null); setLock(here + 1); setPos(here + 1);
    } catch (e) {
      failed(e, here, f => `p${i}.${f === 'vet_phone' ? 'vetPhone' : f === 'vet_name' ? 'vet' : f || 'name'}`);
    } finally { setBusy(false); }
  }
  async function saveCare(who: string, h = helper) {
    setErr(null); setBusy(true);
    const tasks: { petId: string; title: string; type: string; due: number }[] = [];
    for (const x of pets) {
      if (!x.id) continue;
      for (const m of care.feeds) tasks.push({ petId: x.id, title: FEEDS.find(f => f[0] === m)![2], type: 'feeding', due: m });
      if (x.species === 'Dog') for (const m of care.walks) tasks.push({ petId: x.id, title: WALKS.find(w => w[0] === m)![2], type: 'walk', due: m });
      if (x.species === 'Cat' && typeof care.litter === 'number') tasks.push({ petId: x.id, title: 'Clean litter tray', type: 'litter', due: care.litter });
    }
    try {
      // With a helper: invite her on WhatsApp first, then give her the routine (prompts start once she says Yes).
      if (who === 'My house help') await api(`/v1/households/${hh}/helpers/invite`, { body: { name: h.name, phone: '+91' + h.phone, language: h.language } });
      for (const t of tasks) await api(`/v1/households/${hh}/routine`, { body: { ...t, assignee: who === 'My house help' ? 'helper' : 'owner' } });
      setCare(c => ({ ...c, who })); setRoutineCount(tasks.length); setLock(steps.length); setPos(steps.length); setCircle('ask');
    } catch (e) { setErr(e instanceof ApiError ? String(e.body.message ?? 'Your routine didn’t save. Try again.') : 'Can’t reach Pawsure. Check your connection and try again.'); } finally { setBusy(false); }
  }
  const yes = () => { setCircle('yes'); setTimeout(onDone, reduced() ? 0 : 1100); };
  function send(label: string, disabled: boolean, onSend: () => void) { return <button type="submit" className="cb-send" disabled={disabled} aria-label={label} onClick={e => { e.preventDefault(); onSend(); }}><Icon name="send" size={20} /></button>; }

  /* ---------- playbook cards: what each part covers, ticked as it is answered ---------- */
  const playbook = (n: 0 | 1 | 2) => n === 0
    ? <Playbook n={1} title={tr(CHAPTERS[0])} intro={tr('So your helper, friends and Pawsure know who you are and where home is.')} />
    : n === 1
    ? <Playbook n={2} title={tr(CHAPTERS[1])} intro={tr('A profile for each pet: everything someone needs to care for them safely.')} />
    : <Playbook n={3} title={tr(CHAPTERS[2])} intro={tr('Your daily routine, so the right person is reminded at the right time.')} />;

  const shown = steps.slice(0, Math.min(pos, steps.length));
  return <>
    <AppBar title={tr(CHAPTERS[chapter])} />
    <ol className="pb-steps" aria-label="Setup progress">{CHAPTERS.map((c, i) => <li key={c} className={i < chapter ? 'done' : i === chapter ? 'now' : ''} aria-current={i === chapter ? 'step' : undefined}><span className="pb-dot">{i < chapter ? '✓' : i + 1}</span><span className="pb-lbl">{tr(c)}</span></li>)}</ol>
    <div className="body intake">
      <div className="chat" aria-live="polite">
        {shown.map((s, i) => <div key={s.key} className="cb-pair">
          {(i === 0 || shown[i - 1]!.chapter !== s.chapter) && playbook(s.chapter)}
          {s.pet != null && s.pet > 0 && s.key === `p${s.pet}.name` && <div className="pb-sub">{tr('Pet')} {s.pet + 1}</div>}
          <Bot>{s.ask}</Bot><Me text={s.answer} onEdit={i >= lock && !busy ? () => goTo(i) : undefined} /></div>)}
        {!atCircle && <>
          {(pos === 0 || shown.at(-1)?.chapter !== cur.chapter) && playbook(cur.chapter)}
          {cur.pet != null && cur.pet > 0 && cur.key === `p${cur.pet}.name` && <div className="pb-sub">{tr('Pet')} {cur.pet + 1}</div>}
          {ready ? <Bot>{fix && <span className="cb-fix" role="alert">{tr('Hmm, that didn’t save.')} {fix.msg}</span>}{cur.ask}</Bot> : <Typing />}
        </>}
        {atCircle && hh && <>
          <Bot>✓ {tr('Your routine is saved')}{routineCount ? `: ${routineCount} ${routineCount === 1 ? tr('task a day') : tr('tasks a day')}` : ''}. {tr('It starts tomorrow, and you can change it any time in Pet → Routine.')}
          </Bot>
          {care.who === 'My house help' && <Bot><span className="wa-sent"><Icon name="send" size={16} /> {tr('Invite sent on WhatsApp')}</span>{tr('I’ve sent')} {helper.name.split(' ')[0]} {tr('a WhatsApp message to join Pawsure.')} <b>{tr('Her tasks move to her once she accepts.')}</b> {tr('Until then you get the reminders. You’ll see her status on Home.')}</Bot>}
          {circle === 'ask' && !ready ? <Typing /> : <Bot><h2 className="cb-h">{tr('Do you have anyone who can look in on your pet?')}</h2><span className="cb-note">{tr('A family member, neighbour or friend who could step in if your helper can’t come.')}</span></Bot>}
          {circle === 'yes' && <><Me text={tr('Yes, I have someone')} /><Bot>{tr('Great. You can add them any time in Me → Backups. All three playbooks are done')} 🎉 {tr('Taking you to your home…')}</Bot></>}
          {circle === 'no' && <><Me text={tr('No one yet')} />{!ready ? <Typing /> : <><Bot><b>{tr('Cover is limited until you have a circle.')}</b> {tr('No problem, most people start here. Here are four easy ways to find someone who can step in:')}</Bot>
            <div className="cb-builder"><CircleBuilder hh={hh} embedded onDone={onDone} /></div></>}</>}
        </>}
        <div ref={end} />
      </div>
    </div>
    {ready && (!atCircle || circle === 'ask') && <div className="composer">
      {!atCircle && cur.compose()}
      {atCircle && circle === 'ask' && <><div className="cb-chips big"><button type="button" className="chip primary" onClick={yes}>{tr('Yes, I have someone')}</button><button type="button" className="chip" onClick={() => setCircle('no')}>{tr('No one yet')}</button></div>
        <div className="xs muted cb-foot">{tr('You can change this later in Me → Backups.')}</div></>}
    </div>}
  </>;
}
