/** UI kit shared with the prototype's design system (same class names, tokens, icons and mascot crops). */
import { LANGUAGES } from '@pawsure/domain';
import { setUiLang, uiLang, t as tr } from './i18n';
import type { ReactNode } from 'react';

const PATHS: Record<string, string> = {
  home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  friends: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><circle cx="17" cy="8.5" r="2.6"/><path d="M15.8 13.7c2.3.2 4 1.7 4.7 4.3"/>',
  paw: '<ellipse cx="12" cy="15.5" rx="4.2" ry="3.6"/><circle cx="6.2" cy="10.6" r="1.8"/><circle cx="9.6" cy="6.6" r="1.9"/><circle cx="14.4" cy="6.6" r="1.9"/><circle cx="17.8" cy="10.6" r="1.8"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.8 3.6-5.8 7-5.8s6.2 2 7 5.8"/>',
  heart: '<path d="M12 19s-7-4.3-7-9.2A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.2C19 14.7 12 19 12 19Z"/>',
  vaccine: '<path d="m15 4 5 5"/><path d="m17.5 6.5-9.8 9.8-3 .7.7-3L15.2 4.2"/><path d="m11 9 1.5 1.5M8.5 11.5 10 13"/><path d="m4 20 2.5-2.5"/>',
  card: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M7 10h5M7 13.5h8"/><circle cx="16.5" cy="10" r="1.3"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11"/><path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4 21 19.5H3Z"/><path d="M12 10v4.5M12 17h.01"/>',
  phone: '<path d="M6.5 4h3l1.5 4-2 1.5a10 10 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 4.5 6a2 2 0 0 1 2-2Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4-3.9-3.8 5.4-.8Z"/>'
};
export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return <span className="ic" aria-hidden="true"><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: PATHS[name] ?? PATHS.paw! }} /></span>;
}

/* Mascot crops from the design board (1600 × 1072). Replace with exported SVG/PNG when the designers deliver them. */
const ART: Record<string, [number, number, number, number, string]> = {
  family: [60, 785, 165, 160, 'Dog and two cats in yellow headbands'], cat: [305, 810, 125, 120, 'Cat in a yellow headband'],
  wave: [1365, 466, 85, 92, 'Cat waving'], box: [1184, 562, 104, 76, 'Cat peeking out of a box'], sleep: [1305, 568, 133, 70, 'Dog sleeping'],
  run: [1180, 466, 110, 82, 'Dog running'], catFace: [497, 740, 38, 40, ''], dogFace: [764, 505, 60, 72, '']
};
export function Art({ name, width }: { name: keyof typeof ART | string; width: number }) {
  const a = ART[name]; if (!a) return null;
  const [x, y, w, h, alt] = a, s = width / w;
  return <span className="art" role={alt ? 'img' : 'presentation'} aria-label={alt || undefined} style={{ width, height: Math.round(h * s), backgroundSize: `${Math.round(1600 * s)}px auto`, backgroundPosition: `-${Math.round(x * s)}px -${Math.round(y * s)}px` }} />;
}
export function PetAvatar({ species, size = 40 }: { species: string; size?: number }) {
  return <span className="avatar" style={{ width: size, height: size }}>{species === 'Cat' ? <Art name="catFace" width={size} /> : species === 'Dog' ? <Art name="dogFace" width={size} /> : <Icon name="paw" size={20} />}</span>;
}

const CONF: Record<string, [string, string]> = {
  Confirmed: ['c-confirmed', '✓✓'], Likely: ['c-likely', '✓'], 'Not confirmed': ['c-notconfirmed', '!'], Missed: ['c-missed', '✕'], Matched: ['c-matched', '☑'],
  Mismatch: ['c-mismatch', '≠'], Pending: ['c-pending', '○'], Trusted: ['c-unknown', '?'], Cancelled: ['c-cancelled', '–'], Unknown: ['c-unknown', '?'], 'In progress': ['c-pending', '…']
};
/** Confidence is never colour-only: glyph + text label always present. */
export function Conf({ state, label }: { state: string; label?: string }) {
  const [cls, g] = CONF[state] ?? ['c-pending', '○'];
  return <span className={`conf ${cls}`}><span className="g" aria-hidden="true">{g}</span>{tr(label ?? state)}</span>;
}

/** Screen header. `hideTitle` keeps the title for screen readers only (Today shows the greeting instead). */
export function AppBar({ title, onBack, right, hideTitle }: { title: string; onBack?: () => void; right?: ReactNode; hideTitle?: boolean }) {
  return <div className="appbar">{onBack && <button className="back" onClick={onBack} aria-label="Back">‹</button>}{hideTitle ? <><h1 className="sr-only">{title}</h1><span className="grow" /></> : <h1>{title}</h1>}{right}</div>;
}
export const Banner = ({ kind, icon, children }: { kind: 'alert' | 'warn' | 'info' | 'sim'; icon: string; children: ReactNode }) => <div className={`banner ${kind}`}><span className="bi" aria-hidden="true">{icon}</span><div className="grow">{children}</div></div>;

/** Every scheduled Indian language plus English. Languages without written messages yet say so. */
export const LanguageOptions = ({ forMessages }: { forMessages?: boolean }) => <>{LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.native === l.name ? l.name : `${l.native} ${l.name}`}{forMessages && !l.messages ? ' (messages in English for now)' : ''}</option>)}</>;

/** English / हिन्दी switch for the screens. */
export const LangSwitch = ({ compact }: { compact?: boolean }) => <div className={`langswitch${compact ? ' compact' : ''}`} role="group" aria-label="Screen language">
  {([['en', 'English'], ['hi', 'हिन्दी']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={uiLang() === k} onClick={() => setUiLang(k)}>{l}</button>)}
</div>;
