/**
 * Welcome screens shown before Log in / Sign up: three slides that move on by themselves (and can be swiped or
 * picked with the dots), above a fixed footer with Get started (opens Sign up) and Log in.
 * Seen once per browser (localStorage "pawsure.introSeen").
 */
import { t as tr } from '../i18n';
import { useEffect, useRef, useState } from 'react';

const SLIDES = [
  { img: 'intro-friends', title: 'When help can’t come, ask friends.', text: 'Pawsure finds a nearby friend who is free and comfortable with the task. You approve every message.' },
  { img: 'intro-caring', title: 'Know who’s caring, every day.', text: 'See whether planned care for your pet actually happened, with honest evidence instead of empty reassurance.' },
  { img: 'intro-whatsapp', title: 'Your helper checks in on WhatsApp.', text: 'A photo of the bowl, a voice note or a free missed call. Nothing to install, never a face photo.' }
] as const;
const KEY = 'pawsure.introSeen';
export const introSeen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
/** Show the welcome screens again (after signing out). */
export const resetIntro = () => { try { localStorage.removeItem(KEY); } catch { /* storage blocked */ } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked */ } };

const AUTO_MS = 4000;
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function Intro({ onDone }: { onDone: (mode: 'login' | 'signup') => void }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const touch = useRef<number | null>(null);
  const n = SLIDES.length;
  const go = (k: number) => setI(((k % n) + n) % n);
  const done = (mode: 'login' | 'signup') => { markSeen(); onDone(mode); };
  // Auto-carousel: the next slide every 4 s, looping; a swipe or a dot restarts the wait (the effect re-runs on i).
  // It pauses while the pointer or keyboard focus is on the slides, and stays put for reduced motion.
  useEffect(() => { if (paused || reducedMotion()) return; const t = setTimeout(() => go(i + 1), AUTO_MS); return () => clearTimeout(t); }, [i, paused]);
  return <div className="intro">
    <div className="intro-brand"><img src={`${import.meta.env.BASE_URL}assets/pawsure-logo.png`} alt="Pawsure" width={613} height={162} /></div>
    <div className="intro-stage" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      onTouchStart={e => { touch.current = e.touches[0]!.clientX; }} onTouchEnd={e => { if (touch.current == null) return; const dx = e.changedTouches[0]!.clientX - touch.current; touch.current = null; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); }}>
      <div className="intro-track" style={{ transform: `translateX(-${i * 100}%)` }} aria-live="off">
        {SLIDES.map((s, k) => <section key={s.img} className="intro-slide" aria-hidden={k !== i} aria-label={`${k + 1} of ${n}`}>
          <h1 className="intro-title">{tr(s.title)}</h1>
          <img className={`intro-art ${s.img}`} src={`${import.meta.env.BASE_URL}assets/${s.img}.webp`} alt="" draggable={false} />
        </section>)}
      </div>
      <div className="intro-dots" role="tablist" aria-label="Welcome screens">{SLIDES.map((s, k) => <button key={s.img} role="tab" aria-selected={k === i} aria-label={`Screen ${k + 1}`} onClick={() => go(k)} />)}</div>
    </div>
    {/* The footer is the same on every slide and never moves. */}
    <div className="intro-foot">
      <p className="intro-note">{tr('Pawsure is a coordination and evidence tool. It is not a vet or an emergency service.')}</p>
      <button className="btn primary block lg" onClick={() => done('signup')}>{tr('Get started')}</button>
      <p className="intro-login">{tr('Already have an account?')} <button type="button" className="intro-link" onClick={() => done('login')}>{tr('Log in')}</button></p>
    </div>
  </div>;
}
