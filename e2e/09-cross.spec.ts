import { test, expect } from '@playwright/test';
import { boot, signInOwner, tab, noHorizontalScroll, dialog } from './helpers';

test.describe('L. Cross-cutting', () => {
  test('L1 Phone width (390 px): no sideways scrolling on any main tab', async ({ page }) => {
    await boot(page); await signInOwner(page);
    for (const t of ['Today', 'Find cover', 'Friends', 'Pet', 'Me']) { await tab(page, t); await noHorizontalScroll(page); }
  });

  test('L2 Offline banner appears when the connection drops', async ({ page, context }) => {
    await boot(page); await signInOwner(page);
    await context.setOffline(true);
    await expect(page.getByText(/You’re offline/)).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText(/You’re offline/)).toHaveCount(0);
  });

  test('L3 Reloading the demo starts fresh (each visitor gets their own copy)', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await page.getByRole('button', { name: 'My help can’t come today' }).click();
    await dialog(page).getByRole('button', { name: 'Mark unavailable' }).click();
    await expect(page.getByText('Sunita can’t come today.')).toBeVisible();
    await page.reload();
    await page.waitForSelector('html[data-demo-ready]', { state: 'attached' });
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await signInOwner(page);
    await expect(page.getByRole('heading', { name: 'Sunita (tracked helper)' })).toBeVisible();
  });

  test('L4 Old “coming in phase 3” placeholders are gone everywhere', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await page.locator('.card', { hasText: 'Who’s caring today?' }).getByRole('button', { name: 'Change' }).click();
    await expect(dialog(page)).toContainText('Ask your own friends. Nothing is sent until you approve');
    await expect(page.getByText(/arrives in phase|phase [0-9]/i)).toHaveCount(0);
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    for (const t of ['Find cover', 'Friends', 'Pet', 'Me']) { await tab(page, t); await expect(page.getByText(/arrives in phase|phase [0-9]/i)).toHaveCount(0); }
  });

  test('L5 Choosing “A friend” under Who’s caring opens Find cover', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await page.locator('.card', { hasText: 'Who’s caring today?' }).getByRole('button', { name: 'Change' }).click();
    await dialog(page).getByRole('button', { name: /A friend/ }).click();
    await expect(page.getByRole('heading', { name: 'Find cover' })).toBeVisible();
  });

  test('L6 No console errors while using the main screens', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|401|403|409/.test(m.text())) errors.push(m.text()); });
    await boot(page); await signInOwner(page);
    for (const t of ['Today', 'Find cover', 'Friends', 'Pet', 'Me']) { await tab(page, t); await page.waitForTimeout(400); }
    expect(errors).toEqual([]);
  });
});
