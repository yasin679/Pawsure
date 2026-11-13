/**
 * Entry for the shareable in-browser demo: starts the API + database inside the page, routes the app's API calls to it,
 * then boots the normal Pawsure app unchanged.
 */
import './shims/crypto';

const API = import.meta.env.VITE_API_URL as string;
const backend = import('./backend').then(m => m.start());
backend.then(() => document.documentElement.setAttribute('data-demo-ready', '1')).catch(e => {
  console.error(e);
  const el = document.getElementById('demo-boot');
  if (el) { el.textContent = 'The demo could not start in this browser. Try a recent Chrome, Edge, Safari or Firefox.'; el.hidden = false; }
});

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(API)) return realFetch(input, init);
  const app = await backend;
  return app.request(url.slice(API.length) || '/', init);
};

/**
 * The shared demo runs inside a sandboxed frame that blocks phone, SMS and WhatsApp links (the whole page turns into
 * "This content is blocked"). In the demo those links show a short notice instead of leaving the page.
 */
let noticeTimer = 0;
const notice = (text: string) => {
  let el = document.getElementById('demo-call');
  if (!el) {
    el = document.createElement('div'); el.id = 'demo-call'; el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;max-width:min(92vw,420px);padding:12px 16px;border-radius:14px;background:#1f1a14;color:#fff;font:600 14px/1.4 Nunito,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);text-align:center';
    document.body.appendChild(el);
  }
  el.textContent = text; el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { el!.hidden = true; }, 3500);
};
document.addEventListener('click', e => {
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a) return;
  const href = a.getAttribute('href') ?? '';
  if (/^(tel|sms):/i.test(href)) {
    e.preventDefault();
    const num = decodeURIComponent(href.replace(/^(tel|sms):/i, '')) || 'this number';
    notice(`📞 Calling ${num}… (simulated: the demo doesn’t place real calls)`);
  } else if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(href)) {
    e.preventDefault();
    notice('💬 This would open WhatsApp with the message ready to send (simulated in the demo).');
  }
}, true);

void import('../main');
