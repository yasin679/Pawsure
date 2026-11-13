import { test, expect } from '@playwright/test';
import { boot, signInOwner, tab, fillPetEssentials } from './helpers';

test.describe('B. Pets and C. routine and health', () => {
  test.beforeEach(async ({ page }) => { await boot(page); await signInOwner(page); await tab(page, 'Pet'); });

  test('B1 Add a pet: essential care and medical details are required, then it is saved', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add' }).click();
    await page.locator('#f-name').fill('Coco');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toContainText('Please fill in: Food and feeding, Allergies, Medicine instructions, Your vet, Vet phone');
    await fillPetEssentials(page);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.seg').getByRole('button', { name: 'Coco' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Coco' })).toBeVisible();
  });

  test('B2 Edit a pet: allergies are saved and shown', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.locator('#f-allergies').fill('Chicken');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('dl.kv')).toContainText('Chicken');
  });

  test('B3 Emergency card shows vet, 24x7 clinic and the not-an-emergency-service notice', async ({ page }) => {
    await page.locator('button.li', { hasText: 'Emergency card' }).click();
    await expect(page.getByText('Own vet: Dr. Aarti Deshmukh')).toBeVisible();
    await expect(page.getByText(/24x7 clinic:/)).toBeVisible();
    await expect(page.getByText('Pawsure is not a veterinary or emergency service')).toBeVisible();
  });

  test('C1 Add a routine task: it takes effect from tomorrow and is listed', async ({ page }) => {
    await page.locator('button.li', { hasText: 'Routine' }).click();
    await page.getByRole('button', { name: 'Add' }).click();
    await page.locator('#rtt').fill('Evening walk');
    await page.locator('#rty').selectOption('walk');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Takes effect from 2026-11-07/)).toBeVisible();
    await expect(page.locator('button.li', { hasText: '6:00 PM' }).filter({ hasText: 'Evening walk' })).toBeVisible(); // the demo also has Neha’s own 7:30 PM walk
  });

  test('C2 Health calendar: add a vaccine date, then mark it done', async ({ page }) => {
    await page.locator('button.li', { hasText: 'Health calendar' }).click();
    await page.getByRole('button', { name: 'Add' }).click();
    await page.locator('#hl').fill('Kennel cough');
    await page.locator('#hn').fill('2026-11-20');
    await page.getByRole('button', { name: 'Save' }).click();
    const card = page.locator('.card', { hasText: 'Kennel cough' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Done' }).click();
    await expect(card.locator('.tag')).toHaveText('Done');
  });

  test('C3 Health calendar: snooze an overdue reminder', async ({ page }) => {
    await page.locator('button.li', { hasText: 'Health calendar' }).click();
    const card = page.locator('.card', { hasText: 'Rabies vaccine' });
    await expect(card.locator('.tag')).toHaveText('Overdue');
    await card.getByRole('button', { name: 'Snooze 1 day' }).click();
    await expect(card.locator('.tag')).toHaveText('Snoozed');
  });

  test('C4 From Today, Edit routine → Add “Just for today”: it joins today’s plan and doesn’t repeat', async ({ page }) => {
    await tab(page, 'Today');
    await page.getByRole('button', { name: 'Edit routine' }).click();
    await expect(page.getByRole('heading', { name: 'Routine' })).toBeVisible();
    await page.getByRole('button', { name: 'Add' }).click();
    await page.locator('#rtt').fill('Extra play time');
    await page.locator('#rty').selectOption('walk');
    await page.getByLabel('Just for today').check();
    await expect(page.getByText('Added to today’s plan now. It won’t repeat.')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Added to today’s plan: Extra play time at 6:00 PM/)).toBeVisible();
    await expect(page.locator('button.li', { hasText: 'Extra play time' })).toContainText('today only');
    await page.locator('.appbar', { hasText: 'Routine' }).getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('button', { name: /6:00 Extra play time/ })).toBeVisible();
  });
});
