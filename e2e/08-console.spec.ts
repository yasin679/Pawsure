import { test, expect, type Page } from '@playwright/test';
import { boot, signInOwner, staff, consoleSection, api, webhook, tick, PHONE, SUNITA, DAY } from './helpers';

test.use({ viewport: { width: 1280, height: 900 } });
const main = (page: Page) => page.locator('.console-main');

/** A points hold: helper photo makes the 1 PM lunch “Likely”, then the owner’s return check finds the bowl untouched. */
async function createHold(page: Page) {
  await api(page, 'POST', '/demo/clock', { set: `${DAY}T12:52:00+05:30` }); await tick(page);
  const card = await api<{ codes: Record<string, string> }>(page, 'GET', '/v1/households/hh_demo/code-cards/current');
  await webhook(page, { from: SUNITA, type: 'photo', taskId: `r1_${DAY}`, mediaRef: 'hold-1', caption: card.body.codes['6'] });
  await api(page, 'POST', '/v1/households/hh_demo/day/leaving', { checklist: null, returnAt: 1140 });
  await api(page, 'POST', '/demo/clock', { set: `${DAY}T18:30:00+05:30` });
  await api(page, 'POST', '/v1/households/hh_demo/day/back', {});
  const r = await api(page, 'POST', '/v1/households/hh_demo/day/return-check', { food: 1, water: 0, pad: 0, pet: 0, damage: 0 });
  expect(r.status).toBe(200);
}

test.describe('K. Operations console', () => {
  test('K1 A household owner is refused: no staff role', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await page.evaluate(() => { location.hash = 'admin'; });
    await page.locator('#sp').fill(PHONE.neha); await page.getByRole('button', { name: 'Send code' }).click();
    await page.locator('#sc').fill((await page.locator('span.mono').first().innerText()).trim()); await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('This account has no staff role.')).toBeVisible();
  });

  test('K2 Ops on shift sees only their sections; overview shows each pilot gate with n and status', async ({ page }) => {
    await boot(page); await staff(page, PHONE.ops);
    const nav = await page.locator('.console-nav button').allInnerTexts();
    expect(nav).toEqual(expect.arrayContaining(['Pilot overview', 'Service health', 'Queues', 'Households', 'Method mix', 'Signals', 'Friend Finder']));
    expect(nav).not.toContain('Audit log'); expect(nav).not.toContain('Switches'); expect(nav).not.toContain('Rights requests');
    await expect(main(page).locator('.console-kpis .card')).toHaveCount(6);
    await expect(main(page)).toContainText('n = ');
  });

  test('K3 Households view masks phone numbers', async ({ page }) => {
    await boot(page); await staff(page, PHONE.ops);
    await consoleSection(page, 'Households');
    await expect(main(page)).toContainText('+91 •••• ••21');
    await expect(main(page)).not.toContainText('9800000021');
  });

  test('K4 Queues: a helper callback case can only be closed with a reason', async ({ page }) => {
    await boot(page);
    await webhook(page, { from: SUNITA, type: 'text', text: 'help' });
    await staff(page, PHONE.ops);
    await consoleSection(page, 'Queues');
    const row = main(page).locator('tr', { hasText: 'Helper callback' });
    await row.getByRole('button', { name: 'Close…' }).click();
    await row.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(main(page).getByRole('alert')).toContainText('Write a short reason');
    await row.getByPlaceholder('Reason for closing').fill('Called Sunita back, sorted');
    await row.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(main(page).locator('tr', { hasText: 'Helper callback' }).locator('.tag')).toHaveText('closed');
  });

  test('K5 Ops lead: switches — turn on the share record; locked switches cannot be changed', async ({ page }) => {
    await boot(page); await staff(page, PHONE.lead);
    await consoleSection(page, 'Switches');
    const share = main(page).locator('tr', { hasText: 'helperShareRecord' });
    await share.getByRole('button', { name: 'Turn on' }).click();
    await expect(share.locator('.tag').first()).toHaveText('true');
    await expect(main(page).locator('tr', { hasText: 'nearbyMemberFallback' }).getByRole('button')).toBeDisabled();
  });

  test('K6 Ops lead: a points hold needs a reason the helper can read; releasing it notifies her', async ({ page }) => {
    await boot(page); await signInOwner(page); await createHold(page);
    await staff(page, PHONE.lead);
    await consoleSection(page, 'Rewards holds');
    await main(page).getByRole('button', { name: 'Decide…' }).first().click();
    await main(page).getByRole('button', { name: 'Release' }).click();
    await expect(main(page).getByRole('alert')).toContainText('reason the helper can read');
    await main(page).getByPlaceholder('Reason the helper will read').fill('Owner later found the bowl was refilled.');
    await main(page).getByRole('button', { name: 'Release' }).click();
    await expect(main(page)).toContainText('Nothing on hold.');
  });

  test('K7 Privacy lead: answers and closes an owner’s rights request', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await api(page, 'POST', '/v1/me/rights', { kind: 'correction', detail: 'Bruno is 5' });
    await staff(page, PHONE.priv);
    await consoleSection(page, 'Rights requests');
    await main(page).getByRole('button', { name: 'Handle…' }).first().click();
    await main(page).getByPlaceholder('Reply the person will read').fill('Updated Bruno’s age to 5. Thank you.');
    await main(page).getByRole('button', { name: 'Reply and close' }).click();
    await expect(main(page).locator('tr', { hasText: 'correction' })).toContainText('closed');
  });

  test('K8 Privacy lead: breach rehearsal starts the 72 h clock; steps can be ticked', async ({ page }) => {
    await boot(page); await staff(page, PHONE.priv);
    await consoleSection(page, 'Breach runbook');
    await page.getByRole('button', { name: 'Start a rehearsal' }).click();
    const ev = main(page).locator('.card', { hasText: 'Rehearsal · aware' });
    await expect(ev).toContainText(/h left/);
    await ev.getByRole('button', { name: 'Affected people notified' }).click();
    await expect(ev.getByRole('button', { name: /✓ Affected people notified/ })).toBeDisabled();
    await main(page).getByText('Rehearsal held before pilot').click();
    await expect(main(page)).toContainText('Readiness (1/7)');
  });

  test('K9 Auditor: reads the append-only audit log, can export, cannot open households', async ({ page }) => {
    await boot(page); await staff(page, PHONE.audit);
    const nav = await page.locator('.console-nav button').allInnerTexts();
    expect(nav).not.toContain('Households');
    await consoleSection(page, 'Audit log');
    await main(page).getByRole('button', { name: 'Staff views' }).click();
    await expect(main(page).locator('tbody tr').first()).toContainText('admin.');
    await expect(main(page).getByRole('button', { name: 'Export CSV' })).toBeVisible();
    await expect(main(page)).not.toContainText(/\+91\d{10}/);
  });

  test('K10 Service health: a WhatsApp + SMS outage shows the failed delivery and raises an alert', async ({ page }) => {
    await boot(page);
    await api(page, 'POST', '/demo/outage', { channel: 'whatsapp', down: true });
    await api(page, 'POST', '/demo/outage', { channel: 'sms', down: true });
    await webhook(page, { from: SUNITA, type: 'text', text: 'points' });
    await tick(page);
    // Restore SMS so staff can receive a sign-in code (an SMS outage correctly blocks sign-in codes).
    await api(page, 'POST', '/demo/outage', { channel: 'sms', down: false });
    await staff(page, PHONE.lead);
    await consoleSection(page, 'Service health');
    await expect(main(page).locator('tr', { hasText: 'Message delivery' }).locator('.tag')).toHaveText('alert');
    await expect(main(page).locator('tr', { hasText: 'WhatsApp BSP' })).toContainText('Simulated outage');
    await expect(main(page)).toContainText('gave up');
  });

  test('K11 Pilot readiness: switches checked against §4.2; the arms check needs the enrolled cohort', async ({ page }) => {
    await boot(page); await staff(page, PHONE.lead);
    await consoleSection(page, 'Pilot readiness');
    await expect(main(page).locator('tr', { hasText: 'nearbyMemberFallback' })).toContainText('OK');
    await expect(main(page).locator('tr', { hasText: 'helperRewards arms' })).toContainText('Fix');
    await main(page).getByRole('button', { name: 'Assign arms for this cohort' }).click();
    await expect(main(page)).toContainText('too_few_households');
  });

  test('K12 Ops: method mix hides groups under 5 and never lists a helper', async ({ page }) => {
    await boot(page); await staff(page, PHONE.ops);
    await consoleSection(page, 'Method mix');
    await expect(main(page)).toContainText('fewer than 5 — hidden');
    await expect(main(page)).not.toContainText('Sunita');
  });
});

test('K13 Every role opens each of its console sections without an error', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page);
  for (const phone of [PHONE.ops, PHONE.lead, PHONE.priv, PHONE.audit]) {
    await staff(page, phone);
    const sections = (await page.locator('.console-nav button').allInnerTexts()).filter(s => !['Sign out', 'Back to the owner app'].includes(s));
    for (const s of sections) {
      await consoleSection(page, s);
      await expect(main(page).locator('h1')).toHaveText(s === 'Rewards holds' ? 'Rewards holds' : s);
      await expect(main(page).locator('.card.danger[role=alert]')).toHaveCount(0);
    }
    await page.locator('.console-nav').getByRole('button', { name: 'Sign out' }).click();
    await api(page, 'POST', '/demo/clock', { advance: 1 });
  }
});
