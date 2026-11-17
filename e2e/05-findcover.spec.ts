import { test, expect, type Page } from '@playwright/test';
import { boot, signInOwner, tab, clockTo, taskCard, dialog, api, openPlan, closePlan, findCoverForm } from './helpers';

const friendsPhone = (page: Page) => page.locator('.sheet', { hasText: 'Friends’ phones (simulated)' });
async function friendReply(page: Page, name: string, button?: string, text?: string) {
  await page.getByRole('button', { name: 'Show friends’ phones' }).click();
  await friendsPhone(page).locator('.seg').getByRole('button', { name, exact: true }).click();
  if (button) await friendsPhone(page).locator('.qr').getByRole('button', { name: button, exact: true }).last().click();
  if (text) { await friendsPhone(page).getByLabel('Reply text').fill(text); await friendsPhone(page).getByRole('button', { name: 'Send' }).click(); }
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Hide friends’ phones' }).click();
}
async function ask(page: Page, text: string) {
  await findCoverForm(page);
  await page.locator('#ask').fill(text);
  await page.getByRole('button', { name: 'Understand my request' }).click();
  await expect(page.getByRole('heading', { name: 'Check the details' })).toBeVisible();
}
async function sendTo(page: Page, first: string) {
  await page.getByRole('button', { name: 'Search my friends' }).click();
  await page.getByRole('button', { name: `Ask ${first}` }).click();
  await page.getByText(/I approve sending/).click();
  await page.getByRole('button', { name: 'Send on WhatsApp' }).click();
  await expect(page.locator('.conf', { hasText: 'Sent' }).first()).toBeVisible();
}
const CLEAR = 'I am stuck in a meeting until 8. Can someone feed Bruno and take him down at 5?';

test.describe('G. Find cover (AI Friend Finder)', () => {
  test.beforeEach(async ({ page }) => { await boot(page); await signInOwner(page); });

  test('G1 Helper can’t come → ask Meera → she says Yes (Marathi) → owner confirms → only Bruno’s lunch moves to her', async ({ page }) => {
    await clockTo(page, '11:00');
    await page.getByRole('button', { name: 'My help can’t come' }).click();
    await dialog(page).getByRole('button', { name: 'Mark unavailable' }).click();
    await findCoverForm(page);
    await page.locator('#ask').fill('Sunita can’t come today. Can someone feed Bruno at 1:00 pm?');
    await page.getByRole('button', { name: 'Understand my request' }).click();
    await page.getByRole('button', { name: 'Search my friends' }).click();
    await expect(page.locator('.card', { hasText: '1. Meera Joshi' })).toBeVisible();
    await page.getByRole('button', { name: 'Ask Meera' }).click();
    await expect(page.locator('.bub')).toContainText('ब्रुनो'); // message in Meera’s language
    await expect(page.getByText('Address and key details are shared only after you confirm.')).toBeVisible();
    await page.getByText(/I approve sending/).click();
    await page.getByRole('button', { name: 'Send on WhatsApp' }).click();
    await friendReply(page, 'Meera', 'हो');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText(/Shared with Meera, minimum needed, this visit only/i)).toBeVisible();
    await tab(page, 'Today');
    await expect(page.getByRole('heading', { name: 'A friend (Find cover)' })).toBeVisible();
    await closePlan(page);
    await expect(taskCard(page, 'Feed (friend cover)')).toBeVisible();
    await expect(taskCard(page, 'Lunch + fresh water')).toContainText('Reassigned');
    await expect(taskCard(page, 'Joint supplement')).not.toContainText('Reassigned');
    await page.getByRole('tab', { name: /Misty/ }).click(); // Home shows one pet's tasks at a time
    await expect(taskCard(page, 'Wet food + litter tray')).not.toContainText('Reassigned');
  });

  test('G2 Clear request is understood with no questions; suggestions are friends-first, nearest-first', async ({ page }) => {
    await ask(page, CLEAR);
    await expect(page.locator('.card.warn[role=alert]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Search my friends' }).click();
    const names = await page.locator('.card b').filter({ hasText: /^\d\. / }).allInnerTexts();
    expect(names).toEqual(['1. Priya Shah', '2. Arjun Mehta', '3. Kavya Iyer']);
    await page.getByText(/friends not shown/).click();
    await expect(page.getByText('Has not opted in to be found')).toBeVisible();
  });

  test('G3 Ask all 3: first Yes is held, second Yes waits, owner confirms → others closed politely', async ({ page }) => {
    await ask(page, CLEAR);
    await page.getByRole('button', { name: 'Search my friends' }).click();
    await page.getByRole('button', { name: 'Ask all 3' }).click();
    await page.getByText(/I approve sending these 3 messages/).click();
    await page.getByRole('button', { name: 'Send on WhatsApp' }).click();
    await friendReply(page, 'Priya', 'Yes');
    await friendReply(page, 'Arjun', 'हाँ');
    await expect(page.locator('.conf', { hasText: 'Provisional hold' })).toBeVisible();
    await expect(page.locator('.li', { hasText: 'Arjun' })).toContainText('waiting');
    await page.locator('.li', { hasText: 'Priya' }).getByRole('button', { name: 'Confirm' }).click();
    await expect(page.locator('.conf', { hasText: 'Confirmed' }).first()).toBeVisible();
    await expect(page.locator('.li', { hasText: 'Arjun' })).toContainText('Closed politely');
  });

  test('G4 Medicine + vague time: questions block the search until answered', async ({ page }) => {
    await ask(page, 'Can someone give Bruno his medicine this evening and let themselves in?');
    const q = page.locator('.card.warn[role=alert]');
    await expect(q.first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search my friends' })).toBeDisabled();
    while (await q.count()) { await q.first().getByRole('button').first().click(); await page.waitForTimeout(300); }
    await expect(page.getByRole('button', { name: 'Search my friends' })).toBeEnabled();
    await expect(page.getByText(/Medicine goes only to friends who chose it/)).toBeVisible();
  });

  test('G5 AI unavailable → simple form; matching still works', async ({ page }) => {
    await api(page, 'POST', '/demo/llm', { mode: 'down' });
    await findCoverForm(page);
    await page.locator('#ask').fill(CLEAR);
    await page.getByRole('button', { name: 'Understand my request' }).click();
    await expect(page.locator('main').getByText(/AI unavailable/)).toBeVisible();
    await page.getByText('Feed', { exact: true }).click();
    await page.locator('#mt').selectOption({ label: '5:00 PM' });
    await page.getByRole('button', { name: 'Search my friends' }).click();
    await expect(page.getByRole('button', { name: 'Ask Priya' })).toBeVisible();
  });

  test('G6 AI times out (8 s) → simple form', async ({ page }) => {
    await api(page, 'POST', '/demo/llm', { mode: 'timeout' });
    await findCoverForm(page);
    await page.locator('#ask').fill(CLEAR);
    await page.getByRole('button', { name: 'Understand my request' }).click();
    await expect(page.getByText(/AI timed out after 8 s/)).toBeVisible({ timeout: 20_000 });
  });

  test('G7 No friend free (10:30 PM) → honest empty result; nearby members stay switched off', async ({ page }) => {
    await ask(page, 'Can someone feed Bruno at 10:30 pm?');
    await page.getByRole('button', { name: 'Search my friends' }).click();
    await expect(page.getByRole('heading', { name: 'No friend is free right now' })).toBeVisible();
    await expect(page.locator('.card', { hasText: 'Nearby ID-checked members' })).toContainText('Switch OFF');
  });

  test('G8 Friend suggests another time → owner confirms the new time', async ({ page }) => {
    await ask(page, CLEAR);
    await sendTo(page, 'Priya');
    await friendReply(page, 'Priya', undefined, '5:30');
    const btn = page.getByRole('button', { name: /^Confirm 5:30/ });
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator('.conf', { hasText: 'Confirmed' }).first()).toBeVisible();
    await expect(page.locator('.card').first()).toContainText('5:30 PM');
  });

  test('G9 Friend declines → nobody accepted, “Try again” offered', async ({ page }) => {
    await ask(page, CLEAR);
    await sendTo(page, 'Priya');
    await friendReply(page, 'Priya', 'No');
    await expect(page.getByText('Nobody accepted.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('G10 Request screen says it was understood by rules (no AI connected); owner cancels the request', async ({ page }) => {
    await ask(page, CLEAR);
    await sendTo(page, 'Priya');
    await expect(page.getByText('understood by rules (no AI connected)')).toBeVisible(); // never claims AI that isn’t connected
    await expect(page.getByText(/parsed by AI/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel request' }).click();
    await expect(page.locator('.conf', { hasText: /Cancelled/ }).first()).toBeVisible();
  });

  test('G11 Duplicate WhatsApp “Yes” is ignored (idempotent)', async ({ page }) => {
    await ask(page, CLEAR);
    await sendTo(page, 'Priya');
    await page.getByRole('button', { name: 'Show friends’ phones' }).click();
    await friendsPhone(page).locator('.qr').getByRole('button', { name: 'Yes', exact: true }).last().click();
    await page.waitForTimeout(500);
    await friendsPhone(page).getByRole('button', { name: /Send the last reply again/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Hide friends’ phones' }).click();
    const req = await api<{ id: string; history: { state: string }[] }[]>(page, 'GET', '/v1/households/hh_demo/requests');
    expect(req.body[0]!.history.filter(h => /Accepted/.test(h.state)).length).toBe(1);
  });
});

test.describe('G+. Pawly, the cover assistant (16 Nov)', () => {
  test('G9a Find cover opens on “How can I help?”; any request shows the thinking animation, then friends who can help; Ask opens a small form in the chat', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await tab(page, 'Find cover');
    await expect(page.getByRole('heading', { name: 'How can I help?' })).toBeVisible();
    await page.locator('#ai-in').fill('blah blah anything at all');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Pawly is thinking' })).toBeVisible();
    await expect(page.locator('.friend-card').first()).toBeVisible();
    await expect(page.getByRole('status', { name: 'Pawly is thinking' })).toHaveCount(0);
    expect(await page.locator('.friend-card').count()).toBeGreaterThan(0);
    await expect(page.locator('.friend-card img').first()).toHaveAttribute('src', /assets\/people\//);
    await page.locator('.friend-card').first().getByRole('button', { name: /^Ask / }).click();
    // Asking stays in the chat: a small progressive form, never the old filter screen
    await expect(page.getByRole('group', { name: /^Ask / })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Check the details' })).toHaveCount(0);
    await expect(page.locator('#ask')).toHaveCount(0);
  });

  test('G9b Ask the second friend in the chat: form (what, pet, time, access) → message preview → Send → their Yes → Confirm, all in the chat', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await tab(page, 'Find cover');
    await page.getByRole('button', { name: /Walk Bruno at|Walk Bruno this evening/ }).click();
    const second = page.locator('.friend-card').nth(1);
    await expect(second).toBeVisible();
    const first = (await second.locator('b').innerText()).split(' ')[0]!;
    await second.getByRole('button', { name: /^Ask / }).click();
    const form = page.getByRole('group', { name: `Ask ${first}` });
    await expect(form.getByRole('button', { name: '✓ Short walk' })).toBeVisible(); // guessed from “Walk Bruno this evening”
    await form.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(form.getByRole('button', { name: '✓ Bruno' })).toBeVisible();
    await form.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(form.locator('#when')).toContainText('6:00 PM'); // “evening”
    await form.getByRole('button', { name: 'Next', exact: true }).click();
    await form.getByRole('button', { name: 'Key handover', exact: true }).click();
    await expect(page.getByText(`Here’s the WhatsApp message for ${first}.`)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.wa-bub')).toBeVisible();
    await page.getByRole('button', { name: 'Send on WhatsApp' }).click();
    await expect(page.getByRole('status', { name: `Sent to ${first} on WhatsApp.` })).toBeVisible();
    // the friend says Yes on their (simulated) phone, in their own language
    await page.getByRole('button', { name: 'Show friends’ phones' }).click();
    await friendsPhone(page).locator('.seg').getByRole('button', { name: first, exact: true }).click();
    await friendsPhone(page).locator('.qr').getByRole('button', { name: /^(Yes|हाँ|हो)$/ }).last().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Hide friends’ phones' }).click();
    await expect(page.getByRole('status', { name: `${first} said yes!` })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: `Confirm ${first}` }).click();
    await expect(page.getByRole('status', { name: `Confirmed. ${first} is covering this.` })).toBeVisible();
    await expect(page.getByText('forbidden')).toHaveCount(0);
  });
});

