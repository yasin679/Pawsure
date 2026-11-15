import { test, expect } from '@playwright/test';
import { boot, signIn, signInOwner, signOut, intake, PHONE } from './helpers';

test.describe('A. Sign-in and onboarding', () => {
  test('A1 New owner signs up: phone, code, consents, profile, then lands on Today', async ({ page }) => {
    await boot(page);
    await signIn(page, '9811222333');
    await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible();
    await page.getByText('I accept the Terms of Use').click();
    await page.getByText('I have read the Privacy Notice').click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await intake(page, 'Asha Rao', 'Raheja Vihar, Powai', { tower: 'C' });
    await page.getByRole('button', { name: 'Yes, I have someone' }).click(); // v1.4 PS-140 circle question
    await expect(page.getByRole('heading', { name: /Asha/ })).toBeVisible();
  });

  test('A2 Consent is required: continuing without Terms and Privacy shows an error', async ({ page }) => {
    await boot(page);
    await signIn(page, '9811222334');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toContainText('Please accept the Terms and the Privacy Notice');
  });

  test('A3 A wrong code is refused with a clear message', async ({ page }) => {
    await boot(page);
    await page.locator('#ph').fill(PHONE.neha);
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.locator('#otp').fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert')).toContainText('doesn’t match');
  });

  test('A4 An invalid phone number is refused', async ({ page }) => {
    await boot(page);
    await page.locator('#ph').fill('12345');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('alert')).toContainText('10-digit');
  });

  test('A5 Existing owner signs in and sees both pets on Today', async ({ page }) => {
    await boot(page);
    await signInOwner(page);
    await expect(page.locator('.petchip', { hasText: 'Bruno' })).toBeVisible();
    await expect(page.locator('.petchip', { hasText: 'Misty' })).toBeVisible();
  });

  test('A6 Sign out returns to Log in or create an account', async ({ page }) => {
    await boot(page);
    await signInOwner(page);
    await signOut(page);
    await expect(page.getByRole('heading', { name: 'Log in or create an account' })).toBeVisible();
  });
});

test('A7 Co-owner Rohan signs in and sees the same household', async ({ page }) => {
  await boot(page);
  await signIn(page, PHONE.rohan);
  await expect(page.getByRole('heading', { name: /Rohan/ })).toBeVisible();
  await expect(page.locator('.petchip', { hasText: 'Bruno' })).toBeVisible();
});
