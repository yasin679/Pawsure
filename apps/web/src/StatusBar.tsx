/**
 * Phone status bar for the device frame shown on wide screens (styles.css, "Phone frame"). It is drawn inside the
 * app's root `.pwa` element through a portal and hidden by CSS on real phones, which have their own status bar.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const now = () => { const d = new Date(); return `${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function StatusBar() {
  const [host, setHost] = useState<Element | null>(null); const [t, setT] = useState(now());
  useEffect(() => {
    const root = document.getElementById('root')!;
    const find = () => setHost(root.querySelector(':scope > .pwa'));
    find();
    const mo = new MutationObserver(find); mo.observe(root, { childList: true });
    const iv = setInterval(() => setT(now()), 15000);
    return () => { mo.disconnect(); clearInterval(iv); };
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
