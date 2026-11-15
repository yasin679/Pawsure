/**
 * Captures the guide screenshots from the demo build, with numbered markers on the items the guide tables explain.
 * Run: npx playwright test -c docs/build/shots.config.ts   → docs/images/*.jpg
 */
import { test, type Page, type Locator } from '@playwright/test';
import { boot, signIn, signInOwner, signOut, clockTo, tab, meItem, dialog, staff, consoleSection, api, webhook, tick, fillSociety, PHONE, SUNITA, DAY } from '../../e2e/helpers';

const OUT = 'docs/images/';
const MARK = '#A84C08'; // Pawsure marigold

async function hideDemoBar(page: Page, hide = true) {
  await page.evaluate(h => { let s = document.getElementById('doc-hide'); if (!s) { s = document.createElement('style'); s.id = 'doc-hide'; document.head.appendChild(s); } s.textContent = h ? '.demobar{display:none!important}' : ''; }, hide);
}
async function mark(page: Page, items: [Locator, number][]) {
  const boxes: { x: number; y: number; width: number; height: number; n: number }[] = [];
  for (const [l, n] of items) { const b = await l.first().boundingBox(); if (b) boxes.push({ ...b, n }); }
  await page.evaluate(([bs, color]) => {
    document.querySelectorAll('.doc-mark').forEach(e => e.remove());
    for (const b of bs as { x: number; y: number; width: number; height: number; n: number }[]) {
      const o = document.createElement('div'); o.className = 'doc-mark';
      const vw = innerWidth, vh = innerHeight, x = Math.max(b.x - 3, 14), y = Math.max(b.y - 3, 14), r = Math.min(b.x + b.width + 3, vw - 3), btm = Math.min(b.y + b.height + 3, vh - 3);
      Object.assign(o.style, { position: 'fixed', left: x + 'px', top: y + 'px', width: r - x + 'px', height: btm - y + 'px', border: `2.5px solid ${color}`, borderRadius: '10px', zIndex: '99999', pointerEvents: 'none' });
      const c = document.createElement('div'); c.textContent = String(b.n);
      Object.assign(c.style, { position: 'absolute', left: '-12px', top: '-12px', width: '22px', height: '22px', borderRadius: '50%', background: color as string, color: '#fff', font: '800 12px Nunito, sans-serif', display: 'grid', placeItems: 'center', boxShadow: '0 0 0 2px #fff' });
      o.appendChild(c); document.body.appendChild(o);
    }
  }, [boxes, MARK] as const);
}
const shot = async (page: Page, name: string) => { await page.waitForTimeout(350); await page.screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 82 }); await page.evaluate(() => document.querySelectorAll('.doc-mark').forEach(e => e.remove())); };
const top = (page: Page) => page.evaluate(() => { document.querySelector('main.body')?.scrollTo(0, 0); window.scrollTo(0, 0); });

test('sign-in and onboarding', async ({ page }) => {
  await boot(page); await hideDemoBar(page);
  await mark(page, [[page.locator('.login-hero'), 1]]); await shot(page, '01-welcome');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await page.locator('#ph').fill('9811222333');
  await mark(page, [[page.locator('#ph'), 1], [page.getByRole('button', { name: 'Send code' }), 2]]); await shot(page, '02-phone');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.locator('#otp').fill((await page.locator('b.mono').first().innerText()).trim());
  await mark(page, [[page.locator('#otp'), 1], [page.getByRole('button', { name: 'Verify' }), 2], [page.getByRole('button', { name: 'Resend code' }), 3]]); await shot(page, '03-code');
  await page.getByRole('button', { name: 'Verify' }).click();
  await mark(page, [[page.getByText('I accept the Terms of Use'), 1], [page.getByText('I have read the Privacy Notice'), 2], [page.locator('.card', { hasText: 'Optional' }), 3]]); await shot(page, '04-consent');
  await page.getByText('I accept the Terms of Use').click(); await page.getByText('I have read the Privacy Notice').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const send = () => page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.locator('#nm').fill('Asha Rao'); await send(); await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.locator('#stt').click(); await page.getByRole('option', { name: 'Maharashtra', exact: true }).click();
  await page.locator('#cty').click(); await page.getByRole('option', { name: 'Mumbai', exact: true }).click();
  await page.getByRole('button', { name: 'My society isn’t listed' }).click(); await page.locator('#sct').fill('Raheja Vihar, Powai'); await send();
  await page.locator('#tw').fill('C'); await send(); await page.locator('#fl').fill('C-702'); await send();
  await mark(page, [[page.locator('.cb-sum'), 1], [page.getByRole('button', { name: 'Create my home' }), 2]]); await shot(page, '05-profile');
});

test('today', async ({ page }) => {
  await boot(page); await signInOwner(page);
  await clockTo(page, '13:05');
  await hideDemoBar(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await mark(page, [[page.getByRole('button', { name: 'Report a problem or emergency' }), 1], [page.locator('.conf').first(), 2], [page.locator('.petchips'), 3], [page.locator('.card', { hasText: 'Who’s caring today?' }), 4], [page.locator('.card', { hasText: 'Heading out?' }), 5], [page.locator('nav.tabbar'), 6]]);
  await shot(page, '10-today');
  await page.locator('button.task').first().scrollIntoViewIfNeeded();
  await mark(page, [[page.getByRole('button', { name: 'Timeline' }), 1], [page.getByRole('button', { name: 'Day report' }), 2], [page.locator('button.task').first().locator('.time'), 3], [page.locator('button.task').first().locator('.conf'), 4]]);
  await shot(page, '11-plan-evidence');
  await top(page);
  await page.locator('.card', { hasText: 'Who’s caring today?' }).getByRole('button', { name: 'Change' }).click();
  await mark(page, [[dialog(page).locator('button.li').nth(0), 1], [dialog(page).locator('button.li').nth(1), 2], [dialog(page).locator('button.li').nth(2), 3], [dialog(page).locator('button.li').nth(3), 4]]);
  await shot(page, '12-whos-caring');
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await page.locator('.card', { hasText: 'Heading out?' }).getByRole('button', { name: 'I’m leaving' }).click();
  await mark(page, [[dialog(page).locator('.card').first(), 1], [dialog(page).locator('#rt'), 2], [dialog(page).getByRole('button', { name: 'Skip' }), 3], [dialog(page).getByRole('button', { name: 'I’m leaving' }), 4]]);
  await shot(page, '13-leaving');
  await dialog(page).getByRole('button', { name: 'I’m leaving' }).click();
  await hideDemoBar(page, false); await clockTo(page, '18:00'); await hideDemoBar(page);
  await page.getByRole('button', { name: 'I’m back' }).click();
  await mark(page, [[dialog(page).getByRole('radiogroup').first(), 1], [dialog(page).getByRole('button', { name: 'Save' }), 2]]);
  await shot(page, '14-return-check');
});

test('alerts, task detail, sos, timeline, report', async ({ page }) => {
  await boot(page); await signInOwner(page);
  await clockTo(page, '13:35'); await hideDemoBar(page); await top(page);
  const alert = page.locator('.card', { hasText: 'Bruno · Lunch + fresh water' });
  await alert.scrollIntoViewIfNeeded();
  await mark(page, [[alert.locator('.conf'), 1], [alert.locator('.small'), 2], [alert.getByRole('button', { name: 'I’m on it' }), 3], [alert.getByRole('button', { name: 'Call Sunita' }), 4]]);
  await shot(page, '15-missed-alert');
  await page.locator('button.task', { hasText: 'Lunch + fresh water' }).click();
  await mark(page, [[dialog(page).locator('.card', { hasText: 'Why this label' }), 1], [dialog(page).locator('.card', { hasText: 'Escalation ladder' }), 2], [dialog(page).locator('.card', { hasText: 'Lifecycle' }), 3], [dialog(page).getByRole('button', { name: 'Change this task' }), 4]]);
  await shot(page, '16-task-detail');
  await dialog(page).getByRole('button', { name: 'Close' }).last().click();
  await top(page);
  await page.getByRole('button', { name: 'Report a problem or emergency' }).click();
  await mark(page, [[dialog(page).locator('.banner').first(), 1], [dialog(page).locator('.card', { hasText: 'S1 Urgent' }), 2], [dialog(page).locator('.card', { hasText: 'S2 Unwell' }), 3], [dialog(page).locator('.card', { hasText: 'S3 Practical' }), 4]]);
  await shot(page, '17-sos');
  await dialog(page).getByRole('button', { name: 'Pet hurt' }).click();
  await top(page);
  const inc = page.locator('.card.danger', { hasText: 'S1 · pet hurt' });
  await inc.getByRole('button', { name: 'Open' }).click();
  await mark(page, [[dialog(page).locator('.card').first(), 1], [dialog(page).locator('.banner'), 2], [dialog(page).locator('#ir'), 3]]);
  await shot(page, '18-incident');
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Timeline' }).click(); await shot(page, '19-timeline');
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Day report' }).click(); await shot(page, '20-day-report');
});

test('pet, routine, health, helper, circle', async ({ page }) => {
  await boot(page); await signInOwner(page); await hideDemoBar(page);
  await tab(page, 'Pet');
  await mark(page, [[page.locator('.seg'), 1], [page.getByRole('button', { name: 'Edit' }), 2], [page.locator('button.li', { hasText: 'Emergency card' }), 3], [page.locator('button.li', { hasText: 'Routine' }), 4], [page.locator('button.li', { hasText: 'Health calendar' }), 5]]);
  await shot(page, '21-pet');
  await page.locator('button.li', { hasText: 'Emergency card' }).click(); await shot(page, '22-emergency-card');
  await page.locator('header button, .appbar button').first().click();
  await page.locator('button.li', { hasText: 'Routine' }).click();
  await mark(page, [[page.getByRole('button', { name: 'Add' }), 1], [page.locator('button.li').first(), 2]]); await shot(page, '23-routine');
  await page.locator('header button, .appbar button').first().click();
  await page.locator('button.li', { hasText: 'Health calendar' }).click();
  await mark(page, [[page.getByRole('button', { name: 'Add' }), 1], [page.locator('.card', { hasText: 'Rabies' }).locator('.tag'), 2], [page.locator('.card', { hasText: 'Rabies' }).getByRole('button', { name: 'Done' }), 3]]);
  await shot(page, '24-health');
  await meItem(page, 'Helper and check-ins');
  await mark(page, [[page.locator('.card', { hasText: 'Sunita' }).locator('.tag').first(), 1], [page.getByRole('button', { name: 'Practice together' }), 2], [page.getByRole('button', { name: 'Invite another helper' }), 3]]);
  await shot(page, '25-helper');
  await page.locator('.codecard').scrollIntoViewIfNeeded();
  await mark(page, [[page.locator('.codecard td.today'), 1], [page.getByRole('button', { name: 'Rotate now' }), 2]]); await shot(page, '26-code-card');
  await meItem(page, 'Care circle');
  await mark(page, [[page.getByRole('button', { name: 'Invite' }), 1], [page.locator('.li', { hasText: 'Ankita' }), 2], [page.locator('.li', { hasText: 'Ankita' }).getByRole('button', { name: 'Remove' }), 3]]);
  await shot(page, '27-care-circle');
  await tab(page, 'Me');
  await mark(page, [[page.locator('button.li', { hasText: 'Profile and what friends see' }), 1], [page.locator('button.li', { hasText: 'Helper and check-ins' }), 2], [page.locator('button.li', { hasText: 'Care circle' }), 3], [page.locator('button.li', { hasText: 'Wallet' }), 4], [page.locator('button.li', { hasText: 'Your data rights' }), 5]]);
  await shot(page, '28-me');
});

test('find cover', async ({ page }) => {
  await boot(page); await signInOwner(page); await hideDemoBar(page);
  await tab(page, 'Find cover');
  await page.locator('#ask').fill('I am stuck in a meeting until 8. Can someone feed Bruno and take him down at 5?');
  await mark(page, [[page.locator('#ask'), 1], [page.locator('.chips').first(), 2], [page.getByRole('button', { name: 'Understand my request' }), 3], [page.getByRole('button', { name: 'Simple form' }), 4]]);
  await shot(page, '30-ask');
  await page.getByRole('button', { name: 'Understand my request' }).click();
  await mark(page, [[page.locator('.card.flat').first(), 1], [page.locator('.chips').first(), 2], [page.locator('#rt'), 3], [page.locator('#ra'), 4], [page.getByRole('button', { name: 'Search my friends' }), 5]]);
  await shot(page, '31-check-details');
  await page.getByRole('button', { name: 'Search my friends' }).click();
  const first = page.locator('.card', { hasText: '1. Priya Shah' });
  await mark(page, [[first.locator('ul'), 1], [first.getByRole('button', { name: 'Ask Priya' }), 2], [first.locator('input[type=checkbox]'), 3]]);
  await shot(page, '32-suggestions');
  await first.getByRole('button', { name: 'Ask Priya' }).click();
  await mark(page, [[page.locator('.bub'), 1], [page.locator('.card.flat'), 2], [page.getByText(/I approve sending/), 3], [page.getByRole('button', { name: 'Send on WhatsApp' }), 4]]);
  await shot(page, '33-approve');
  await page.getByText(/I approve sending/).click(); await page.getByRole('button', { name: 'Send on WhatsApp' }).click();
  await hideDemoBar(page, false);
  await page.getByRole('button', { name: 'Show friends’ phones' }).click();
  const sim = page.locator('.sheet', { hasText: 'Friends’ phones (simulated)' });
  await sim.locator('.qr').getByRole('button', { name: 'Yes', exact: true }).last().waitFor();
  await shot(page, '34-friend-phone');
  await sim.locator('.qr').getByRole('button', { name: 'Yes', exact: true }).last().click(); await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Hide friends’ phones' }).click(); await hideDemoBar(page);
  await page.getByRole('button', { name: 'Confirm', exact: true }).waitFor();
  await mark(page, [[page.locator('.conf').first(), 1], [page.locator('.li', { hasText: 'Priya' }), 2], [page.getByRole('button', { name: 'Confirm', exact: true }), 3], [page.locator('.card.flat', { hasText: 'Event history' }), 4]]);
  await shot(page, '35-request');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByText(/Shared with Priya/i).waitFor(); await shot(page, '36-confirmed');
});

test('friends, privacy, wallet, rights', async ({ page }) => {
  await boot(page); await signInOwner(page); await hideDemoBar(page);
  await tab(page, 'Friends');
  await mark(page, [[page.getByRole('button', { name: 'Invite', exact: true }), 1], [page.locator('button.li', { hasText: 'Priya' }), 2], [page.locator('.card.flat', { hasText: 'Nearby' }), 3]]);
  await shot(page, '37-friends');
  await page.locator('button.li', { hasText: 'Priya Shah' }).click();
  await mark(page, [[page.locator('.card', { hasText: 'Comfortable with' }), 1], [page.locator('.card.flat', { hasText: 'History' }), 2], [page.getByRole('button', { name: 'Ask for help' }), 3], [page.getByRole('button', { name: 'Block' }), 4]]);
  await shot(page, '38-friend-profile');
  await meItem(page, 'Profile and what friends see'); await shot(page, '39-privacy');
  await meItem(page, 'Wallet and points'); await shot(page, '40-wallet');
  await meItem(page, 'Your data rights');
  await mark(page, [[page.getByRole('button', { name: 'Show my data' }), 1], [page.locator('.list').first(), 2]]); await shot(page, '41-data-rights');
});

test('helper phone, look-in, helper and circle homes, friend app', async ({ page }) => {
  await boot(page); await signInOwner(page);
  await clockTo(page, '12:50');
  await page.getByRole('button', { name: 'Show Sunita’s phone' }).click();
  const ph = page.locator('.sheet', { hasText: 'Sunita’s phone (simulated)' });
  await ph.getByRole('button', { name: '📷 Photo + today’s code' }).click(); await page.waitForTimeout(600);
  await shot(page, '42-helper-whatsapp');
  await clockTo(page, '14:01');
  await ph.getByRole('button', { name: 'Open the backup’s look-in link (Ankita)' }).click();
  await page.getByText(/Look-in for/).waitFor(); await hideDemoBar(page);
  await mark(page, [[page.locator('.card.warn'), 1], [page.locator('dl.kv'), 2], [page.getByRole('button', { name: 'I’m on it' }), 3]]); await shot(page, '43-look-in');
  await page.evaluate(() => { location.hash = ''; });
  await signOut(page); await signIn(page, '9000000035'); await page.getByRole('heading', { name: 'Pawsure for helpers' }).waitFor(); await hideDemoBar(page); await shot(page, '44-helper-home');
  await signOut(page); await signIn(page, '9700000008'); await page.getByRole('heading', { name: 'Care circle' }).waitFor(); await hideDemoBar(page); await shot(page, '45-circle-home');
  await signOut(page); await signIn(page, PHONE.priya); await page.getByRole('heading', { name: 'Requests for you' }).waitFor(); await hideDemoBar(page);
  await page.getByRole('button', { name: 'My settings (F7)' }).click();
  await mark(page, [[page.getByRole('switch', { name: /Friends can find me/ }), 1], [page.getByRole('switch', { name: /Pause all requests/ }), 2], [page.locator('.card', { hasText: 'When I’m usually free' }), 3], [page.locator('.card', { hasText: 'Tasks I’m comfortable with' }), 4]]);
  await shot(page, '46-friend-settings');
});

test.describe('console', () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
  test('ops console', async ({ page }) => {
    await boot(page);
    await webhook(page, { from: SUNITA, type: 'text', text: 'help' });
    await api(page, 'POST', '/demo/clock', { set: `${DAY}T13:40:00+05:30` }); await tick(page);
    await staff(page, PHONE.lead);
    await mark(page, [[page.locator('.console-nav'), 1], [page.locator('.console-kpis'), 2], [page.locator('.console-main .card.flat'), 3]]); await shot(page, '50-console-overview');
    for (const [s, f] of [['Service health', '51-service-health'], ['Queues', '52-queues'], ['Households', '53-households'], ['Switches', '54-switches'], ['Rewards holds', '55-rewards'], ['Audit log', '57-audit'], ['Breach runbook', '58-breach'], ['Pilot readiness', '59-pilot-readiness'], ['Friend Finder', '60-console-ff'], ['Method mix', '61-method-mix']] as const) {
      await consoleSection(page, s); await page.waitForTimeout(500); await shot(page, f);
    }
    await page.locator('.console-nav').getByRole('button', { name: 'Sign out' }).click();
    await staff(page, PHONE.priv); await consoleSection(page, 'Rights requests'); await shot(page, '56-rights');
  });
});
