import { test, expect } from '@playwright/test';
import { boot, signIn, signUp, signInOwner, signOut, intake, PHONE, headOut, tab } from './helpers';

test.describe('A. Sign-in and onboarding', () => {
  test('A1 New owner signs up: phone, code, consents, profile, then lands on Today', async ({ page }) => {
    await boot(page);
    await signUp(page, '9811222333');
    await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible();
    await page.getByText('I accept the Terms of Use').click();
    await page.getByText('I have read the Privacy Notice').click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await intake(page, 'Asha Rao', 'Raheja Vihar, Powai', { tower: 'C' });
    await expect(page.getByRole('heading', { name: /Asha/ })).toBeVisible();
  });

  test('A2 Consent is required: continuing without Terms and Privacy shows an error', async ({ page }) => {
    await boot(page);
    await signUp(page, '9811222334');
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
    await expect(page.locator('.help-card')).toBeVisible(); // Home before heading out: your help today + Heading out?
  await headOut(page);
  await expect(page.locator('.petchip', { hasText: 'Bruno' })).toBeVisible();
    await expect(page.locator('.petchip', { hasText: 'Misty' })).toBeVisible();
  });

  test('A6 Signing out shows the welcome screens again, then Log in', async ({ page }) => {
    await boot(page);
    await signInOwner(page);
    await tab(page, 'Me'); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'When help can’t come, ask friends.' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('pawsure.introSeen'))).toBeNull(); // shown again until Get started / Log in
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });
});

test('A7 Co-owner Rohan signs in and sees the same household', async ({ page }) => {
  await boot(page);
  await signIn(page, PHONE.rohan);
  await expect(page.getByRole('heading', { name: /Rohan/ })).toBeVisible();
  await expect(page.locator('.help-card')).toBeVisible(); // Home before heading out: your help today + Heading out?
  await headOut(page);
  await expect(page.locator('.petchip', { hasText: 'Bruno' })).toBeVisible();
});

test.describe('A+. Separate Log in and Sign up (15 Nov)', () => {
  test('A10 Log in (returning owner): number and code only, straight to the home with her pets and today’s activity', async ({ page }) => {
    await boot(page);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await signIn(page, PHONE.neha);
    await expect(page.getByRole('heading', { name: /Neha/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Before you start' })).toHaveCount(0);
    await expect(page.locator('.help-card')).toBeVisible(); // Home before heading out: your help today + Heading out?
  await headOut(page);
  await expect(page.locator('.petchip', { hasText: 'Bruno' })).toBeVisible();
    await expect(page.locator('.petchip', { hasText: 'Misty' })).toBeVisible();
    await expect(page.locator('button.task').first()).toBeVisible();
  });

  test('A11 Log in with a new number goes straight into the full sign-up journey', async ({ page }) => {
    await boot(page);
    await signIn(page, '9811222335');
    await expect(page.getByText('There’s no account for this number yet, so let’s set one up.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible();
  });

  test('A13 The product owner’s number (88607 50239) logs straight into the demo home: pets and today’s tasks, no onboarding', async ({ page }) => {
    await boot(page);
    await signIn(page, '8860750239');
    await expect(page.getByRole('heading', { name: /Owner/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Before you start' })).toHaveCount(0);
    await expect(page.locator('.help-card')).toBeVisible(); // Home before heading out: your help today + Heading out?
  await headOut(page);
  await expect(page.locator('.petchip', { hasText: 'Bruno' })).toBeVisible();
    await expect(page.locator('button.task').first()).toBeVisible();
  });

  test('A12 Sign up with a number that already has an account goes straight to that home', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await signIn(page, PHONE.neha);
    await expect(page.getByRole('heading', { name: /Neha/ })).toBeVisible();
  });
});

test.describe('A++. Welcome screens before Log in (15 Nov)', () => {
  test('A14 First visit: three welcome screens; Next moves on; Get started opens Sign up; they are not shown again', async ({ page }) => {
    await boot(page, '', { intro: true });
    await expect(page.getByRole('heading', { name: 'When help can’t come, ask friends.' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Know who’s caring, every day.' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Your helper checks in on WhatsApp.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Get started' }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await page.reload(); await page.waitForSelector('html[data-demo-ready]', { state: 'attached' });
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('A15 Welcome screens: “Already have an account? Log in” opens Log in', async ({ page }) => {
    await boot(page, '', { intro: true });
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });
});
