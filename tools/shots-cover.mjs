// Screenshots of the v1.1.0 cover continuity screens from the demo build, for review and the docs.
// Needs the demo preview running (npm run preview:demo -w @pawsure/web). Run: node tools/shots-cover.mjs <out-dir>
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? 'docs/images'; const BASE = 'http://localhost:4174/demo.html', API = 'https://api.pawsure.demo', HH = '/v1/households/hh_demo';
const browser = await chromium.launch({ channel: 'chrome' });
async function fresh(w = 390, h = 844) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(BASE); await page.waitForSelector('html[data-demo-ready]', { state: 'attached', timeout: 90000 });
  await page.getByRole('button', { name: 'Get started' }).click(); await page.locator('#ph').fill('9800000021'); await page.getByRole('button', { name: 'Send code' }).click();
  await page.locator('#otp').fill((await page.locator('b.mono').first().innerText()).trim()); await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('heading', { name: /Neha/ }).waitFor(); return page;
}
const api = (page, m, p, b) => page.evaluate(async ([m, p, b, A]) => { const s = JSON.parse(localStorage.getItem('pawsure.session') ?? 'null'); const r = await fetch(A + p, { method: m, headers: { 'content-type': 'application/json', ...(s ? { authorization: 'Bearer ' + s.token } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => null); }, [m, p, b, API]);
const to = async (page, hm) => { const [h, m] = hm.split(':').map(Number), t = h * 60 + m - 5; await api(page, 'POST', '/demo/clock', { set: `2026-11-06T${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}:00+05:30` }); await page.getByRole('button', { name: '+5m' }).click(); await page.waitForTimeout(700); };
const hook = (page, body) => api(page, 'POST', '/webhooks/whatsapp', { messageId: 'shot-' + Math.random(), ...body });
const refresh = async (page) => { await page.locator('nav.tabbar').getByRole('button', { name: 'Me' }).click(); await page.locator('nav.tabbar').getByRole('button', { name: 'Today' }).click(); await page.waitForTimeout(600); };
const shot = (page, name, full = false) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
const cant = async (page) => { const th = await api(page, 'GET', '/demo/helper-thread/m_sunita'); const b = th.filter(m => m.template === 'cover_reminder').at(-1).buttons.find(x => x.id.startsWith('cover_cant')).id; await hook(page, { from: '+919000000035', type: 'button', payload: b }); await refresh(page); };

let p = await fresh(); await to(p, '14:30'); await cant(p); await shot(p, 'cover-at-risk');
await p.locator('.card.atrisk').first().getByRole('button', { name: 'See what’s happening' }).click(); await p.waitForTimeout(300); await shot(p, 'cover-status-sheet'); await p.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
const job = (await api(p, 'GET', `${HH}/cover`)).jobs[0];
await hook(p, { from: '+919800000040', type: 'button', payload: `cb_read:${job.id}` }); await hook(p, { from: '+919800000040', type: 'button', payload: `cb_yes:${job.id}` }); await refresh(p);
await p.getByRole('button', { name: 'Confirm Mrs Desai' }).click(); await p.waitForTimeout(600); await shot(p, 'cover-gate-key');
await p.getByRole('button', { name: /Show backups’ phones/ }).click(); await p.waitForTimeout(800); await p.locator('.simdock').scrollIntoViewIfNeeded(); await p.locator('.simdock').screenshot({ path: `${out}/cover-backup-phone.png` });
await p.getByRole('button', { name: /Show Sunita’s phone/ }).click(); await p.waitForTimeout(800); await p.locator('.simdock').screenshot({ path: `${out}/cover-helper-reminder.png` });
await p.close();

p = await fresh(); await to(p, '11:40'); await hook(p, { from: '+919000000035', type: 'text', text: "I can't come today" });
const j2 = (await api(p, 'GET', `${HH}/cover`)).jobs[0]; await hook(p, { from: '+919700000008', type: 'button', payload: `cb_yes:${j2.id}` }); await api(p, 'POST', `${HH}/cover/jobs/${j2.id}/confirm`, { personId: 'bk_ankita' });
await to(p, '11:55'); await to(p, '12:30'); await shot(p, 'cover-not-found-must-happen'); await p.close();

p = await fresh(); await p.getByRole('button', { name: 'My help can’t come today' }).click(); await p.getByRole('dialog').getByRole('button', { name: 'Mark unavailable' }).click(); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'I’m leaving' }).click(); await p.waitForTimeout(400); await shot(p, 'cover-pre-departure'); await p.close();

p = await fresh(); await p.getByRole('button', { name: 'I’m leaving' }).click(); await p.getByRole('dialog').getByRole('button', { name: 'I’m leaving' }).click(); await to(p, '18:30');
await p.getByRole('button', { name: 'I’m delayed' }).click(); await p.locator('#dlt').selectOption(String(1260)); await p.getByRole('button', { name: 'See what changes' }).click(); await p.waitForTimeout(500); await shot(p, 'cover-delayed'); await p.close();

p = await fresh(); await p.locator('nav.tabbar').getByRole('button', { name: 'Me' }).click(); await p.locator('button.li', { hasText: 'Backups' }).click(); await p.waitForTimeout(500); await shot(p, 'cover-backups'); await p.close();

p = await fresh(1440, 980); await p.getByRole('button', { name: /Show Sunita’s phone/ }).click(); await p.waitForTimeout(800); await shot(p, 'cover-demo-side-by-side'); await p.close();
await browser.close(); console.log('done');
