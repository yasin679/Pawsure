/** Shared steps for the Pawsure end-to-end tests. Every test boots its own fresh demo (the database lives in the page). */
import { expect, type Page } from '@playwright/test';

export const API = 'https://api.pawsure.demo';
export const DAY = '2026-11-06';
export const PHONE = { neha: '9800000021', rohan: '9800000022', priya: '9900000012', arjun: '9800000077', meera: '9700000090', ops: '9811000001', lead: '9811000002', priv: '9811000003', audit: '9811000004' };
export const SUNITA = '+919000000035';

/** Opens the demo. Tests switch the demo tools on (clock, simulated phones); real users see them only on request. */
export async function boot(page: Page, hash = '', opts: { tools?: boolean } = {}) {
  if (opts.tools !== false) await page.addInitScript(() => { try { localStorage.setItem('pawsure.demoTools', '1'); } catch { /* ignore */ } });
  // The demo keeps its data in the browser; a test that boots again in the same page starts from a fresh demo.
  if (page.url().startsWith('http')) await page.evaluate(async () => {
    try { localStorage.removeItem('pawsure.session'); localStorage.removeItem('pawsure.staff.session'); } catch { /* ignore */ }
    const dbs = (await indexedDB.databases?.()) ?? [];
    for (const d of dbs) if (d.name?.includes('pawsure-demo')) indexedDB.deleteDatabase(d.name);
  });
  await page.goto('/demo.html' + hash);
  await page.waitForSelector('html[data-demo-ready]', { state: 'attached', timeout: 90_000 });
}

/** Calls the in-page API as the signed-in user (or anonymously). Used for setup and for checking stored results. */
export async function api<T = any>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(async ([m, p, b, A]) => {
    const s = JSON.parse(localStorage.getItem('pawsure.session') ?? 'null');
    const r = await fetch(A + p, { method: m, headers: { 'content-type': 'application/json', ...(s ? { authorization: 'Bearer ' + s.token } : {}) }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [method, path, body, API] as const);
}
/** Sign-up asks for the city first, then a listed society or a typed one (PAW-018). */
export async function fillSociety(page: Page, name: string, city = 'Mumbai', state = 'Maharashtra') {
  await page.locator('#stt').selectOption(state);
  await page.locator('#cty').selectOption(city);
  await page.getByRole('button', { name: 'My society isn’t listed' }).click();
  await page.locator('#sct').fill(name);
}
/** Opens one of the in-app pickers (state, city, society, language) and taps an option. */
export async function pick(page: Page, id: string, option: string) {
  await page.locator('#' + id).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
/** Onboarding is a conversation with Pawly in three playbooks: your information (→ create my home), your pet, care details. The circle question follows. */
export async function intake(page: Page, name: string, society: string, o: { tower?: string; flat?: string; city?: string; state?: string; pet?: string } = {}) {
  const send = () => page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.locator('#nm').fill(name); await send();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await pick(page, 'stt', o.state ?? 'Maharashtra');
  await pick(page, 'cty', o.city ?? 'Mumbai');
  await page.getByRole('button', { name: 'My society isn’t listed' }).click();
  await page.locator('#sct').fill(society); await send();
  if (o.tower) { await page.locator('#tw').fill(o.tower); await send(); } else await page.getByRole('button', { name: 'Skip', exact: true }).click();
  if (o.flat) { await page.locator('#fl').fill(o.flat); await send(); } else await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Create my home' }).click();
  await petAndCare(page, o.pet ?? 'Coco');
}
/** Playbooks 2 and 3 of the onboarding conversation: one dog, fed at 8 AM, no walks, cared for by the owner. */
export async function petAndCare(page: Page, pet = 'Coco') {
  await page.locator('#pn0').fill(pet); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: /Dog/ }).click();
  await page.getByRole('button', { name: '1–3 years' }).click();
  await page.locator('#pf0').fill('1 cup kibble at 8 AM and 7 PM'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'None known', exact: true }).click();
  await page.getByRole('button', { name: 'None', exact: true }).click();
  await page.locator('#pv0').fill('Dr. Rao, Powai Pet Clinic'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.locator('#pp0').fill('+91 22 5555 0101'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'No, that’s all' }).click();
  // Playbook 3: Care details
  await page.getByRole('button', { name: 'Morning · 8 AM' }).click(); await page.getByRole('button', { name: /^Done/ }).click();
  await page.getByRole('button', { name: 'No walks' }).click();
  await page.getByRole('button', { name: 'Me or my family' }).click();
}
/** Closes the Plan for today sheet if it is open (it covers Home and the demo bar). */
export async function closePlan(page: Page) {
  const plan = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Plan for today' }) });
  if (await plan.isVisible()) await plan.getByRole('button', { name: 'Close' }).click();
}
/** Opens Home → Plan for today (who's caring, leaving / back, timeline, day report, edit routine, tomorrow). */
export async function openPlan(page: Page) {
  if (await page.getByRole('heading', { name: 'Plan for today' }).isVisible()) return;
  await page.getByRole('button', { name: 'Plan for today' }).click();
  await expect(page.getByRole('heading', { name: 'Plan for today' })).toBeVisible();
}
export const tick = (page: Page) => api(page, 'POST', '/jobs/tick', {});
export const webhook = (page: Page, body: Record<string, unknown>) => api(page, 'POST', '/webhooks/whatsapp', { messageId: 'e2e-' + Math.random().toString(36).slice(2), ...body });

/** Owner sign-in through the real screens (welcome → phone → code shown in demo mode → verify). */
export async function signIn(page: Page, phone10: string) {
  await page.locator('#ph').fill(phone10);
  await page.getByRole('button', { name: 'Send code' }).click();
  const code = (await page.locator('b.mono').first().innerText()).trim();
  await page.locator('#otp').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
}
/** New account: the Sign up tab, then the same number + code steps (consent and the Pawly conversation follow). */
export async function signUp(page: Page, phone10: string) {
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await signIn(page, phone10);
}
export async function signInOwner(page: Page) {
  await signIn(page, PHONE.neha);
  await expect(page.getByRole('heading', { name: /Neha/ })).toBeVisible();
}
/** Signs out with the app's own button (owner: Me → Sign out; friend: Sign out). The page isn't reloaded, so data is kept. */
export async function signOut(page: Page) {
  if (await page.locator('nav.tabbar').isVisible()) await tab(page, 'Me');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
}

/** The essential care and medical details every new pet needs. */
export async function fillPetEssentials(page: Page) {
  await page.locator('#f-food').fill('Dry food 150 g at 8 AM and 7 PM');
  await page.locator('#f-allergies').fill('None known');
  await page.locator('#f-medicines').fill('None');
  await page.locator('#f-vet_name').fill('Dr. Rao, Powai Pet Clinic');
  await page.locator('#f-vet_phone').fill('+91 22 5555 0101');
}

/** Sets the demo clock so that one +5m tap from the demo bar lands on HH:MM; the tap also runs the job and refreshes. */
export async function clockTo(page: Page, hhmm: string, day = DAY) {
  await closePlan(page);
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const t = h * 60 + m - 5;
  await api(page, 'POST', '/demo/clock', { set: `${day}T${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}:00+05:30` });
  await page.getByRole('button', { name: '+5m' }).click();
  await expect(page.locator('.demobar .t')).toHaveText(new RegExp('^' + ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0')));
}

export const tab = (page: Page, name: string) => page.locator('nav.tabbar').getByRole('button', { name }).click();
export const meItem = async (page: Page, name: string | RegExp) => { await tab(page, 'Me'); await page.locator('button.li', { hasText: name }).click(); };
export const taskCard = (page: Page, title: string) => page.locator('button.task', { hasText: title }).first();
export const dialog = (page: Page) => page.getByRole('dialog');

/** Staff sign-in on the console route (#admin). */
export async function staff(page: Page, phone10: string) {
  await page.evaluate(() => { location.hash = 'admin'; });
  await page.getByRole('heading', { name: 'Staff sign-in' }).waitFor();
  await page.locator('#sp').fill(phone10);
  await page.getByRole('button', { name: 'Send code' }).click();
  const code = (await page.locator('span.mono').first().innerText()).trim();
  await page.locator('#sc').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.console-nav')).toBeVisible();
}
export const consoleSection = (page: Page, name: string) => page.locator('.console-nav').getByRole('button', { name, exact: true }).click();

export async function noHorizontalScroll(page: Page) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw, 'page should not scroll sideways').toBeLessThanOrEqual(iw);
}
