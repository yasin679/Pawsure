import { test, expect } from '@playwright/test';
import { boot, signIn, signUp, signInOwner, signOut, tab, api, PHONE, API, fillPetEssentials, intake, findCoverForm } from './helpers';

test.describe('M. Login separation and security (on screen)', () => {
  test('M1 Helper login → helper home only (her own tasks to send proof, WhatsApp instructions), no owner tabs or household data', async ({ page }) => {
    await boot(page); await signIn(page, '9000000035');
    await expect(page.getByRole('heading', { name: 'Pawsure for helpers' })).toBeVisible();
    await expect(page.locator('nav.tabbar')).toHaveCount(0);
    // She sees her own tasks (as in her WhatsApp prompts) but never the flat, access notes, medicines text or owner data.
    await expect(page.getByText('Today’s tasks')).toBeVisible();
    for (const hidden of ['B-1104', 'Spare key with Ankita', 'Neha', 'Dr. Aarti']) await expect(page.getByText(hidden)).toHaveCount(0);
    await page.getByRole('button', { name: 'Your data rights' }).click();
    await expect(page.getByRole('heading', { name: 'Your data rights' })).toBeVisible();
  });

  test('M2 Backup login → care-circle home: today’s timeline and alerts, no pets, flat or owner tabs', async ({ page }) => {
    await boot(page); await signIn(page, '9700000008');
    await expect(page.getByRole('heading', { name: 'Care circle' })).toBeVisible();
    await expect(page.getByText(/Backups never give medicine/)).toBeVisible();
    await expect(page.locator('.tl')).toContainText('Planned: Lunch + fresh water');
    await expect(page.locator('nav.tabbar')).toHaveCount(0);
    await expect(page.getByText('B-1104')).toHaveCount(0);
  });

  test('M3 Backup can acknowledge an emergency the owner reported', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await page.getByRole('button', { name: 'Report a problem or emergency' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Pet hurt' }).click();
    await signOut(page);
    await signIn(page, '9700000008');
    const inc = page.locator('.card.danger', { hasText: 'S1 · pet hurt' });
    await inc.getByRole('button', { name: 'I’m on it' }).click();
    await expect(page.getByText('Thanks, the owner will see that you’re on it.')).toBeVisible();
  });

  test('M4 Staff who sign in on the owner app go to the console, not owner sign-up', async ({ page }) => {
    await boot(page); await signIn(page, PHONE.ops);
    await expect(page.locator('.console-nav')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Terms and privacy' })).toHaveCount(0);
  });

  test('M5 Shared phone: after sign-out the old session is dead and the next person sees none of the previous person’s data', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await findCoverForm(page);
    await page.locator('#ask').fill('Private draft from Neha: key under the mat');
    const oldToken = await page.evaluate(() => JSON.parse(localStorage.getItem('pawsure.session')!).token as string);
    await signOut(page);
    expect(await page.evaluate(() => localStorage.getItem('pawsure.session'))).toBeNull();
    const reuse = await page.evaluate(async ([A, t]) => (await fetch(A + '/v1/me', { headers: { authorization: 'Bearer ' + t } })).status, [API, oldToken] as const);
    expect(reuse).toBe(401);
    await signIn(page, PHONE.rohan);
    await findCoverForm(page);
    await expect(page.locator('#ask')).toHaveValue('');
    await expect(page.getByText('Private draft from Neha')).toHaveCount(0);
  });

  test('M6 “Sign out of all devices” ends the owner’s other sessions too', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await api(page, 'POST', '/demo/clock', { advance: 1 });
    const other = await page.evaluate(async ([A, p]) => {
      const j = (path: string, b: unknown) => fetch(A + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
      const r = await j('/auth/otp/request', { phone: p }); return (await j('/auth/otp/verify', { phone: p, code: r.demoCode })).token as string;
    }, [API, '+91' + PHONE.neha] as const);
    await tab(page, 'Me');
    await page.getByRole('button', { name: 'Sign out of all devices' }).click();
    await expect(page.getByRole('heading', { name: 'When help can’t come, ask friends.' })).toBeVisible(); // welcome screens after signing out
    const status = await page.evaluate(async ([A, t]) => (await fetch(A + '/v1/me', { headers: { authorization: 'Bearer ' + t } })).status, [API, other] as const);
    expect(status).toBe(401);
  });

  test('M7 A new user sees only their own (empty) home, none of Neha’s pets, friends or requests', async ({ page }) => {
    await boot(page); await signUp(page, '9811666777');
    await page.getByText('I accept the Terms of Use').click(); await page.getByText('I have read the Privacy Notice').click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await intake(page, 'Eve', 'Hiranandani, Powai');
    await expect(page.getByRole('heading', { name: /Eve/ })).toBeVisible();
    await expect(page.getByText('Bruno')).toHaveCount(0);
    await tab(page, 'Friends'); await expect(page.getByText('Priya Shah')).toHaveCount(0);
    await findCoverForm(page); await expect(page.getByText('No requests yet')).toBeVisible();
  });

  test('M8 Friend login sees only requests sent to them, never household tabs', async ({ page }) => {
    await boot(page); await signIn(page, PHONE.priya);
    await expect(page.getByRole('heading', { name: 'Requests for you' })).toBeVisible();
    await expect(page.locator('nav.tabbar')).toHaveCount(0);
    await expect(page.getByText('No requests right now')).toBeVisible();
  });

  test('M9 HTML typed into a pet name shows as text and never runs', async ({ page }) => {
    let dialogs = 0; page.on('dialog', d => { dialogs++; void d.dismiss(); });
    await boot(page); await signInOwner(page); await tab(page, 'Pet');
    await page.getByRole('button', { name: '+ Add' }).click();
    await page.locator('#f-name').fill('<img src=x onerror=alert(1)>');
    await fillPetEssentials(page);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(dialogs).toBe(0);
    expect(await page.locator('img[src="x"]').count()).toBe(0);
  });

  test('M10 Staff console: the owner’s session never opens it; signing out of the console ends that session only', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await page.evaluate(() => { location.hash = 'admin'; });
    await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
    await page.locator('#sp').fill(PHONE.lead);
    await page.getByRole('button', { name: 'Send code' }).click();
    const code = (await page.locator('span.mono').first().innerText()).trim();
    await page.locator('#sc').fill(code); await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.console-nav')).toBeVisible();
    const t = await page.evaluate(() => JSON.parse(localStorage.getItem('pawsure.staff.session')!).token as string);
    expect(await page.evaluate(() => localStorage.getItem('pawsure.session'))).not.toBeNull(); // owner still signed in
    await page.locator('.console-nav').getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
    const status = await page.evaluate(async ([A, tk]) => (await fetch(A + '/admin/me', { headers: { authorization: 'Bearer ' + tk } })).status, [API, t] as const);
    expect(status).toBe(401);
  });
});
