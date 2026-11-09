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

void import('../main');
