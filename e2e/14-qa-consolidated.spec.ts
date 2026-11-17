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

  test('R2 PAW-018/036 sign-up asks for the state and city first; Pune and Mumbai list their own Lake Vista CHS', async ({ page }) => {
    await signUp(page, '9822200077');
    await page.getByRole('checkbox', { name: /Terms of Use/ }).check(); await page.getByRole('checkbox', { name: /Privacy Notice/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Your information', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await aboutYou(page, 'Isha');
    await page.getByRole('button', { name: 'Choose manually' }).click();
    await pick(page, 'stt', 'Maharashtra');
    await pick(page, 'cty', 'Pune');
    await page.locator('#soc').click();
    await expect(page.getByRole('option', { name: 'Lake Vista CHS · Baner' })).toHaveCount(1);
    await expect(page.getByRole('option', { name: /Powai/ })).toHaveCount(0);
    await page.getByRole('option', { name: 'Lake Vista CHS · Baner' }).click();
    await expect(page.locator('#tw')).toBeVisible(); // the same form moves on to the tower
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
    await fresh.evaluate(() => localStorage.removeItem('pawsure.demoTools'));
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
  test('S1 A typed city in another state is caught at the city question, and the home is created after fixing the state', async ({ page }) => {
    await boot(page); await signUp(page, '9822200099');
    await page.getByRole('checkbox', { name: /Terms of Use/ }).check(); await page.getByRole('checkbox', { name: /Privacy Notice/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    const next = () => page.getByRole('button', { name: 'Next', exact: true }).click();
    await aboutYou(page, 'Isha');
    await page.getByRole('button', { name: 'Choose manually' }).click();
    await pick(page, 'stt', 'Karnataka');
    await page.getByRole('button', { name: 'My city isn’t listed' }).click();
    await page.locator('#ctt').fill('Mumbai');
    await expect(page.getByText(/Mumbai is in Maharashtra, not Karnataka/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Back', exact: true }).click(); // back to the state, inside the same form
    await pick(page, 'stt', 'Maharashtra');
    await pick(page, 'cty', 'Mumbai');
    await page.getByRole('button', { name: 'My society isn’t listed' }).click();
    await page.locator('#sct').fill('12345');
    await expect(page.getByText('Enter your society’s name, not just numbers.')).toBeVisible();
    await page.locator('#sct').fill('Green Acres CHS'); await next();
    await page.getByRole('button', { name: 'Skip', exact: true }).click(); await page.getByRole('button', { name: 'Skip', exact: true }).click();
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
  test('T1 The society, city and state are found from the location; Yes skips those questions', async ({ page }) => {
    await start(page, '9822200101');
    await expect(page.getByText('Is this home?')).toBeVisible();
    await expect(page.locator('.cb-sum').last()).toContainText('Lake Vista CHS, Powai');
    await expect(page.locator('.cb-sum').last()).toContainText('Mumbai');
    await expect(page.locator('.cb-sum').last()).toContainText('Maharashtra');
    await page.getByRole('button', { name: 'Yes, that’s home' }).click();
    await expect(page.getByRole('button', { name: /Change: 📍 Lake Vista CHS, Powai/ })).toBeVisible();
    await expect(page.locator('#tw')).toBeVisible(); // straight to the tower question
    await expect(page.locator('#stt')).toHaveCount(0);
  });
  test('T2 Change keeps the suggestion filled in and lets the owner pick another society', async ({ page }) => {
    await start(page, '9822200102');
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await expect(page.locator('#stt')).toContainText('Maharashtra'); // already filled in
    await pick(page, 'stt', 'Maharashtra'); await pick(page, 'cty', 'Mumbai');
    await page.locator('#soc').click(); await page.getByRole('option', { name: 'Hiranandani Gardens · Powai' }).click();
    await page.getByRole('button', { name: 'Skip', exact: true }).click(); await page.getByRole('button', { name: 'Skip', exact: true }).click();
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
    await page.getByRole('button', { name: 'Skip', exact: true }).click(); await page.getByRole('button', { name: 'Female', exact: true }).click();
    await page.getByRole('button', { name: '1–3 years' }).click();
    await page.getByRole('button', { name: 'Speak your answer' }).click();
    await expect(page.locator('#pf0')).toHaveValue('Two cups of rice and curd at lunch');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Change: Two cups of rice and curd at lunch' })).toBeVisible();
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
    await expect(card.getByRole('button', { name: 'My help can’t come' })).toBeVisible();
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
});

test.describe('V. Breed and sex, and small forms in the conversation (16 Nov)', () => {
  test('V1 Breed and sex are one question; the answers show as one reply and are saved on the pet', async ({ page }) => {
    await boot(page); await signUp(page, '9822200301');
    await page.getByRole('checkbox', { name: /Terms of Use/ }).check(); await page.getByRole('checkbox', { name: /Privacy Notice/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await intakeInfo(page, 'Isha');
    await page.locator('#pn0').fill('Coco'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: /Dog/ }).click();
    const form = page.getByRole('group', { name: 'Breed and sex' });
    await expect(form).toContainText('1 of 2');
    await form.locator('#pb0').fill('Golden Retriever'); await form.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(form).toContainText('2 of 2');
    await form.getByRole('button', { name: 'Back' }).click();
    await expect(form.locator('#pb0')).toHaveValue('Golden Retriever');
    await form.getByRole('button', { name: 'Next', exact: true }).click(); await form.getByRole('button', { name: 'Female', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Change: Golden Retriever · Female' })).toBeVisible();
    await page.getByRole('button', { name: '1–3 years' }).click();
    await page.locator('#pf0').fill('Kibble twice a day'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: 'None known', exact: true }).click(); await page.getByRole('button', { name: 'None', exact: true }).click();
    await page.locator('#pv0').fill('Dr. Rao'); await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.locator('#pp0').fill('+91 22 5555 0101'); await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Coco’s profile is saved.')).toBeVisible();
    const me = await api(page, 'GET', '/v1/me'); const hh = me.body.memberships[0].household_id;
    const pets = (await api(page, 'GET', `/v1/households/${hh}/pets`)).body as { name: string; breed: string; sex: string }[];
    expect(pets.find(p => p.name === 'Coco')).toMatchObject({ breed: 'Golden Retriever', sex: 'Female' });
  });
});

