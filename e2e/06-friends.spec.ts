import { test, expect } from '@playwright/test';
import { boot, signIn, signInOwner, signOut, tab, meItem, PHONE, api, findCoverForm } from './helpers';

test.describe('H. Friends (owner side)', () => {
  test.beforeEach(async ({ page }) => { await boot(page); await signInOwner(page); await tab(page, 'Friends'); });

  test('H1 Friends list shows who is findable; inviting a friend sends an invite (not opt-in)', async ({ page }) => {
    await expect(page.locator('button.li', { hasText: 'Priya Shah' })).toBeVisible();
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    await page.locator('#fn').fill('Nikhil');
    await page.locator('#fp').fill('9811555666');
    await page.getByRole('button', { name: 'Send WhatsApp invite' }).click();
    await expect(page.getByText('Invitation sent on WhatsApp (simulated).')).toBeVisible();
    await expect(page.locator('button.li', { hasText: 'Nikhil' })).toContainText('Not searchable until they opt in');
  });

  test('H2 Friend profile → “Ask for help” opens Find cover with a draft for that friend', async ({ page }) => {
    await page.locator('button.li', { hasText: 'Priya Shah' }).click();
    await expect(page.getByText('Comfortable with (their own choice)')).toBeVisible();
    await page.getByRole('button', { name: 'Ask for help' }).click();
    await expect(page.locator('#ask')).toHaveValue(/Can Priya feed Bruno/);
  });

  test('H3 Block a friend → removed from future searches', async ({ page }) => {
    await page.locator('button.li', { hasText: 'Kavya Iyer' }).click();
    await page.getByRole('button', { name: 'Block' }).click();
    await page.locator('.card.warn').getByRole('button', { name: 'Block' }).click();
    const s = await api<{ id: string }>(page, 'POST', '/v1/households/hh_demo/requests', { text: 'Can someone feed Bruno at 5 pm?' });
    const r = await api<{ top: { id: string }[] }>(page, 'POST', `/v1/households/hh_demo/requests/${s.body.id}/search`, {});
    expect(r.body.top.map(t => t.id)).not.toContain('u_kavya');
  });

  test('H4 Report a friend → blocked and sent for review', async ({ page }) => {
    await page.locator('button.li', { hasText: 'Arjun Mehta' }).click();
    await page.getByRole('button', { name: 'Report' }).click();
    await page.locator('#rr').selectOption('Unsafe behaviour');
    await page.locator('.card.warn').getByRole('button', { name: 'Report' }).click();
    await expect(page.getByText('Report sent and friend blocked. An ops case was created.')).toBeVisible();
  });

  test('H5 Privacy: what friends see; location sharing can widen to society + tower; nearby members locked off', async ({ page }) => {
    await meItem(page, 'Profile and what friends see');
    await expect(page.getByText('Hidden until you confirm someone')).toBeVisible();
    await page.getByRole('button', { name: 'Society + tower' }).click();
    await expect(page.getByRole('button', { name: 'Society + tower' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('switch')).toBeDisabled();
  });
});

test.describe('I. The friend’s own app', () => {
  test('I1 Priya signs in → friend view; pausing and turning off “findable” take effect at once', async ({ page }) => {
    await boot(page);
    await signIn(page, PHONE.priya);
    await expect(page.getByRole('heading', { name: 'Requests for you' })).toBeVisible();
    await page.getByRole('button', { name: 'My settings (F7)' }).click();
    await page.getByRole('switch', { name: /Pause all requests/ }).click();
    await expect(page.getByText('Paused. No new requests until you turn this off.')).toBeVisible();
    await page.getByRole('switch', { name: /Friends can find me/ }).click();
    await expect(page.getByText('You’re no longer findable. Removed from search immediately.')).toBeVisible();
  });

  test('I2 Owner asks Priya → Priya says Yes in her app → owner confirms → Priya sees address and key → arrives → done → completed', async ({ page }) => {
    await boot(page);
    await signInOwner(page);
    const r = await api<{ id: string }>(page, 'POST', '/v1/households/hh_demo/requests', { text: 'I am stuck in a meeting until 8. Can someone feed Bruno and take him down at 5?' });
    await api(page, 'POST', `/v1/households/hh_demo/requests/${r.body.id}/search`, {});
    await api(page, 'POST', `/v1/households/hh_demo/requests/${r.body.id}/approve`, { friendIds: ['u_priya'], mode: 'one', approved: true });
    await signOut(page);

    await signIn(page, PHONE.priya);
    const card = page.locator('.card', { hasText: 'feed Bruno' });
    await expect(card).toContainText('waiting for your reply');
    await card.getByRole('button', { name: 'Yes' }).click();
    await signOut(page);

    await signInOwner(page);
    await findCoverForm(page);
    await page.locator('button.li').first().click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.locator('.conf', { hasText: 'Confirmed' }).first()).toBeVisible();
    await signOut(page);

    await signIn(page, PHONE.priya);
    await page.getByRole('button', { name: 'Show address, key and emergency card' }).click();
    await expect(page.getByText(/Flat B-1104, Tower B/)).toBeVisible();
    await page.getByRole('button', { name: 'I’ve arrived' }).click();
    await expect(page.getByText('The owner has been told you arrived.')).toBeVisible();
    // Proof (16 Nov): a photo from the gallery and today's code from the food-box card.
    await page.getByRole('button', { name: 'Done: send proof' }).click();
    await page.getByLabel('Choose a photo from the gallery').setInputFiles('apps/web/public/assets/mascot-family.png');
    await expect(page.getByRole('img', { name: 'Your proof photo' })).toBeVisible();
    const code = (await page.locator('.hint b.mono').innerText()).trim();
    await page.locator('#pcode').fill(code);
    await page.getByRole('dialog').getByRole('button', { name: 'Send proof', exact: true }).click();
    await expect(page.getByText('Thank you! Photo and today’s code received.')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await signOut(page);

    await signInOwner(page);
    await findCoverForm(page);
    await expect(page.locator('button.li').first()).toContainText('Completed');
  });
});
