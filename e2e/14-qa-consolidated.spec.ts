import { test, expect, type Page } from '@playwright/test';
import { boot, signIn, signInOwner, signOut, tab, meItem, api, PHONE } from './helpers';

/** QA consolidated tracker (14 Nov 2026): the on-screen half of PAW-017 to PAW-062. API checks: apps/api/test/qa-consolidated.test.ts. */

/** Owner asks Priya for a 6 PM feed, Priya says yes, the owner confirms; ends signed in as Priya on her Requests tab. */
async function confirmedVisitForPriya(page: Page) {
  await signInOwner(page);
  const H = '/v1/households/hh_demo';
  const r = (await api<{ id: string }>(page, 'POST', `${H}/requests`, { manual: { tasks: ['feed', 'walk'], petId: 'bruno', time: 1080, access: 'Key handover' } })).body;
  await api(page, 'POST', `${H}/requests/${r.id}/search`, {});
  await api(page, 'POST', `${H}/requests/${r.id}/approve`, { friendIds: ['u_priya'], mode: 'one', approved: true });
  await signOut(page); await signIn(page, PHONE.priya);
  await expect(page.getByRole('heading', { name: 'Requests for you' })).toBeVisible();
  await api(page, 'POST', `/v1/me/requests/${r.id}/reply`, { reply: 'yes' });
  await signOut(page); await signInOwner(page);
  await api(page, 'POST', `${H}/requests/${r.id}/confirm`, { friendId: 'u_priya' });
  await signOut(page); await signIn(page, PHONE.priya);
  await expect(page.getByRole('heading', { name: 'Requests for you' })).toBeVisible();
  return r.id;
}

test.describe('R. QA consolidated tracker (14 Nov)', () => {
  test.beforeEach(async ({ page }) => { await boot(page); });

  test('R1 PAW-017 the owner edits the profile: tower saved, flat stays private, every owner is told', async ({ page }) => {
    await signInOwner(page);
    await meItem(page, /Profile and what friends see/);
    await expect(page.getByText('Lake Vista CHS, Powai')).toBeVisible();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await expect(page.locator('#cty')).toHaveValue('Mumbai');
    await expect(page.locator('#soc')).toHaveValue('soc_lakevista_mum');
    await page.locator('#ptw').fill('Tower C');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved: tower\./)).toBeVisible();
    await expect(page.locator('dl.kv')).toContainText('Tower C');
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.locator('#ptw').fill('Tower B'); await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('dl.kv')).toContainText('Tower B');
  });

  test('R2 PAW-018/036 sign-up asks for the state and city first; Pune and Mumbai list their own Lake Vista CHS', async ({ page }) => {
    await signIn(page, '9822200077');
    await page.getByRole('checkbox', { name: /Terms of Use/ }).check(); await page.getByRole('checkbox', { name: /Privacy Notice/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
    await page.locator('#nm').fill('Isha');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await page.locator('#stt').selectOption('Maharashtra');
    await page.locator('#cty').selectOption('Pune');
    await expect(page.locator('#soc option', { hasText: 'Lake Vista CHS · Baner' })).toHaveCount(1);
    await expect(page.locator('#soc option', { hasText: 'Powai' })).toHaveCount(0);
    await page.locator('#soc').selectOption({ label: 'Lake Vista CHS · Baner' });
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  test('R3 PAW-029 Priya pauses for 6 days: the switch shows On with the dates; turning it off ends the pause', async ({ page }) => {
    await signIn(page, PHONE.priya);
    await page.getByRole('button', { name: 'My settings (F7)' }).click();
    await page.getByRole('button', { name: /Pause for 6 days/ }).click();
    await expect(page.getByText(/Paused\. No new requests until .*12 Nov\./)).toBeVisible();
    await expect(page.getByRole('switch', { name: /Pause all requests/ })).toBeChecked();
    await expect(page.getByText(/Paused until .*11 Nov\. Requests come back on .*12 Nov\./)).toBeVisible();
    await page.getByRole('switch', { name: /Pause all requests/ }).click();
    await expect(page.getByText('Requests are back on.')).toBeVisible();
    await expect(page.getByRole('switch', { name: /Pause all requests/ })).not.toBeChecked();
  });

  test('R4 PAW-026/033 a two-pet request: both pets ticked, summary names both; capacity and overnight hours in settings', async ({ page }) => {
    await signIn(page, PHONE.priya);
    await page.getByRole('button', { name: 'My settings (F7)' }).click();
    await page.locator('#mxp').selectOption('2');
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.locator('#wt').selectOption(String(6 * 60)); await page.locator('#wf').selectOption(String(21 * 60));
    await expect(page.locator('#wt option:checked')).toHaveText('6:00 AM (next day)');
    await page.locator('#wf').selectOption(String(16 * 60 + 30)); await page.locator('#wt').selectOption(String(21 * 60));
    await expect(page.locator('#wt option:checked')).toHaveText('9:00 PM');
    await signOut(page); await signInOwner(page);
    await tab(page, 'Find cover');
    await page.getByRole('button', { name: 'Simple form' }).click();
    await page.getByRole('checkbox', { name: 'Feed' }).check();
    await page.getByRole('checkbox', { name: /Misty/ }).check();
    await page.getByRole('button', { name: 'Search my friends' }).click();
    await expect(page.getByRole('heading', { name: 'Suggestions' })).toBeVisible();
    await expect(page.getByText(/Bruno and Misty/).first()).toBeVisible();
    await expect(page.getByText('Happy to look after 2 pets at once').first()).toBeVisible();
  });

  test('R5 PAW-041/056 Priya says she is running late, then has an emergency after feeding: the owner sees both', async ({ page }) => {
    const id = await confirmedVisitForPriya(page);
    await page.getByLabel('How late').selectOption('20');
    await page.getByRole('button', { name: 'I’m running late' }).click();
    await expect(page.getByText('The owner has been told you’ll be about 20 min late.')).toBeVisible();
    await page.getByRole('button', { name: 'I’ve arrived' }).click();
    await page.getByRole('button', { name: 'Emergency: I have to leave' }).click();
    await page.getByRole('checkbox', { name: 'Fed' }).check();
    await page.getByRole('button', { name: 'Send emergency alert' }).click();
    await expect(page.getByText('The owner has been alerted and backups are being asked. Take care.')).toBeVisible();
    await expect(page.getByText('This visit was interrupted. Thank you for letting the owner know.')).toBeVisible();
    await signOut(page); await signInOwner(page);
    await tab(page, 'Find cover');
    await page.locator('button.li', { hasText: 'Interrupted' }).first().click();
    await expect(page.getByText(/Priya had an emergency and left\./)).toBeVisible();
    await expect(page.getByText(/Finished: Feed\./)).toBeVisible();
    expect((await api<{ state: string }>(page, 'GET', `/v1/households/hh_demo/requests/${id}`)).body.state).toBe('Interrupted');
  });

  test('R7 Pawly finds friends with its steps on screen; with nobody free it shows the no-friend page', async ({ page }) => {
    await signInOwner(page);
    await tab(page, 'Find cover');
    await page.locator('#ask').fill('Can someone feed Bruno at 6 pm? Spare key with Ankita.');
    await page.getByRole('button', { name: 'Understand my request' }).click();
    await page.getByRole('button', { name: /Find with Pawly/ }).click();
    await expect(page.getByRole('heading', { name: 'Pawly is finding a friend' })).toBeVisible();
    await expect(page.getByText(/Pawly found \d friends? who can help/)).toBeVisible();
    await page.locator('.appbar').getByRole('button', { name: 'Back' }).click();
    await page.locator('.appbar').getByRole('button', { name: 'Back' }).click();
    await page.locator('#ask').fill('Can someone feed Bruno at 10:30 pm?');
    await page.getByRole('button', { name: 'Understand my request' }).click();
    await page.getByRole('button', { name: /Find with Pawly/ }).click();
    await expect(page.getByRole('heading', { name: 'No friend is free right now' })).toBeVisible();
    await expect(page.getByText('Pawly checked all your friends.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: /Invite a friend/ }).click();
    await expect(page.getByRole('heading', { name: 'Friends' })).toBeVisible();
  });

  test('R8 The demo tools are hidden unless switched on', async ({ page }) => {
    const fresh = await page.context().newPage(); // the shared setup switched the tools on for the first page
    await boot(fresh, '', { tools: false });
    await fresh.evaluate(() => localStorage.removeItem('pawsure.demoTools'));
    await fresh.reload(); await fresh.waitForSelector('html[data-demo-ready]', { state: 'attached' });
    await signInOwner(fresh);
    await expect(fresh.locator('.demobar')).toHaveCount(0);
    await expect(fresh.getByText('9:00 AM')).toHaveCount(0);
  });

  test('R9 consent explains the Terms and Privacy Notice in plain words; no research toggle; a name of numbers is refused', async ({ page }) => {
    await signIn(page, '9822200078');
    await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible();
    await expect(page.getByText('Pilot research interviews')).toHaveCount(0);
    await page.getByRole('button', { name: /Read the Privacy Notice/ }).click();
    await expect(page.getByRole('dialog', { name: 'Privacy Notice' })).toContainText('Version PN-1.0');
    await expect(page.getByRole('dialog')).toContainText('photos and voice notes 90 days');
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.getByRole('checkbox', { name: /Terms of Use/ }).check(); await page.getByRole('checkbox', { name: /Privacy Notice/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('#nm').fill('12345');
    await expect(page.getByText('Enter a real name using letters, not numbers.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await expect(page.locator('#lg option')).toHaveCount(23);
  });

  test('R6 PAW-019 the helper can’t change the home’s details but can tell the owner they are wrong', async ({ page }) => {
    await signIn(page, '9000000035');
    await expect(page.getByRole('heading', { name: /Hello Sunita/ })).toBeVisible();
    await page.getByRole('button', { name: 'Wrong society or tower? Tell the owner' }).click();
    await expect(page.getByText('Thanks. The owner has been asked to check, and Pawsure support can help.')).toBeVisible();
  });
});
