import { test, expect } from '@playwright/test';
import { boot, signInOwner, meItem, tab } from './helpers';

test.describe('J. Wallet, data rights and consents (owner)', () => {
  test.beforeEach(async ({ page }) => { await boot(page); await signInOwner(page); });

  test('J1 Wallet shows the helper’s points from this home only, against the 125 cap', async ({ page }) => {
    await meItem(page, 'Wallet and points');
    await expect(page.locator('.card', { hasText: 'Sunita' })).toContainText('60/125');
    await expect(page.getByText('Points from other homes they work in are never shown to you.')).toBeVisible();
    await expect(page.getByText(/500 points = ₹20 coupon · no cash/)).toBeVisible();
  });

  test('J2 “Show my data” lists what Pawsure holds about the owner', async ({ page }) => {
    await meItem(page, 'Your data rights');
    await page.getByRole('button', { name: 'Show my data' }).click();
    await expect(page.locator('pre')).toContainText('Neha Kulkarni');
    await expect(page.locator('pre')).toContainText('consents');
  });

  test('J3 Make a correction request → listed as Received with a reply-by date', async ({ page }) => {
    await meItem(page, 'Your data rights');
    await page.locator('button.li', { hasText: 'Correct something' }).click();
    await page.locator('#rd').fill('Bruno is 5 years old, not 4');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText(/Request DR-\w+ received/)).toBeVisible();
    await expect(page.locator('.li.small', { hasText: 'Correct something' })).toContainText('Received');
  });

  test('J4 Consents are listed with their versions', async ({ page }) => {
    await tab(page, 'Me');
    const c = page.locator('.card', { hasText: 'Consents' });
    await expect(c).toContainText('terms');
    await expect(c).toContainText('T-1.0');
  });
});
