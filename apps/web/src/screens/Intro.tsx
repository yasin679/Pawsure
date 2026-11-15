/**
 * Welcome screens shown before Log in / Sign up on a first visit: three slides (swipe or Next), then
 * Get started (opens Sign up) or Log in. Seen once per browser (localStorage "pawsure.introSeen").
 */
import { t as tr } from '../i18n';
import { useRef, useState } from 'react';

const SLIDES = [
  { img: 'intro-friends', title: 'When help can’t come, ask friends.', text: 'Pawsure finds a nearby friend who is free and comfortable with the task. You approve every message.' },
  { img: 'intro-caring', title: 'Know who’s caring, every day.', text: 'See whether planned care for your pet actually happened, with honest evidence instead of empty reassurance.' },
  { img: 'intro-whatsapp', title: 'Your helper checks in on WhatsApp.', text: 'A photo of the bowl, a voice note or a free missed call. Nothing to install, never a face photo.' }
] as const;
const KEY = 'pawsure.introSeen';
export const introSeen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked */ } };

export function Intro({ onDone }: { onDone: (mode: 'login' | 'signup') => void }) {
  const [i, setI] = useState(0);
  const touch = useRef<number | null>(null);
  const last = i === SLIDES.length - 1;
  const go = (n: number) => setI(Math.max(0, Math.min(SLIDES.length - 1, n)));
  const done = (mode: 'login' | 'signup') => { markSeen(); onDone(mode); };
  return <div className="intro" onTouchStart={e => { touch.current = e.touches[0]!.clientX; }} onTouchEnd={e => { if (touch.current == null) return; const dx = e.changedTouches[0]!.clientX - touch.current; touch.current = null; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); }}>
    <div className="intro-track" style={{ transform: `translateX(-${i * 100}%)` }} aria-live="polite">
      {SLIDES.map((s, n) => <section key={s.img} className="intro-slide" aria-hidden={n !== i} aria-label={`${n + 1} of ${SLIDES.length}`}>
        <h1 className="intro-title">{tr(s.title)}</h1>
        <p className="intro-text">{tr(s.text)}</p>
        <img className={`intro-art ${s.img}`} src={`${import.meta.env.BASE_URL}assets/${s.img}.webp`} alt="" draggable={false} />
      </section>)}
    </div>
    <div className="intro-dots" role="tablist" aria-label="Welcome screens">{SLIDES.map((s, n) => <button key={s.img} role="tab" aria-selected={n === i} aria-label={`Screen ${n + 1}`} onClick={() => go(n)} />)}</div>
    {!last && <p className="intro-note">{tr('Pawsure is a coordination and evidence tool. It is not a vet or an emergency service.')}</p>}
    <div className="intro-foot">
      {!last && <button className="btn primary block lg" onClick={() => go(i + 1)}>{tr('Next')}</button>}
      <button className={`btn block lg ${last ? 'primary' : 'outline'}`} onClick={() => done('signup')}>{tr('Get started')}</button>
      <p className="intro-login">{tr('Already have an account?')} <button type="button" className="intro-link" onClick={() => done('login')}>{tr('Log in')}</button></p>
    </div>
  </div>;
}
