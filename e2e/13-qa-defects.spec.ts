import { test, expect, type Page } from '@playwright/test';
import { boot, signInOwner, tab, api } from './helpers';

/** QA defect tracker (Pawsure_QA_Defect_Tracker.xlsx): the on-screen half of PAW-001 to PAW-016. API checks: apps/api/test/qa-defects.test.ts. */
async function ask(page: Page, text: string) {
  await tab(page, 'Find cover');
  await page.locator('#ask').fill(text);
  await page.getByRole('button', { name: 'Understand my request' }).click();
  await expect(page.getByRole('heading', { name: 'Check the details' })).toBeVisible();
}
const openFromList = async (page: Page, state: string) => {
  await page.locator('.appbar').getByRole('button', { name: 'Back' }).click();
  await page.locator('button.li', { hasText: state }).first().click();
};

test.describe('Q. QA defect tracker (PAW)', () => {
  test.beforeEach(async ({ page }) => { await boot(page); await signInOwner(page); });

  test('Q1 PAW-001/005 an unsent request can be edited from its screen; once sent, Edit is gone and the reason is shown', async ({ page }) => {
    await ask(page, 'Can someone feed Bruno at 6 pm? Spare key with Ankita.');
    await page.getByRole('button', { name: 'Search my friends' }).click();
    await expect(page.getByRole('heading', { name: 'Suggestions' })).toBeVisible();
    await page.locator('.appbar').getByRole('button', { name: 'Back' }).click(); // back to Check the details
    await openFromList(page, 'Awaiting owner approval');
    await expect(page.getByRole('heading', { name: 'Request' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit request' }).click();
    await expect(page.getByRole('heading', { name: 'Check the details' })).toBeVisible();
    await page.locator('#rt').selectOption(String(18 * 60 + 30));
    await page.getByRole('button', { name: 'Search my friends' }).click();
    await page.getByRole('button', { name: 'Ask Priya' }).click();
    await page.getByText(/I approve sending/).click();
    await page.getByRole('button', { name: 'Send on WhatsApp' }).click();
    await expect(page.locator('.conf', { hasText: 'Sent' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit request' })).toHaveCount(0);
    await expect(page.getByText(/Already sent to friends, so the details can’t be edited/)).toBeVisible();
  });

  test('Q2 PAW-004/012 history shows the latest 3 with exact times; View all shows the rest', async ({ page }) => {
    await ask(page, 'Can someone feed Bruno at 6 pm? Spare key with Ankita.');
    await page.getByRole('button', { name: 'Search my friends' }).click();
    await page.getByRole('button', { name: 'Ask Priya' }).click();
    await page.getByText(/I approve sending/).click();
    await page.getByRole('button', { name: 'Send on WhatsApp' }).click();
    const hist = page.locator('.card', { hasText: 'Event history' });
    await expect(hist.getByRole('button', { name: 'View all (4)' })).toBeVisible();
    await expect(hist.locator('.row.small')).toHaveCount(3);
    await expect(hist.locator('.mono').first()).toHaveText(/\d{1,2}:\d{2}:\d{2}\s?(am|pm)/i);
    await hist.getByRole('button', { name: 'View all (4)' }).click();
    await expect(hist.locator('.row.small')).toHaveCount(4);
  });

  test('Q3 PAW-006 a pet profile change shows on an unsent request', async ({ page }) => {
    await ask(page, 'Can someone give Bruno his medicine at 6 pm? Spare key with Ankita.');
    // Before answering: the medicine question quotes the profile as it is now.
    await api(page, 'PATCH', '/v1/households/hh_demo/pets/bruno', { medicines: 'Joint supplement — 2 chewables with lunch' });
    await openFromList(page, 'Draft');
    await expect(page.getByRole('button', { name: /Use Bruno’s profile: Joint supplement — 2 chewables/ })).toBeVisible();
    await page.getByRole('button', { name: /Use Bruno’s profile/ }).click();
    // After answering: a later profile change is flagged, and search uses the new text.
    await api(page, 'PATCH', '/v1/households/hh_demo/pets/bruno', { medicines: 'Joint supplement — 1 chewable with dinner' });
    await openFromList(page, 'Draft');
    await expect(page.getByText(/Bruno’s profile changed since you wrote this/)).toBeVisible();
  });

  test('Q4 PAW-002/008 New task: Save without a name shows a plain error by the field and saves nothing', async ({ page }) => {
    await tab(page, 'Today');
    await page.getByRole('button', { name: 'Edit routine' }).click();
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('#rtt')).toBeFocused(); // the name is the first field
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#rtt-err')).toHaveText('Give the task a name.');
    await expect(page.getByText(/expected string/)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'New task' })).toBeVisible();
    await page.locator('#rty').selectOption('medicine'); await page.locator('#rtt').fill('Eye drops');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Add the vet’s written instructions for a medicine task.')).toBeVisible();
  });

  test('Q5 PAW-013 unsaved work: leaving New task asks first; the simple form survives a tab switch', async ({ page }) => {
    await tab(page, 'Today');
    await page.getByRole('button', { name: 'Edit routine' }).click();
    await page.getByRole('button', { name: 'Add' }).click();
    await page.locator('#rtt').fill('Evening brush');
    await page.locator('.appbar').getByRole('button', { name: 'Back' }).click();
    await expect(page.getByText('Discard your changes to this task?')).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.locator('#rtt')).toHaveValue('Evening brush');
    await tab(page, 'Find cover');
    await page.getByRole('button', { name: 'Simple form' }).click();
    await page.getByLabel('Feed').check();
    await tab(page, 'Today'); await tab(page, 'Find cover');
    await page.getByRole('button', { name: 'Simple form' }).click();
    await expect(page.getByLabel('Feed')).toBeChecked();
  });
});
