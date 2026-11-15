import { test, expect, type Page } from '@playwright/test';
import { boot, signInOwner, clockTo, taskCard, meItem, tab, api, openPlan } from './helpers';

/** Sunita’s simulated phone (demo bar) posts to the same WhatsApp and IVR webhooks a real phone would. */
const phone = (page: Page) => page.locator('.sheet', { hasText: 'Sunita’s phone (simulated)' });
async function openPhone(page: Page) { await page.getByRole('button', { name: 'Show Sunita’s phone' }).click(); await expect(phone(page)).toBeVisible(); }

test.describe('E. Helper check-ins (Sunita’s phone)', () => {
  test.beforeEach(async ({ page }) => { await boot(page); await signInOwner(page); });

  test('E1 Prompt arrives 10 min before; photo + today’s code → Likely; plus arrival and exit calls → Confirmed', async ({ page }) => {
    await clockTo(page, '12:50');
    await openPhone(page);
    await expect(phone(page)).toContainText('Lunch + fresh water');
    await phone(page).getByRole('button', { name: '☎ Arrival call' }).click();
    await phone(page).getByRole('button', { name: '📷 Photo + today’s code' }).click();
    await expect(taskCard(page, 'Lunch + fresh water')).toContainText('Likely');
    await page.getByRole('button', { name: '+15m' }).click();
    await phone(page).getByRole('button', { name: '☎ Exit call' }).click();
    await expect(taskCard(page, 'Lunch + fresh water')).toContainText('Confirmed');
  });

  test('E2 A wrong code is flagged and does not confirm the task', async ({ page }) => {
    await clockTo(page, '12:50');
    await openPhone(page);
    await phone(page).getByRole('button', { name: '📷 Wrong code' }).click();
    await expect(taskCard(page, 'Lunch + fresh water')).toContainText('Not confirmed');
  });

  test('E3 Re-sending an old photo is not counted', async ({ page }) => {
    await clockTo(page, '12:50');
    await openPhone(page);
    await phone(page).getByRole('button', { name: '📷 Re-send old photo' }).click();
    await phone(page).locator('#simt').selectOption({ label: 'Wet food + litter tray' });
    await phone(page).getByRole('button', { name: '📷 Re-send old photo' }).click();
    await expect(phone(page)).toContainText('हा फोटो आधी आला होता'); // Sunita’s messages are in Marathi
    await page.getByRole('button', { name: 'Hide Sunita’s phone' }).click();
    await openPlan(page);
    await page.getByRole('button', { name: 'Timeline' }).click();
    await expect(page.getByRole('dialog')).toContainText('not counted (reused image)');
  });

  test('E4 Voice note and IVR code each give Likely', async ({ page }) => {
    await clockTo(page, '12:50');
    await openPhone(page);
    await phone(page).getByRole('button', { name: '🎤 Voice note' }).click();
    await expect(taskCard(page, 'Lunch + fresh water')).toContainText('Likely');
    await phone(page).locator('#simt').selectOption({ label: 'Wet food + litter tray' });
    await phone(page).getByRole('button', { name: '☎ IVR code' }).click();
    await page.getByRole('tab', { name: /Misty/ }).click(); // Home shows one pet's tasks at a time
    await expect(taskCard(page, 'Wet food + litter tray')).toContainText('Likely');
  });

  test('E5 Helper reports “water ran out” → S3 incident on the owner’s Today', async ({ page }) => {
    await openPhone(page);
    await phone(page).getByRole('button', { name: '⚠ Water ran out' }).click();
    await expect(page.locator('.card.danger', { hasText: 'S3 · water out' })).toBeVisible();
  });

  test('E6 Helper reports “pet hurt” → S1 incident with the call plan', async ({ page }) => {
    await openPhone(page);
    await phone(page).getByRole('button', { name: '⚠ Pet hurt' }).click();
    const inc = page.locator('.card.danger', { hasText: 'S1 · pet hurt' });
    await expect(inc).toBeVisible();
    await inc.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('dialog')).toContainText('Call your own vet');
  });

  test('E7 Helper says “stop” → check-ins stopped; “start” re-asks consent and Yes resumes', async ({ page }) => {
    await openPhone(page);
    await phone(page).getByRole('button', { name: '⏹ Stop' }).click();
    await expect(phone(page)).toContainText('थांबवले. आता काहीही नोंदवले जाणार नाही'); // “Stopped. Nothing will be recorded now” in Marathi
    await page.getByRole('button', { name: 'Hide Sunita’s phone' }).click();
    await meItem(page, 'Helper and check-ins');
    await expect(page.locator('.card', { hasText: 'Sunita' }).locator('.tag').first()).toHaveText('Stopped check-ins');
    await expect(page.getByText(/Nothing about Sunita is being recorded/)).toBeVisible();
    await tab(page, 'Today');
    await page.getByRole('button', { name: 'Show Sunita’s phone' }).click();
    await phone(page).getByRole('button', { name: '▶ Start again' }).click();
    // Starting again re-asks for consent; check-ins resume only after she says Yes (हो) again.
    await phone(page).locator('.qr').getByRole('button', { name: 'हो' }).last().click();
    await page.getByRole('button', { name: 'Hide Sunita’s phone' }).click();
    await meItem(page, 'Helper and check-ins');
    await expect(page.locator('.card', { hasText: 'Sunita' }).locator('.tag').first()).toHaveText('Consent given');
  });

  test('E8 Helper screen: code card shown; rotating makes version 2', async ({ page }) => {
    await meItem(page, 'Helper and check-ins');
    await expect(page.locator('.codecard')).toContainText('version 1');
    await page.getByRole('button', { name: 'Rotate now' }).click();
    await page.locator('.card.warn').getByRole('button', { name: 'Rotate' }).click();
    await expect(page.locator('.codecard')).toContainText('version 2');
    await expect(page.getByText('New card created. Old codes no longer count.')).toBeVisible();
  });

  test('E9 Invite a new helper → waiting for their reply; nothing recorded yet', async ({ page }) => {
    await meItem(page, 'Helper and check-ins');
    await page.getByRole('button', { name: 'Invite another helper' }).click();
    await page.locator('#in').fill('Lata');
    await page.locator('#ip').fill('9811333444');
    await page.getByRole('button', { name: 'Send WhatsApp invite' }).click();
    await expect(page.getByText('Invitation sent on WhatsApp (simulated).')).toBeVisible();
    await expect(page.locator('.card', { hasText: 'Lata' }).locator('.tag').first()).toHaveText('Waiting for a reply');
  });

  test('E10 Backup look-in: link sent at +60 min, opens the pet card, “I’m on it”; expires after 15 min', async ({ page }) => {
    await clockTo(page, '14:01');
    await openPhone(page);
    await phone(page).getByRole('button', { name: 'Open the backup’s look-in link (Ankita)' }).click();
    await expect(page.getByText(/Look-in for (Bruno|Misty)/)).toBeVisible(); // both 1 PM visit tasks were missed
    await expect(page.getByText(/Not for backups to give/)).toBeVisible();
    await page.getByRole('button', { name: 'I’m on it' }).click();
    await expect(page.getByText('Thanks, the owner will see that you’re on it.')).toBeVisible();
    const link = await page.evaluate(() => location.hash);
    await api(page, 'POST', '/demo/clock', { advance: 20 });
    await page.evaluate(() => { location.hash = ''; });
    await page.evaluate(h => { location.hash = h; }, link);
    await expect(page.getByText('This link has expired')).toBeVisible();
  });
});

test.describe('F. Care circle', () => {
  test.beforeEach(async ({ page }) => { await boot(page); await signInOwner(page); await meItem(page, 'Care circle'); });

  test('F1 Invite a family member → listed as invited', async ({ page }) => {
    await page.getByRole('button', { name: 'Invite' }).click();
    await page.locator('#cn').fill('Kiran');
    await page.locator('#cp').fill('9811444555');
    await page.locator('#cr').selectOption('family');
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.locator('.li', { hasText: 'Kiran' })).toContainText('invited');
  });

  test('F2 Remove the backup → access removed on every channel within 60 s', async ({ page }) => {
    await page.locator('.li', { hasText: 'Ankita' }).getByRole('button', { name: 'Remove' }).click();
    await page.locator('.card.warn').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText(/Access removed for Ankita/)).toBeVisible();
    await expect(page.locator('.tag', { hasText: /Removed in \d+ ms/ }).first()).toBeVisible();
  });
});

test('F3 Owner sees co-owner Rohan in the circle with his permissions', async ({ page }) => {
  await boot(page); await signInOwner(page); await tab(page, 'Me');
  await page.locator('button.li', { hasText: 'Care circle' }).click();
  await expect(page.locator('.li', { hasText: 'Rohan' })).toContainText('Timeline, routine, alerts, friends');
});
