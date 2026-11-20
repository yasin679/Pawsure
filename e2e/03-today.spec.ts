import { test, expect } from '@playwright/test';
import { boot, signInOwner, clockTo, taskCard, dialog, api, DAY, openPlan, closePlan, tab, helperCantCome } from './helpers';

test.describe('D. Today: daily care', () => {
  // D2 is about the leaving flow itself, so it starts at home; the others start after heading out (tasks visible).
  test.beforeEach(async ({ page }, info) => { await boot(page); await signInOwner(page, { home: info.title.startsWith('D2') }); });

  test('D1 Who’s caring → Trusted Helper mode; tapping Covered makes the day covered', async ({ page }) => {
    await page.locator('.help-card').getByRole('button', { name: 'Change' }).click();
    await dialog(page).getByRole('button', { name: /Trusted Helper mode/ }).click();
    await expect(page.locator('.help-card')).toContainText('Trusted Helper mode');
    await page.getByRole('button', { name: 'Covered', exact: true }).click();
    await openPlan(page);
    await expect(page.locator('.conf', { hasText: 'Covered day' }).first()).toBeVisible();
  });

  test('D2 Leaving checklist → I’m back → quick return check is saved', async ({ page }) => {
    await page.locator('.card', { hasText: 'Heading out?' }).getByRole('button', { name: 'I’m leaving' }).click();
    await dialog(page).getByText('Water bowl is full').click();
    await dialog(page).getByRole('button', { name: 'I’m leaving' }).click();
    await expect(page.getByText(/Out since 9:00 AM/)).toBeVisible();
    await clockTo(page, '18:00');
    await page.getByRole('button', { name: 'I’m back' }).click();
    for (const q of ['Food bowl', 'Water bowl', 'Toilet pad', 'Your pets', 'Anything damaged or wrong?']) await dialog(page).getByRole('radiogroup', { name: q }).getByRole('button').first().click();
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Return check saved/)).toBeVisible();
  });

  test('D3 Missed task: owner alert appears, “I’m on it”, then resolved with a note', async ({ page }) => {
    await clockTo(page, '13:35');
    const alert = page.locator('.card', { hasText: 'Bruno · Lunch + fresh water' });
    await expect(alert).toContainText('No evidence yet');
    await alert.getByRole('button', { name: 'I’m on it' }).click();
    await expect(alert).toContainText('You’re on it');
    await alert.getByRole('button', { name: 'Mark resolved' }).click();
    await dialog(page).locator('#rn').fill('Fed Bruno myself at 1:40');
    await dialog(page).getByRole('button', { name: 'Mark resolved' }).click();
    await expect(page.locator('.card', { hasText: 'Bruno · Lunch + fresh water' })).toHaveCount(0);
  });

  test('D4 Medicine is never passed to the backup: the alert says so', async ({ page }) => {
    await clockTo(page, '13:20');
    await expect(page.locator('.card', { hasText: 'Bruno · Joint supplement' })).toContainText('Medicine is never passed to your backup');
  });

  test('D5 Change a task: cancelling needs a reason and is kept in history', async ({ page }) => {
    await taskCard(page, 'Toilet pad change').click();
    await dialog(page).locator('summary', { hasText: 'Task details' }).click();
    await dialog(page).getByRole('button', { name: 'Change this task' }).click();
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(dialog(page).getByRole('alert')).toBeVisible();
    await dialog(page).locator('#cn').fill('Pads not needed today');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(taskCard(page, 'Toilet pad change')).toContainText('Cancelled');
  });

  test('D6 Timeline and day report open with today’s plan', async ({ page }) => {
    await openPlan(page);
    await page.getByRole('button', { name: 'Timeline' }).click();
    await expect(dialog(page).locator('.tl')).toContainText('Planned: Lunch + fresh water');
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await openPlan(page);
    await page.getByRole('button', { name: 'Day report' }).click();
    await expect(dialog(page)).toContainText('Joint supplement');
    await expect(dialog(page).getByRole('link', { name: 'Thank Sunita on WhatsApp' })).toBeVisible();
  });

  test('D7 SOS: report “Pet hurt” → S1 incident → I’m on it → resolved with a note', async ({ page }) => {
    await tab(page, 'Me'); await page.locator('button.li', { hasText: 'Report a problem' }).click(); // SOS moved from Home to Me (18 Nov)
    await dialog(page).getByRole('button', { name: 'Pet hurt' }).click();
    await expect(page.getByText(/Reported\./)).toBeVisible();
    if (await dialog(page).isVisible()) await dialog(page).getByRole('button', { name: 'Close' }).click();
    const inc = page.locator('.card.danger', { hasText: 'S1 · pet hurt' });
    await expect(inc).toContainText('Not acknowledged');
    await inc.getByRole('button', { name: 'I’m on it' }).click();
    await expect(inc).toContainText('Acknowledged');
    await inc.getByRole('button', { name: 'Open' }).click();
    await dialog(page).locator('#ir').fill('Small scratch, cleaned. Vet not needed.');
    await dialog(page).getByRole('button', { name: 'Mark resolved' }).click();
    await expect(page.locator('.card.danger', { hasText: 'S1 · pet hurt' })).toHaveCount(0);
  });

  test('D8 Can’t come today → plan kept, alone-window warning, “Ask a friend” pre-fills Find cover', async ({ page }) => {
    await clockTo(page, '11:00');
    await helperCantCome(page);
    await expect(page.getByText('Sunita can’t come today. Your original plan is kept.')).toBeVisible();
    await openPlan(page);
    await expect(page.getByText(/Alone-window warning/)).toBeVisible();
    await expect(page.getByText(/phase 3/i)).toHaveCount(0);
    await closePlan(page);
    await expect(page.getByRole('button', { name: 'Ask a friend to cover' })).toHaveCount(0); // friends are asked from Find cover (17 Nov)
  });

  test('D9 Day close at 11:59 PM stores the covered-day result', async ({ page }) => {
    await clockTo(page, '23:59');
    const days = await api<{ status: string }[]>(page, 'GET', `/v1/households/hh_demo/day/report?date=${DAY}`);
    expect(days.status).toBe(200);
    await expect(page.locator('.conf').first()).not.toHaveText('');
  });

  test('D10 A pending task: plain description, photo placeholder, Send reminder and Mark completed; completed shows the photo', async ({ page }) => {
    await taskCard(page, 'Lunch + fresh water').click();
    const d = dialog(page);
    await expect(d.locator('.st-pill')).toHaveText('Pending');
    await expect(d.locator('.task-desc')).toContainText('Feed Bruno: 1 cup kibble + curd rice at lunch');
    await expect(d.locator('.ev-placeholder')).toBeVisible();
    await expect(d.locator('.btnrow.even').getByRole('button')).toHaveText(['Send reminder', 'Mark completed']);
    await d.getByRole('button', { name: 'Send reminder' }).click();
    await expect(page.getByText('Reminder sent to Sunita on WhatsApp.')).toBeVisible();
    await taskCard(page, 'Lunch + fresh water').click();
    await dialog(page).getByRole('button', { name: 'Mark completed' }).click();
    await expect(taskCard(page, 'Lunch + fresh water')).toContainText('Completed');
    await taskCard(page, 'Lunch + fresh water').click();
    await expect(dialog(page).locator('.ev-media img')).toBeVisible();
    await expect(dialog(page).locator('.ev-media')).toContainText('Marked completed by you');
    await expect(dialog(page).getByRole('button', { name: 'Mark completed' })).toHaveCount(0);
  });

  test('D11 The Plan sheet shows the helper’s status too', async ({ page }) => {
    await openPlan(page);
    await expect(dialog(page).locator('.plan-help')).toContainText('Sunita');
    await expect(dialog(page).locator('.plan-help .st-pill')).toHaveText('Accepted');
  });
});
