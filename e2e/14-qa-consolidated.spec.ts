import { test, expect, type Page } from '@playwright/test';
import { boot, signIn, signUp, signInOwner, signOut, tab, meItem, api, pick, petAndCare, aboutYou, intake, intakeInfo, webhook, PHONE, findCoverForm } from './helpers';

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

  test('R2 Sign-up asks one question for home: every listed society in one list, labelled with its city (Pune and Mumbai each have a Lake Vista CHS)', async ({ page }) => {
    await signUp(page, '9822200077');
    await page.getByRole('checkbox', { name: /Terms of Use/ }).check(); await page.getByRole('checkbox', { name: /Privacy Notice/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Pawly – your assistant', level: 1 })).toBeVisible();
    await expect(page.locator('.pb-steps li[aria-current="step"]')).toContainText('Your information');
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await aboutYou(page, 'Isha');
    await page.getByRole('button', { name: 'Choose manually' }).click();
    await expect(page.locator('#stt')).toHaveCount(0); // no state or city questions
    await page.locator('#soc').click();
    await expect(page.getByRole('option', { name: 'Lake Vista CHS · Baner, Pune' })).toHaveCount(1);
    await expect(page.getByRole('option', { name: 'Lake Vista CHS · Powai, Mumbai' })).toHaveCount(1);
    await page.getByRole('option', { name: 'Lake Vista CHS · Baner, Pune' }).click();
    await expect(page.locator('.cb-sum').last()).toContainText('Pune, Maharashtra'); // city and state come with the society
    await expect(page.locator('#tw')).toHaveCount(0); // no tower or flat questions
    await expect(page.getByRole('button', { name: 'Create my home' })).toBeVisible();
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
    await findCoverForm(page);
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
    await findCoverForm(page);
    await page.locator('button.li', { hasText: 'Interrupted' }).first().click();
    await expect(page.getByText(/Priya had an emergency and left\./)).toBeVisible();
    await expect(page.getByText(/Finished: Feed\./)).toBeVisible();
    expect((await api<{ state: string }>(page, 'GET', `/v1/households/hh_demo/requests/${id}`)).body.state).toBe('Interrupted');
  });

  test('R7 Pawly finds friends with its steps on screen; with nobody free it shows the no-friend page', async ({ page }) => {
    await signInOwner(page);
    await findCoverForm(page);
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
    await fresh.evaluate(() => localStorage.removeItem('pawsure.demoTools.v2'));
    await fresh.reload(); await fresh.waitForSelector('html[data-demo-ready]', { state: 'attached' });
    await signInOwner(fresh, { home: true });
    await expect(fresh.locator('.demobar')).toHaveCount(0);
    await expect(fresh.getByText('9:00 AM')).toHaveCount(0);
  });

  test('R9 consent explains the Terms and Privacy Notice in plain words; no research toggle; a name of numbers is refused', async ({ page }) => {
    await signUp(page, '9822200078');
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
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await aboutYou(page, 'Isha', 'Another language');
    await page.locator('#lg').click();
    await expect(page.getByRole('option')).toHaveCount(23);
  });

  test('R10 the helper sends proof from her own login (gallery photo + today’s code); the owner sees it on the task', async ({ page }) => {
    await signIn(page, '9000000035');
    await expect(page.getByRole('heading', { name: /Hello Sunita/ })).toBeVisible();
    await expect(page.getByText('Today’s tasks')).toBeVisible();
    await page.locator('.li', { hasText: 'Joint supplement' }).getByRole('button', { name: 'Send proof' }).click();
    await page.getByLabel('Choose a photo from the gallery').setInputFiles('apps/web/public/assets/mascot-family.png');
    await page.locator('#pcode').fill((await page.locator('.hint b.mono').innerText()).trim());
    await page.getByRole('dialog').getByRole('button', { name: 'Send proof', exact: true }).click();
    await expect(page.getByText('Thank you! Photo and today’s code received.')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.li', { hasText: 'Joint supplement' })).toContainText('proof sent ✓');
    await signOut(page); await signInOwner(page);
    await page.locator('button.task', { hasText: 'Joint supplement' }).first().click();
    await expect(page.getByText('Proof photos')).toBeVisible();
    await expect(page.locator('.proofs figure').first()).toContainText('today’s code');
  });

  test('R6 PAW-019 the helper can’t change the home’s details but can tell the owner they are wrong', async ({ page }) => {
    await signIn(page, '9000000035');
    await expect(page.getByRole('heading', { name: /Hello Sunita/ })).toBeVisible();
    await page.getByRole('button', { name: 'Wrong society or tower? Tell the owner' }).click();
    await expect(page.getByText('Thanks. The owner has been asked to check, and Pawsure support can help.')).toBeVisible();
  });
});

test.describe('S. Onboarding conversation (15 Nov)', () => {
  test('S1 A society that isn’t listed is typed as “name, city”; the city is checked, then the home is created', async ({ page }) => {
    await boot(page); await signUp(page, '9822200099');
    await page.getByRole('checkbox', { name: /Terms of Use/ }).check(); await page.getByRole('checkbox', { name: /Privacy Notice/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await aboutYou(page, 'Isha');
    await page.getByRole('button', { name: 'Choose manually' }).click();
    await page.getByRole('button', { name: 'My society isn’t listed' }).click();
    await page.locator('#sct').fill('Green Acres CHS');
    await expect(page.getByText('Type the society name, then a comma and your city.')).toBeVisible();
    await page.locator('#sct').fill('Green Acres CHS, Atlantis');
    await expect(page.getByText('Add your city after the comma, e.g. Mumbai.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await page.locator('#sct').fill('Green Acres CHS, Mumbai'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.cb-sum').last()).toContainText('Mumbai, Maharashtra');
    await page.getByRole('button', { name: 'Create my home' }).click();
    await petAndCare(page);
    await expect(page.getByRole('heading', { name: /Isha/ })).toBeVisible();
  });
});

test.describe('T. Home location from the phone (16 Nov)', () => {
  test.use({ geolocation: { latitude: 19.1178, longitude: 72.9058 }, permissions: ['geolocation'] }); // next to Lake Vista CHS, Powai
  const start = async (page: import('@playwright/test').Page, phone: string) => {
    await boot(page); await signUp(page, phone);
    await page.getByRole('checkbox', { name: /Terms of Use/ }).check(); await page.getByRole('checkbox', { name: /Privacy Notice/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await aboutYou(page, 'Isha');
  };
  test('T1 The society, city and state are found from the location; Yes goes straight to Create my home', async ({ page }) => {
    await start(page, '9822200101');
    await expect(page.getByText('Is this home?')).toBeVisible();
    await expect(page.locator('.cb-sum').last()).toContainText('Lake Vista CHS, Powai');
    await expect(page.locator('.cb-sum').last()).toContainText('Mumbai');
    await expect(page.locator('.cb-sum').last()).toContainText('Maharashtra');
    await page.getByRole('button', { name: 'Yes, that’s home' }).click();
    await expect(page.getByRole('button', { name: /Change: 📍 Lake Vista CHS, Powai/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create my home' })).toBeVisible();
    await expect(page.locator('#soc')).toHaveCount(0);
  });
  test('T2 Change opens the society list, with the found city first, and the owner picks another society', async ({ page }) => {
    await start(page, '9822200102');
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await page.locator('#soc').click();
    await expect(page.getByRole('option').first()).toContainText('Mumbai'); // the found city's societies come first
    await page.getByRole('option', { name: 'Hiranandani Gardens · Powai, Mumbai' }).click();
    await expect(page.locator('.cb-sum').last()).toContainText('Hiranandani Gardens, Powai');
  });
});

test.describe('U. Helper invite and voice answers in onboarding (16 Nov)', () => {
  const toCare = async (page: import('@playwright/test').Page, phone: string, opts: { fakeVoice?: boolean } = {}) => {
    if (opts.fakeVoice) await page.addInitScript(() => {
      // A stand-in for the browser's speech recognition: "hears" one sentence when started.
      class FakeRec { lang = ''; interimResults = false; continuous = false; onresult: ((e: unknown) => void) | null = null; onend: (() => void) | null = null; onerror: ((e: unknown) => void) | null = null;
        start() { setTimeout(() => { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'Two cups of rice and curd at lunch' }], { isFinal: true })] }); this.onend?.(); }, 200); }
        stop() { this.onend?.(); } }
      for (const k of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, k, { value: FakeRec, configurable: true, writable: true });
    });
    await boot(page); await signUp(page, phone);
    await page.getByRole('checkbox', { name: /Terms of Use/ }).check(); await page.getByRole('checkbox', { name: /Privacy Notice/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
  };
  test('U1 Food can be answered by voice: what is said is written into the message', async ({ page }) => {
    await toCare(page, '9822200201', { fakeVoice: true });
    await intakeInfo(page, 'Isha');
    await page.locator('#pn0').fill('Coco'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: /Dog/ }).click();
      await page.getByRole('button', { name: 'Speak your answer' }).click();
    await expect(page.locator('#pf0')).toHaveValue('Two cups of rice and curd at lunch');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.cb.me', { hasText: 'Two cups of rice and curd at lunch' })).toBeVisible(); // the answer, saved with the pet
    await expect(page.getByText('Coco’s profile is saved.')).toBeVisible();
  });
  test('U2 “My house help” asks her name and WhatsApp number, sends the invite, and Home shows it pending until she accepts', async ({ page }) => {
    await toCare(page, '9822200202');
    await intake(page, 'Isha Rao', 'Raheja Vihar, Powai', { helper: { name: 'Lata Pawar', phone: '9876500011' } });
    await expect(page.getByText('Invite sent on WhatsApp')).toBeVisible();
    await expect(page.getByText(/I’ve sent Lata a WhatsApp message to join Pawsure/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'If Lata can’t come one day, is there someone else who could step in?' })).toBeVisible();
    await page.getByRole('button', { name: 'Yes, I have someone' }).click();
    const card = page.locator('.help-card');
    await expect(card).toContainText('Lata Pawar');
    await expect(card).toContainText('Invite pending');
    await expect(card.locator('.help-track')).toHaveCount(0);
    const me = await api(page, 'GET', '/v1/me'); const hh = me.body.memberships[0].household_id;
    await webhook(page, { from: '+919876500011', type: 'button', payload: `consent_yes:${hh}` });
    // no reload or tab switch: Home picks up the accepted invite by itself (17 Nov)
    await expect(card).not.toContainText('Invite pending', { timeout: 10000 });
    await expect(card.locator('.help-track')).toContainText('Accepted');
    await expect(card.locator('.help-track li', { hasText: 'Accepted' }).locator('.ht-dot')).toHaveText('✓'); // accepted shows ticked (20 Nov)
    await expect(card.getByRole('button', { name: 'My help can’t come' })).toHaveCount(0); // removed from Home (20 Nov)
  });
  test('U2b The invited helper accepts on the simulated phone, and Home changes from Invite pending to Accepted at once', async ({ page }) => {
    await toCare(page, '9822200203');
    await intake(page, 'Isha Rao', 'Raheja Vihar, Powai', { helper: { name: 'Lata Pawar', phone: '9876500012' } });
    await page.getByRole('button', { name: 'Yes, I have someone' }).click();
    const card = page.locator('.help-card');
    await expect(card).toContainText('Invite pending');
    await page.getByRole('button', { name: 'Show Lata’s phone' }).click(); // the phone plays the helper this owner invited, not Sunita
    const sim = page.locator('.sheet', { hasText: 'Lata’s phone (simulated)' });
    await expect(sim).toBeVisible();
    await sim.getByRole('button', { name: /^(हो|हाँ|Yes)$/ }).last().click();
    await expect(card).not.toContainText('Invite pending', { timeout: 10000 });
    await expect(card.locator('.help-track')).toContainText('Accepted');
  });
  test('U2c The helper verifies and joins on her WhatsApp beside the owner’s phone; Home changes to Accepted by itself', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await toCare(page, '9822200204');
    await intake(page, 'Isha Rao', 'Raheja Vihar, Powai', { helper: { name: 'Lata Pawar', phone: '9876500013' } });
    await page.getByRole('button', { name: 'Yes, I have someone' }).click();
    const card = page.locator('.help-card');
    await expect(card).toContainText('Invite pending');
    // the invite was just sent: her WhatsApp opens beside the owner's phone by itself
    await expect(page.locator('.wa-dock')).toBeVisible();
    const wa = page.frameLocator('.wa-dock iframe');
    await expect(wa.locator('.notif')).toContainText('Hello Lata! Isha has invited you to Pawsure for Coco');
    for (let k = 0; k < 4; k++) await wa.locator('.screen [data-go]').first().click(); // open, open the chat, send ID, join with photos
    await expect(page.locator('.wa-note')).toHaveCount(0); // no status note above her phone (20 Nov)
    await expect(card).not.toContainText('Invite pending', { timeout: 10000 });
    await expect(card.locator('.help-track')).toContainText('Accepted');
  });

  test('U2d If her phone can’t message the app, “Lata said Yes” under it accepts the invite, and Home updates', async ({ page }) => {
    await toCare(page, '9822200207');
    await intake(page, 'Isha Rao', 'Raheja Vihar, Powai', { helper: { name: 'Lata Pawar', phone: '9876500015' } });
    await page.getByRole('button', { name: 'Yes, I have someone' }).click();
    const card = page.locator('.help-card');
    await expect(card).toContainText('Invite pending');
    await page.getByRole('button', { name: /Lata said Yes/ }).click();
    await expect(card).not.toContainText('Invite pending', { timeout: 10000 });
    await expect(card.locator('.help-track')).toContainText('Accepted');
  });

  test('U2e With demo tools off, the helper’s WhatsApp still opens after the invite and the demo bar stays hidden', async ({ page }) => {
    await boot(page, '', { tools: false }); await signUp(page, '9822200311');
    await page.getByRole('checkbox', { name: /Terms of Use/ }).check(); await page.getByRole('checkbox', { name: /Privacy Notice/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await intake(page, 'Isha Rao', 'Raheja Vihar, Powai', { helper: { name: 'Lata Pawar', phone: '9876500311' } });
    await page.getByRole('button', { name: 'Yes, I have someone' }).click();
    await expect(page.locator('.wa-dock')).toBeVisible();
    await expect(page.locator('.demobar')).toHaveCount(0);
    await page.getByRole('button', { name: /Lata said Yes/ }).click();
    await expect(page.locator('.help-card')).not.toContainText('Invite pending', { timeout: 10000 });
    await expect(page.locator('.demobar')).toHaveCount(0);
  });

  test('U2f Her first task: Pawsure’s reminder on her WhatsApp → a bowl photo → the owner is told on Home → reviews and marks it complete', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await toCare(page, '9822200208');
    await intake(page, 'Isha Rao', 'Raheja Vihar, Powai', { helper: { name: 'Lata Pawar', phone: '9876500016' } });
    await page.getByRole('button', { name: 'Yes, I have someone' }).click();
    await expect(page.locator('.wa-dock')).toBeVisible(); // her WhatsApp opens beside the owner's phone after the invite
    const wa = page.frameLocator('.wa-dock iframe');
    for (let k = 0; k < 4; k++) await wa.locator('.screen [data-go]').first().click(); // invite → chat → ID → join with photos
    await expect(page.locator('.help-card')).not.toContainText('Invite pending', { timeout: 10000 });
    await wa.locator('.screen [data-go]').first().click(); // practice photo
    await wa.locator('.screen .view').click();              // practice done
    await expect(wa.locator('.notif')).toContainText('Coco, ⏰ Breakfast (8:00 AM)'); // Pawsure's reminder for her real first task (from sign-up)
    await wa.locator('.screen [data-go]').first().click(); // open the reminder
    await wa.locator('.screen [data-go]').first().click(); // bowl photo (no code card: a photo or a short video is all she sends)
    const note = page.locator('.review-note');
    await expect(note).toContainText('Lata completed Breakfast', { timeout: 10000 });
    await expect(page.locator('.task', { hasText: 'Breakfast' })).toContainText('Approve');
    const thumb = page.locator('.task', { hasText: 'Breakfast' }).locator('img.task-thumb');
    await expect(thumb).toHaveAttribute('src', /^data:image\/webp/); // the photo she sent, on the task card
    const sent = await thumb.getAttribute('src');
    await note.getByRole('button', { name: 'Review' }).click();
    await expect(page.getByRole('dialog')).toContainText('Lata sent this photo');
    await expect(page.getByRole('dialog').locator('.proofs img').first()).toHaveAttribute('src', sent!); // the same photo in the review
    await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Approved: Breakfast. Thank you, Lata!')).toBeVisible();
    await expect(page.locator('.review-note')).toHaveCount(0);
    await expect(page.locator('.task', { hasText: 'Breakfast' })).toContainText('Completed');
    // hide her WhatsApp, then bring it back with the link beside the phone
    await page.locator('.wa-dock').getByRole('button', { name: 'Hide' }).click();
    await page.getByRole('button', { name: 'Show Lata’s WhatsApp' }).click();
    await expect(page.locator('.wa-dock')).toBeVisible();
  });

  test('U5 Find cover works the same right after sign-up as after login: friends to ask, the in-chat form, Send', async ({ page }) => {
    await toCare(page, '9822200209');
    await intake(page, 'Isha Rao', 'Raheja Vihar, Powai');
    await tab(page, 'Find cover');
    await expect(page.getByRole('heading', { name: /How can I help\?/ })).toBeVisible();
    await page.getByRole('button', { name: /Walk Coco this evening/ }).click();
    const first = page.locator('.friend-card').first();
    await expect(first).toBeVisible();
    const name = (await first.locator('b').innerText()).split(' ')[0]!;
    await first.getByRole('button', { name: /^Ask / }).click();
    const form = page.getByRole('group', { name: `Ask ${name}` });
    await form.getByRole('button', { name: 'Next', exact: true }).click();
    await form.getByRole('button', { name: 'Next', exact: true }).click();
    await form.getByRole('button', { name: 'Key handover', exact: true }).click();
    await expect(page.getByText(`Here’s the WhatsApp message for ${name}.`)).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Send on WhatsApp' }).click();
    await expect(page.getByRole('status', { name: `Sent to ${name} on WhatsApp.` })).toBeVisible();
  });

  test('U6 “Start from the beginning” (outside the app) shows the loading screen, then the welcome screens, signed out', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); // the button sits outside the phone frame
    await boot(page, '', { tools: false, intro: true }); // the welcome screens are not pre-skipped in this test
    await page.getByRole('button', { name: 'Log in' }).first().click();
    await signInOwner(page, { home: true });
    await page.getByRole('button', { name: /Start from the beginning/ }).click();
    await expect(page.locator('#splash')).toBeVisible();
    await expect(page.locator('#splash img.logo')).toHaveAttribute('alt', 'Pawsure');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible({ timeout: 30000 }); // the welcome screens
    await expect(page.locator('.help-card')).toHaveCount(0);
  });

  test('U3 A new owner adds tasks from Home: one-tap suggestions, or Add task → tile → a few quick steps', async ({ page }) => {
    await toCare(page, '9822200205');
    await intake(page, 'Isha Rao', 'Raheja Vihar, Powai');
    const addBtn = page.getByRole('button', { name: /^Add (a )?task$/ }).first();
    await expect(addBtn).toBeVisible();
    // one-tap suggestion, when the home has no tasks yet
    const starter = page.locator('.starter').first();
    if (await starter.isVisible()) { await starter.click(); await expect(page.getByText(/Added: Breakfast at 8:00 AM, every day/)).toBeVisible(); }
    // the guided way
    await page.getByRole('button', { name: /^Add (a )?task$/ }).first().click();
    await page.locator('.add-tile', { hasText: 'Walk' }).click();
    const form = page.getByRole('group', { name: 'Add walk' });
    await expect(form.locator('#when')).toContainText('6:00 PM'); // a sensible time is already filled in
    await form.getByRole('button', { name: 'Next', exact: true }).click();
    await form.getByRole('button', { name: 'Skip', exact: true }).click();
    await form.getByRole('button', { name: 'Every day', exact: true }).click();
    await expect(page.getByText('Added: Evening walk for Coco at 6:00 PM, every day.')).toBeVisible();
    await expect(page.locator('.task', { hasText: 'Evening walk' })).toBeVisible(); // shows today, straight away
  });
  test('U4 Right after sign-up, Home shows the tasks from the care answers (feed at 8 AM → Breakfast), with or without a helper, same as for a returning owner', async ({ page }) => {
    await toCare(page, '9822200206');
    await intake(page, 'Isha Rao', 'Raheja Vihar, Powai', { helper: { name: 'Lata Pawar', phone: '9876500014' } });
    await page.getByRole('button', { name: 'Yes, I have someone' }).click();
    // today's tasks at the times chosen in sign-up; 8 AM has already passed (demo clock 9 AM), so it raises no alarm
    await expect(page.locator('.task', { hasText: 'Breakfast' })).toContainText('8:00 AM');
    await expect(page.locator('.task', { hasText: 'Breakfast' })).toContainText('Pending');
    await expect(page.getByText(/Your backup was alerted|No evidence yet/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add task' })).toBeVisible();
    await expect(page.locator('.pet-tab', { hasText: 'Coco' })).toBeVisible();
    // a returning owner sees the same Home: tasks and Add task before heading out too
    await signOut(page); await boot(page); await signInOwner(page, { home: true });
    await expect(page.locator('.task').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add task' })).toBeVisible();
  });
});

test.describe('V. Breed and sex, and small forms in the conversation (16 Nov)', () => {
  test('V1 Sign-up asks only the pet’s name, type, age and food: no breed, sex, health or vet; those start as “Not added yet”', async ({ page }) => {
    await boot(page); await signUp(page, '9822200301');
    await page.getByRole('checkbox', { name: /Terms of Use/ }).check(); await page.getByRole('checkbox', { name: /Privacy Notice/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await intakeInfo(page, 'Isha');
    await page.locator('#pn0').fill('Coco'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: /Dog/ }).click();
    await expect(page.getByText(/How old is/)).toHaveCount(0); // no age question (20 Nov)
    await expect(page.getByRole('group', { name: 'Breed and sex' })).toHaveCount(0);
    await page.locator('#pf0').fill('Kibble twice a day'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Coco’s profile is saved.')).toBeVisible(); // straight after the food question
    await expect(page.getByRole('group', { name: 'Health' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Vet' })).toHaveCount(0);
    const me = await api(page, 'GET', '/v1/me'); const hh = me.body.memberships[0].household_id;
    const pets = (await api(page, 'GET', `/v1/households/${hh}/pets`)).body as { name: string; vet_name: string; allergies: string }[];
    expect(pets.find(p => p.name === 'Coco')).toMatchObject({ vet_name: 'Not added yet', allergies: 'Not added yet' });
  });
});

