import { test, expect } from '@playwright/test';
import { boot, signIn, signInOwner, signOut, tab, PHONE } from './helpers';

/** Issues reported on 11 Nov 2026, reproduced the way a user meets them (real waiting, no demo-clock jumps). */
test.describe('N. Reported issues (regression)', () => {
  test('N1 After waiting 30 seconds, “Resend code” sends a new code', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await page.getByRole('button', { name: 'Get started' }).click();
    await page.locator('#ph').fill(PHONE.neha);
    await page.getByRole('button', { name: 'Send code' }).click();
    const first = (await page.locator('b.mono').first().innerText()).trim();
    await page.waitForTimeout(31_000);
    await page.getByRole('button', { name: 'Resend code' }).click();
    await expect(page.locator('b.mono').first()).not.toHaveText(first);
    await expect(page.getByText(/Please wait 30 seconds/)).toHaveCount(0);
  });

  test('N2 Owner → Ops console (staff sign-in) → back: the owner app and every tab still work', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await page.getByRole('button', { name: 'Ops console' }).click();
    await page.locator('#sp').fill(PHONE.lead); await page.getByRole('button', { name: 'Send code' }).click();
    await page.locator('#sc').fill((await page.locator('span.mono').first().innerText()).trim());
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.console-nav')).toBeVisible();
    await page.getByRole('button', { name: 'Back to the owner app' }).click();
    await expect(page.getByRole('heading', { name: /Neha/ })).toBeVisible();
    for (const [t, h] of [['Find cover', 'Find cover'], ['Friends', 'Friends'], ['Pet', 'Pet'], ['Me', 'Me'], ['Today', 'Today']]) {
      await tab(page, t);
      await expect(page.getByRole('heading', { name: h, exact: true }).first()).toBeVisible();
    }
    // and the console still remembers the staff sign-in
    await page.getByRole('button', { name: 'Ops console' }).click();
    await expect(page.locator('.console-nav')).toBeVisible();
  });

  test('N3 Sign out, then sign straight back in with the same number', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await signOut(page);
    await signInOwner(page);
    await signOut(page);
    await signInOwner(page);
    await expect(page.locator('.petchip', { hasText: 'Bruno' })).toBeVisible();
  });

  test('N4 A new user who reloads part-way through setup continues setup (no blank screen)', async ({ page }) => {
    await boot(page);
    await signIn(page, '9811777888');
    await expect(page.getByRole('heading', { name: 'Terms and privacy' })).toBeVisible();
    // simulate the app restarting with the session kept but no household yet
    await page.evaluate(() => { location.hash = 'admin'; });
    await page.getByRole('heading', { name: 'Staff sign-in' }).waitFor();
    await page.evaluate(() => { location.hash = ''; });
    await expect(page.getByRole('heading', { name: 'Terms and privacy' })).toBeVisible();
    await page.getByText('I accept the Terms of Use').click(); await page.getByText('I have read the Privacy Notice').click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('#nm').fill('Kiran'); await page.locator('#sc').fill('Hiranandani, Powai');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: /Kiran/ })).toBeVisible();
  });
});
