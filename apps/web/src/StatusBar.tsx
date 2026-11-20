/**
 * Phone status bar for the iPhone 18 Pro frame shown on wide screens (styles.css, "Phone frame"). It is drawn inside the
 * app's `.device > .pwa` element through a portal and hidden by CSS on real phones, which have their own status bar.
 * It also keeps the frame's scale up to date, so the whole device fits the window (preview pane or full screen).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** Device size in CSS px at scale 1 (styles.css: --dev-w, --dev-h), the docked demo phones, and the margin around them. */
const DEV_W = 428 + 8, DEV_H = 900, DOCK = 30 + 440, MARGIN = 24, WA_BAR = 60;
function fitDevice() {
  const w = innerWidth - 2 * MARGIN, h = innerHeight - 2 * MARGIN;
  const z = (width: number) => String(Math.max(0.3, Math.min(1, h / DEV_H, w / width)));
  const s = document.documentElement.style;
  s.setProperty('--dev-z', z(DEV_W)); s.setProperty('--dev-zd', z(DEV_W + DOCK));
  // the helper's WhatsApp phone is as big as the owner's, with its caption above both (styles.css .wa-sim)
  s.setProperty('--wa-bar-h', WA_BAR + 'px'); s.setProperty('--dev-zw', String(Math.max(0.3, Math.min(1, h / (DEV_H + WA_BAR), w / (DEV_W * 2 + 30))))); 
}

const now = () => { const d = new Date(); return `${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function StatusBar() {
  const [host, setHost] = useState<Element | null>(null); const [t, setT] = useState(now());
  useEffect(() => {
    const root = document.getElementById('root')!;
    const find = () => setHost(root.querySelector(':scope > .device > .pwa'));
    find();
    const mo = new MutationObserver(find); mo.observe(root, { childList: true, subtree: true });
    fitDevice(); addEventListener('resize', fitDevice);
    const iv = setInterval(() => setT(now()), 15000);
    return () => { mo.disconnect(); clearInterval(iv); removeEventListener('resize', fitDevice); };
  }, []);
  if (!host) return null;
  return createPortal(<div className="sbar" aria-hidden="true">
    <span className="sbar-t">{t}</span>
    <span className="sbar-i">
      <svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
      <svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0zM3.2 6.6a6.8 6.8 0 0 1 9.6 0l-1.6 1.6a4.5 4.5 0 0 0-6.4 0zM.8 4.2a10.2 10.2 0 0 1 14.4 0l-1.6 1.6a7.9 7.9 0 0 0-11.2 0z" /></svg>
      <svg width="26" height="12" viewBox="0 0 26 12"><rect x=".5" y=".5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity=".45" /><rect x="2" y="2" width="16" height="8" rx="2" /><rect x="24" y="4" width="1.6" height="4" rx=".8" opacity=".5" /></svg>
    </span>
  </div>, host);
}
