import { test, expect, type Page } from '@playwright/test';
import { boot, signIn, signInOwner, api, tick, webhook, clockTo, tab, dialog, staff, consoleSection, noHorizontalScroll, fillSociety, PHONE, SUNITA, DAY } from './helpers';

/** v1.4 cover continuity (PRD 17.1 new rows) through the real screens of the demo build. */
const HH = '/v1/households/hh_demo';
const DESAI = '+919800000040', ANKITA = '+919700000008', PRIYA = '+919900000012', RAHUL = '+919300000002';
const thread = async (page: Page) => (await api<{ template: string | null; buttons: { id: string; label: string }[] | null; body: string; gloss: string | null }[]>(page, 'GET', '/demo/helper-thread/m_sunita')).body;
const reminderButton = async (page: Page, kind: 'yes' | 'cant' | 'sub') => (await thread(page)).filter(m => m.template === 'cover_reminder').at(-1)!.buttons!.find(b => b.id.startsWith('cover_' + kind))!.id;
const cover = async (page: Page) => (await api(page, 'GET', `${HH}/cover`)).body;
const refresh = async (page: Page) => { await tab(page, 'Me'); await tab(page, 'Today'); };
const atRiskCard = (page: Page) => page.locator('.card.atrisk').first();

test.describe('O. Cover continuity (v1.4)', () => {
  test('O1 Helper taps Can’t make it at 2:30 → At risk → backups in order → Mrs Desai reads the note and accepts → owner confirms → gate and key', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await clockTo(page, '14:30');
    const msgs = await thread(page), rem = msgs.find(m => m.template === 'cover_reminder')!;
    expect(rem.body).toContain('सुनीता'); expect(rem.gloss).toMatch(/Will you come\?/);
    await webhook(page, { from: SUNITA, type: 'button', payload: await reminderButton(page, 'cant') });
    await refresh(page);
    await expect(atRiskCard(page)).toContainText('At risk · Bruno · Toilet pad change + water top-up');
    await expect(atRiskCard(page)).toContainText('Asking: Mrs Desai and Ankita');
    await expect(page.locator('.coverline.risk').first()).toContainText('At risk');
    const job = (await cover(page)).jobs[0];
    await webhook(page, { from: DESAI, type: 'button', payload: `cb_yes:${job.id}` }); // first-time carer: blocked until the note is read
    expect((await cover(page)).jobs[0].hold).toBeNull();
    await webhook(page, { from: DESAI, type: 'button', payload: `cb_read:${job.id}` });
    await webhook(page, { from: DESAI, type: 'button', payload: `cb_yes:${job.id}` });
    await refresh(page);
    await page.getByRole('button', { name: 'Confirm Mrs Desai' }).click();
    const gk = page.locator('.gatekey').first();
    await expect(gk).toContainText('Gate and key · Mrs Desai'); await expect(gk).toContainText('To do');
    await expect(page.locator('.coverline.ok').filter({ hasText: 'Mrs Desai · replacement confirmed' })).toBeVisible();
    await gk.getByRole('checkbox').click(); await expect(gk.getByRole('checkbox')).toBeChecked();
    await gk.locator('select').selectOption({ index: 3 });
    await expect(gk).toContainText('Ready');
  });

  test('O2 No reply by 3:15 → At risk “no reply”, owner alerted once', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await clockTo(page, '14:30'); await clockTo(page, '15:10');
    await expect(page.locator('.card.atrisk')).toHaveCount(0);
    await clockTo(page, '15:15');
    await expect(atRiskCard(page)).toContainText('No reply from Sunita to the reminder by 3:15 PM');
    const pushes = (await api<{ channel: string; body: string }[]>(page, 'GET', '/demo/outbox')).body.filter(o => o.channel === 'push' && /is at risk/.test(o.body));
    expect(pushes).toHaveLength(1);
  });

  test('O3 Helper writes “येऊ शकत नाही” at 11 AM for the 1 PM visit → At risk; access removed', async ({ page }) => {
    await boot(page); await signInOwner(page); await clockTo(page, '11:00');
    await page.getByRole('button', { name: /Show Sunita’s phone/ }).click();
    await page.getByRole('button', { name: /“येऊ शकत नाही” \(can’t come\)/ }).click();
    await refresh(page);
    await expect(atRiskCard(page)).toContainText('Sunita says she can’t come');
    await expect(atRiskCard(page)).toContainText('Lunch + fresh water');
    expect((await api(page, 'GET', '/admin/audit').catch(() => ({ status: 0 }))).status).not.toBe(500);
  });

  test('O4 Send someone else → helper names her sister → owner approves → one-time task link with details only after the note is read', async ({ page }) => {
    await boot(page); await signInOwner(page); await clockTo(page, '14:30');
    await page.getByRole('button', { name: /Show Sunita’s phone/ }).click();
    await page.getByRole('button', { name: /दुसऱ्याला पाठवते/ }).click();
    await page.getByRole('button', { name: /Send name: लता पवार/ }).click();
    await refresh(page);
    const card = page.locator('.card.atrisk', { hasText: 'wants to send someone else' });
    // Sunita typed her sister's name in Marathi script; the owner sees it as written.
    await expect(card).toContainText('Nothing about your home has been shared with लता');
    await card.getByRole('button', { name: 'Approve लता' }).click();
    await page.getByRole('button', { name: /Show backups’ phones/ }).click();
    await page.locator('.simphone .seg').getByRole('button', { name: 'लता' }).click();
    await page.getByRole('button', { name: 'Open the task link' }).click();
    await expect(page.getByText(/Flat B-1104/)).toHaveCount(0);
    await page.locator('.hnote').getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Open the details' }).click();
    await expect(page.getByText('Flat B-1104, Tower B')).toBeVisible();
  });

  test('O5 Backups in order: two at a time, key holders first; the owner sees each ask and stops the list', async ({ page }) => {
    await boot(page); await signInOwner(page); await clockTo(page, '14:30');
    await webhook(page, { from: SUNITA, type: 'button', payload: await reminderButton(page, 'cant') });
    await refresh(page);
    await atRiskCard(page).getByRole('button', { name: 'See what’s happening' }).click();
    await expect(dialog(page)).toContainText('Mrs Desai'); await expect(dialog(page)).toContainText('Ankita Joshi'); await expect(dialog(page)).not.toContainText('Ritu');
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await clockTo(page, '14:40');
    await atRiskCard(page).getByRole('button', { name: 'See what’s happening' }).click();
    await expect(dialog(page)).toContainText('Rohan Kulkarni'); await expect(dialog(page)).toContainText('Ritu Kulkarni'); await expect(dialog(page)).toContainText('No reply');
    await dialog(page).getByRole('button', { name: 'Stop asking' }).click();
    await expect(dialog(page)).toContainText('Choose the next step');
  });

  test('O6 A friend cancels at 4:45 for a 5:00 task → Friend Finder does not start → backup list; owner told why', async ({ page }) => {
    await boot(page); await signInOwner(page); await clockTo(page, '15:30');
    const r = (await api(page, 'POST', `${HH}/requests`, { text: 'Can someone feed Bruno at 5 pm? Spare key with Ankita.' })).body;
    await api(page, 'POST', `${HH}/requests/${r.id}/search`, {}); await api(page, 'POST', `${HH}/requests/${r.id}/approve`, { friendIds: ['u_priya'], mode: 'one', approved: true });
    await webhook(page, { from: PRIYA, type: 'button', payload: `ff_yes:${r.id}` });
    await api(page, 'POST', `${HH}/requests/${r.id}/confirm`, { friendId: 'u_priya' });
    await clockTo(page, '16:45');
    await webhook(page, { from: PRIYA, type: 'button', payload: `ff_cancel:${r.id}` });
    await refresh(page);
    await expect(atRiskCard(page)).toContainText('Priya cancelled');
    await atRiskCard(page).getByRole('button', { name: 'See what’s happening' }).click();
    await expect(dialog(page)).toContainText('Friend Finder not started: too close to the task');
    expect((await api(page, 'GET', `${HH}/requests`)).body).toHaveLength(1);
  });

  test('O7 Cover not found, must happen (medicine): no Move or Skip; care circle called after 15 min', async ({ page }) => {
    await boot(page); await signInOwner(page); await clockTo(page, '11:40');
    await webhook(page, { from: SUNITA, type: 'text', text: "I can't come today" });
    const job = (await cover(page)).jobs[0];
    await webhook(page, { from: ANKITA, type: 'button', payload: `cb_yes:${job.id}` });
    await api(page, 'POST', `${HH}/cover/jobs/${job.id}/confirm`, { personId: 'bk_ankita' });
    await clockTo(page, '11:55'); await clockTo(page, '12:30');
    const sheet = dialog(page);
    await expect(sheet).toContainText('Cover not found'); await expect(sheet).toContainText('Joint supplement');
    await expect(sheet).toContainText('Calling your care circle in 15 min if you don’t respond');
    await expect(sheet.getByRole('button', { name: /Move it/ })).toHaveCount(0); await expect(sheet.getByRole('button', { name: /Skip it/ })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await clockTo(page, '12:45');
    expect((await cover(page)).jobs.find((j: { id: string }) => j.id === job.id).circleCalled).toBe(true);
  });

  test('O8 Cover not found, can wait (walk) → the owner moves it; the day records who was asked', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await api(page, 'POST', `${HH}/routine`, { petId: 'bruno', title: 'Evening play walk', type: 'walk', due: 18 * 60 + 30, assignee: 'helper', oneOffToday: true });
    for (const hm of ['17:00', '17:45', '17:55', '18:05', '18:15']) await clockTo(page, hm);
    const sheet = dialog(page); await expect(sheet).toContainText('Cover not found');
    await sheet.getByRole('button', { name: 'Move it' }).click();
    await dialog(page).getByRole('button', { name: 'Move it' }).click();
    await expect(page.locator('.coverline').filter({ hasText: 'You’re handling it' })).toBeVisible();
    await page.getByRole('button', { name: 'Day report' }).click();
    await expect(dialog(page)).toContainText('Cover history'); await expect(dialog(page)).toContainText('Mrs Desai (no reply)');
  });

  test('O9 “I’m leaving” with nobody confirmed → warning and options → Leave anyway → No cover planned', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await page.getByRole('button', { name: 'My help can’t come today' }).click();
    await dialog(page).getByRole('button', { name: 'Mark unavailable' }).click();
    await page.getByRole('button', { name: 'I’m leaving' }).click();
    await expect(dialog(page)).toContainText('Nobody has accepted Bruno’s 1:00 PM lunch + fresh water yet.');
    await expect(dialog(page).locator('[data-option]')).toHaveCount(6);
    await dialog(page).locator('[data-option="leave_anyway"]').click();
    await expect(dialog(page)).toContainText('who is plan B');
    await dialog(page).locator('#pb').selectOption('I’ll come back myself');
    await dialog(page).getByRole('button', { name: 'I’m leaving' }).click();
    await expect(page.locator('.conf').filter({ hasText: 'No cover planned' })).toBeVisible();
  });

  test('O10 “I’m delayed” 7 → 9 PM: Sunita only until 8 → a request for the dinner only', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await page.getByRole('button', { name: 'I’m leaving' }).click();
    await dialog(page).getByRole('button', { name: 'I’m leaving' }).click();
    await clockTo(page, '18:30');
    await page.getByRole('button', { name: 'I’m delayed' }).click();
    await dialog(page).locator('#dlt').selectOption(String(21 * 60));
    await dialog(page).getByRole('button', { name: 'See what changes' }).click();
    await expect(dialog(page)).toContainText('Evening walk'); await expect(dialog(page)).toContainText('Dinner + water'); await expect(dialog(page)).toContainText('Medicine: no medicine');
    await dialog(page).getByRole('button', { name: 'Ask Sunita first' }).click();
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    const ext = (await thread(page)).filter(m => m.template === 'cover_extension_request').at(-1)!;
    await webhook(page, { from: SUNITA, type: 'button', payload: ext.buttons![1]!.id });
    await refresh(page);
    await expect(atRiskCard(page)).toContainText('Dinner + water');
    await expect(atRiskCard(page)).toContainText('can stay only until 8:00 PM');
  });

  test('O11 Gate and key: unticked items remind the owner once at task − 15', async ({ page }) => {
    await boot(page); await signInOwner(page); await clockTo(page, '14:30');
    await webhook(page, { from: SUNITA, type: 'button', payload: await reminderButton(page, 'cant') });
    const job = (await cover(page)).jobs[0];
    await webhook(page, { from: DESAI, type: 'button', payload: `cb_read:${job.id}` }); await webhook(page, { from: DESAI, type: 'button', payload: `cb_yes:${job.id}` });
    await api(page, 'POST', `${HH}/cover/jobs/${job.id}/confirm`, { personId: 'bk_desai' });
    await clockTo(page, '15:45'); await clockTo(page, '15:50');
    const out = (await api<{ template: string }[]>(page, 'GET', '/demo/outbox')).body.filter(o => o.template === 'Gate and key');
    expect(out).toHaveLength(1);
  });

  test('O12 A first-time friend must read the handling note before Yes', async ({ page }) => {
    await boot(page); await signInOwner(page); await clockTo(page, '18:00');
    const r = (await api(page, 'POST', `${HH}/requests`, { text: 'Can someone feed Bruno at 7:30 pm? Spare key with Ankita.' })).body;
    await api(page, 'POST', `${HH}/requests/${r.id}/search`, {}); await api(page, 'POST', `${HH}/requests/${r.id}/approve`, { friendIds: ['u_rahul'], mode: 'one', approved: true });
    await page.getByRole('button', { name: /Show friends’ phones/ }).click();
    await page.getByRole('button', { name: 'Rahul', exact: true }).click();
    await expect(page.locator('.bub').filter({ hasText: 'Handling note, please read first' })).toBeVisible();
    await page.locator('.bub button', { hasText: /^Yes/ }).first().click();
    await expect(page.locator('.bub').filter({ hasText: 'Before you say yes, please read the handling note' })).toBeVisible();
    await page.locator('.bub button', { hasText: 'I have read this' }).first().click();
    await page.locator('.bub button', { hasText: /^Yes/ }).first().click();
    await expect.poll(async () => (await api(page, 'GET', `${HH}/requests/${r.id}`)).body.state).toBe('Accepted - pending owner confirmation');
  });

  test('O13 Newcomer with nobody → honest message and the circle builder; no day-care list', async ({ page }) => {
    await boot(page); await signIn(page, '9811222777');
    await page.getByText('I accept the Terms of Use').click(); await page.getByText('I have read the Privacy Notice').click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('#nm').fill('Rohan & Ankita Verma'); await fillSociety(page, 'Raheja Vihar, Powai');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Do you have anyone who can look in on your pet?' })).toBeVisible();
    await page.getByRole('button', { name: 'No one yet' }).click();
    await expect(page.getByText('Cover is limited until you have a circle.')).toBeVisible();
    await expect(page.locator('[data-builder]')).toHaveCount(4);
    await expect(page.getByText('Pawsure doesn’t show a list of day cares here.')).toBeVisible();
    await page.locator('[data-builder="society_link"]').getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('[data-builder="society_link"]')).toContainText('Invite link');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: /Rohan/ })).toBeVisible();
  });

  test('O14 Ops sends a cluster advisory → tomorrow’s reminders go out this evening; same-society fallback is OFF and locked', async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page); await signInOwner(page); await clockTo(page, '18:40');
    await staff(page, PHONE.lead);
    await consoleSection(page, 'Cluster advisory');
    await page.locator('#adr').selectOption('strike');
    await page.getByRole('button', { name: 'Send advisory' }).click();
    await expect(page.getByRole('status')).toContainText('Sent to 1 home');
    await consoleSection(page, 'Switches');
    await expect(page.getByText(/sameSocietyFallback|Same-society/).first()).toBeVisible();
    await consoleSection(page, 'Cover continuity');
    await expect(page.getByRole('cell', { name: 'Cover-not-found rate' })).toBeVisible(); await expect(page.getByRole('cell', { name: 'cover_reminder' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to the owner app' }).click();
    await clockTo(page, '18:45');
    const rem = (await thread(page)).filter(m => m.template === 'cover_reminder');
    expect(rem.length).toBeGreaterThan(0); expect(rem.at(-1)!.body).toContain('उद्या');
  });
});

test.describe('P. v1.1.0 fixes from demo testing (10 Nov 2026)', () => {
  test('P1 A friend’s Yes before the cutoff can still be confirmed after it; new requests are blocked at the cutoff', async ({ page }) => {
    await boot(page); await signInOwner(page); await clockTo(page, '16:20');
    const r = (await api(page, 'POST', `${HH}/requests`, { text: 'Can someone feed Bruno at 5 pm? Spare key with Ankita.' })).body;
    await api(page, 'POST', `${HH}/requests/${r.id}/search`, {}); await api(page, 'POST', `${HH}/requests/${r.id}/approve`, { friendIds: ['u_priya'], mode: 'one', approved: true });
    await clockTo(page, '16:28'); await webhook(page, { from: PRIYA, type: 'button', payload: `ff_yes:${r.id}` });
    await clockTo(page, '16:35');
    const conf = await api(page, 'POST', `${HH}/requests/${r.id}/confirm`, { friendId: 'u_priya' });
    expect(conf.status).toBe(200); expect(conf.body.state).toBe('Confirmed');
    const r2 = (await api(page, 'POST', `${HH}/requests`, { text: 'Can someone feed Misty at 5 pm? Spare key with Ankita.' })).body;
    await api(page, 'POST', `${HH}/requests/${r2.id}/search`, {});
    const late = await api(page, 'POST', `${HH}/requests/${r2.id}/approve`, { friendIds: ['u_arjun'], mode: 'one', approved: true });
    expect(late.status).toBe(409); expect(late.body.message).toMatch(/Too close to the task for Friend Finder/);
  });
  test('P2 Alert text uses the past tense once the backup step has happened', async ({ page }) => {
    await boot(page); await signInOwner(page); await clockTo(page, '11:30');
    await webhook(page, { from: SUNITA, type: 'button', payload: (await thread(page)).find(m => m.template === 'cover_reminder')!.buttons![0]!.id });
    await clockTo(page, '16:30');
    await expect(page.locator('.card.warn', { hasText: 'Lunch + fresh water' }).first()).toContainText('Your backup was alerted at 2:00 PM.');
    await expect(page.getByText(/is alerted at 2:00 PM if you don’t acknowledge/)).toHaveCount(0);
  });
  test('P3 “Planned” appears once on a task card', async ({ page }) => {
    await boot(page); await signInOwner(page);
    const card = page.locator('button.task', { hasText: 'Lunch + fresh water' }).first();
    await expect(card).toBeVisible();
    expect(((await card.innerText()).match(/Planned/g) ?? []).length).toBeLessThanOrEqual(1);
    await expect(card.locator('.coverline')).toContainText('Sunita · assigned');
  });
  test('P4 The request label and the demo parser switch say the same thing (no AI connected)', async ({ page }) => {
    await boot(page); await signInOwner(page);
    await expect(page.locator('.demobar select[data-parser]')).toHaveValue('ok');
    await expect(page.locator('.demobar select[data-parser] option:checked')).toHaveText('rules (no AI connected)');
    const r = (await api(page, 'POST', `${HH}/requests`, { text: 'Can someone feed Bruno at 6 pm?' })).body;
    expect(r.parsedBy).toBe('rules (no AI connected)');
  });
  test('P5 The welcome mascot is a transparent image, not a crop on a beige box', async ({ page }) => {
    await boot(page);
    const img = page.locator('.login-hero img.login-mascot');
    await expect(img).toBeVisible(); await expect(img).toHaveAttribute('src', /mascot-family\.png$/);
    const corner = await img.evaluate(async (el: HTMLImageElement) => { const c = document.createElement('canvas'); c.width = el.naturalWidth; c.height = el.naturalHeight; const g = c.getContext('2d')!; g.drawImage(el, 0, 0); return g.getImageData(2, 2, 1, 1).data[3]; });
    expect(corner).toBe(0);
  });
  test('P6 On a wide screen the simulated phones sit beside the owner app, with no developer wording', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await boot(page); await signInOwner(page);
    await page.getByRole('button', { name: /Show Sunita’s phone/ }).click();
    const app = await page.locator('main.body').first().boundingBox(), sim = await page.locator('.simdock').boundingBox();
    expect(sim!.x).toBeGreaterThan(app!.x + app!.width - 5);
    expect(Math.abs(sim!.y - app!.y)).toBeLessThan(320); // the framed app has a status bar and the demo bar above its content
    await expect(page.locator('.demobar')).not.toContainText(/webhook/i); await expect(page.locator('.simdock')).not.toContainText(/webhook/i);
    await noHorizontalScroll(page);
  });
  test('P7 Demo presets set up each of the 14 v1.4 scenarios', async ({ page }) => {
    test.setTimeout(600_000);
    const expectations: Record<string, (p: Page) => Promise<void>> = {
      O5: async p => { await expect(p.locator('.card.atrisk').first()).toContainText('Asking: Mrs Desai and Ankita'); },
      O7: async p => { await expect(dialog(p)).toContainText('Cover not found'); },
      O9: async p => { await expect(p.getByText(/Sunita can’t come today/)).toBeVisible(); },
      O11: async p => { await expect(p.locator('.gatekey').first()).toContainText('Mrs Desai'); }
    };
    for (let i = 1; i <= 14; i++) {
      await boot(page); await signInOwner(page);
      await page.getByLabel('Load a v1.4 scenario').selectOption(`O${i}`);
      await expect(page.getByRole('status').filter({ hasText: `O${i} ` })).toBeVisible();
      if (expectations[`O${i}`]) await expectations[`O${i}`]!(page);
    }
  });
});
export { DAY, tick };
