/** Fictional demo data for local development and tests. Never load into production. */
import type { Db } from './index.js';

export const DEMO = { household: 'hh_demo', owner: 'u_neha', ownerPhone: '+919800000021' } as const;

export async function seedDemo(db: Db) {
  const q = (s: string, p: unknown[] = []) => db.query(s, p);
  const exists = await db.query('select 1 from households where id=$1', [DEMO.household]);
  if (exists.length) return false;
  await q(`insert into households(id, society, tower, flat_private, access_note_private, gate_app, rewards_arm) values ($1,'Lake Vista CHS, Powai','Tower B','B-1104','Spare key with Ankita (backup)', true, true)`, [DEMO.household]);
  const users: [string, string, string, string][] = [
    ['u_neha', '+919800000021', 'Neha Kulkarni', 'en'], ['u_rohan', '+919800000022', 'Rohan Kulkarni', 'en'], ['u_ankita', '+919700000008', 'Ankita Joshi', 'en'],
    ['u_sunita', '+919000000035', 'Sunita Pawar', 'mr'], ['u_priya', '+919900000012', 'Priya Shah', 'en'], ['u_arjun', '+919800000077', 'Arjun Mehta', 'hi'],
    ['u_kavya', '+919600000045', 'Kavya Iyer', 'en'], ['u_meera', '+919700000090', 'Meera Joshi', 'mr'], ['u_farhan', '+919500000031', 'Farhan Sheikh', 'en']
  ];
  for (const u of users) await q('insert into users(id, phone_e164, display_name, language) values ($1,$2,$3,$4)', u);
  const mem: [string, string, string, boolean][] = [['m_neha', 'u_neha', 'owner', false], ['m_rohan', 'u_rohan', 'co_owner', false], ['m_ankita', 'u_ankita', 'backup', true], ['m_sunita', 'u_sunita', 'helper', false]];
  for (const [id, u, role, addr] of mem) await q(`insert into memberships(id, household_id, user_id, role, status, backup_address_authorised, accepted_at, method, display_label) values ($1,$2,$3,$4,'active',$5, now(),$6,$7)`, [id, DEMO.household, u, role, addr, role === 'helper' ? 'photo' : null, role === 'helper' ? 'Sunita' : null]);
  await q(`insert into consent_records(id, user_id, household_id, kind, version, language, granted, scope) values ('c1','u_neha',$1,'terms','T-1.0','en',true,null),('c2','u_neha',$1,'privacy','PN-1.0','en',true,null),('c3','u_sunita',$1,'helper_monitoring','W1-1.0','mr',true,'{"methods":["photo","voice","ivr"]}')`, [DEMO.household]);
  await q(`insert into pets(id, household_id, name, species, breed, age, size, food, allergies, medicines, fears, notes, vet_name, vet_phone, clinic24_name, clinic24_phone, backup_name, backup_phone) values
    ('bruno',$1,'Bruno','Dog','Indie mix','4 years','Medium (18 kg)','1 cup kibble + curd rice at lunch','Chicken (owner-reported)','Joint supplement — 1 chewable with lunch, as on the vet’s card','Pressure-cooker whistle, thunder','Lift is fine','Dr. Aarti Deshmukh, Powai Pet Clinic','+91 22 5555 4410','Mumbai 24x7 Animal Hospital, Andheri','+91 22 5555 9900','Ankita (sister)','+91 97000 00008'),
    ('misty',$1,'Misty','Cat','Indian shorthair','2 years','Small','Wet food sachet at 1 PM','None known','None','Hides under the bed with visitors','Keep balcony door closed','Dr. Aarti Deshmukh, Powai Pet Clinic','+91 22 5555 4410','Mumbai 24x7 Animal Hospital, Andheri','+91 22 5555 9900','Ankita (sister)','+91 97000 00008')`, [DEMO.household]);
  const routine: [string, string, string, string, number, number, string, string][] = [
    ['r1', 'bruno', 'Lunch + fresh water', 'feeding', 780, 5, 'standard', 'v1'], ['r2', 'bruno', 'Joint supplement', 'medicine', 780, 3, 'medicine', 'v1'],
    ['r3', 'misty', 'Wet food + litter tray', 'litter', 780, 3, 'standard', 'v1'], ['r4', 'bruno', 'Toilet pad change + water top-up', 'toilet', 960, 3, 'standard', 'v2']
  ];
  for (const [id, pet, title, type, due, min, prof, slot] of routine) await q(`insert into routine_tasks(id, household_id, pet_id, title, task_type, due_minute, min_minutes, escalation_profile, visit_slot, assignee_membership_id, effective_from) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'m_sunita','2026-11-01')`, [id, DEMO.household, pet, title, type, due, min, prof, slot]);
  const friends: [string, boolean, boolean, number, unknown, unknown, string, number, number][] = [
    ['u_priya', true, false, 0, [[990, 1260]], { feed: true, walk: true }, 'handover', 6, 5], ['u_arjun', true, false, 1, [[1020, 1320]], { feed: true, walk: true, meds: true, large: true }, 'handover', 3, 3],
    ['u_kavya', true, false, 3, [[900, 1200]], { feed: true, walk: true, large: true }, 'handover', 12, 11], ['u_meera', true, false, 1, [[600, 1080]], { feed: true }, 'yes', 2, 2],
    ['u_farhan', true, true, 0, [[1080, 1320]], { feed: true, walk: true }, 'no', 4, 3]
  ];
  for (const [u, disc, paused, band, win, caps, key, helps, checked] of friends) {
    await q(`insert into friend_profiles(user_id, discoverable, paused, windows, capabilities, key_mode) values ($1,$2,$3,$4,$5,$6)`, [u, disc, paused, JSON.stringify(win), JSON.stringify(caps), key]);
    await q(`insert into friend_links(household_id, friend_user_id, status, distance_band, help_count, checked_in_count) values ($1,$2,'accepted',$3,$4,$5)`, [DEMO.household, u, band, helps, checked]);
  }
  await q("update pets set pronoun='him' where id='bruno'"); await q("update pets set pronoun='her' where id='misty'");
  // Phase 3 friend network extras: response bands, an invited-but-not-opted-in friend, and one who is free only later.
  for (const [u, band] of [['u_priya', 'Usually replies within 10 min'], ['u_arjun', 'Usually replies in 10–20 min'], ['u_kavya', 'Usually replies within 10 min'], ['u_meera', 'Usually replies in 20–30 min'], ['u_farhan', 'Usually replies within 10 min']]) await q('update friend_profiles set response_band=$2 where user_id=$1', [u, band]);
  await q(`insert into users(id, phone_e164, display_name, language) values ('u_rahul','+919300000002','Rahul Nair','en'),('u_dev','+919100000064','Dev Patel','en')`);
  await q(`insert into friend_profiles(user_id, discoverable, windows, capabilities, key_mode, response_band) values ('u_rahul', true, '[[1140,1320]]', '{"feed":true,"walk":true}', 'handover', 'No requests yet')`);
  await q(`insert into friend_links(household_id, friend_user_id, status, distance_band, help_count, checked_in_count) values ($1,'u_rahul','accepted',2,0,0),($1,'u_dev','invited',null,0,0)`, [DEMO.household]);
  // Phase 4: pilot staff (fictional) and a little earned-points history for Sunita.
  await q(`insert into users(id, phone_e164, display_name) values ('u_ops','+919811000001','Ops on shift (demo)'),('u_lead','+919811000002','Ops lead (demo)'),('u_priv','+919811000003','Privacy lead (demo)'),('u_audit','+919811000004','Auditor (demo)')`);
  await q(`insert into staff_roles(user_id, role) values ('u_ops','ops'),('u_lead','ops_lead'),('u_priv','privacy_lead'),('u_audit','auditor')`);
  await q(`insert into reward_ledger(id, helper_user_id, household_id, points, state, reason, month, created_at, expires_at) values
    ('rw_s1','u_sunita',$1,60,'earned','Confirmed/Likely tasks 1–5 Nov','2026-11','2026-11-05','2027-05-05'),
    ('rw_s2','u_sunita',$1,85,'earned','October tasks','2026-10','2026-10-31','2027-04-30')`, [DEMO.household]);
  await q(`insert into health_events(id, household_id, pet_id, kind, label, given_on, next_due, source) values
    ('h1',$1,'bruno','vaccine','Vaccine booster (DHPPi + Lepto)','2025-11-12','2026-11-12','Copied from vet card'),
    ('h2',$1,'bruno','deworming','Deworming','2026-08-06','2026-11-06','Vet instruction (owner-entered)'),
    ('h3',$1,'misty','vaccine','Rabies vaccine','2025-10-03','2026-10-29','Copied from vet card')`, [DEMO.household]);
  const flags: [string, unknown, boolean, string][] = [
    ['helperRewards', 'cohort', false, 'PS-126: ON for 10 of 20 homes'], ['helperShareRecord', false, false, 'PS-104: OFF at start'],
    ['nearbyMemberFallback', false, true, 'PS-062: OFF until ID-check approved'], ['friendThankYouPoints', false, false, 'PS-107: OFF until funding'],
    ['ownerCameraLookIn', false, false, 'PS-008/PS-037: OFF'], ['dayCare', false, true, 'P1'], ['verifiedCarers', false, true, 'P2']
  ];
  for (const [k, v, locked, note] of flags) await q('insert into feature_flags(key, default_value, locked, note) values ($1,$2,$3,$4) on conflict do nothing', [k, JSON.stringify(v), locked, note]);
  // v1.1.0 cover continuity (fictional): ordered backup list, handling notes, urgency, the owner's own evening tasks.
  await q(`update households set standing_backup_approval=true, cluster='Powai · Lake Vista CHS' where id=$1`, [DEMO.household]);
  await q(`update routine_tasks set urgency = case task_type when 'medicine' then 'MustHappen' when 'walk' then 'CanWait' else 'TimeSensitive' end where household_id=$1`, [DEMO.household]);
  await q(`update pets set handling_note='Nervous with strangers for the first minute: let him sniff your hand. Slips out at the main door, so close it before unclipping the lead. Pulls on the lead near the gate.' where id='bruno'`);
  await q(`update pets set handling_note='Hides under the bed with visitors. Do not chase her. Keep the balcony door closed.' where id='misty'`);
  const backups: [string, string | null, string, string, string, number, string, boolean, boolean, boolean, boolean][] = [
    ['bk_desai', null, 'Mrs Desai', '+919800000040', 'en', 1, 'Neighbour · B-1102', true, false, false, false],
    ['bk_ritu', null, 'Ritu Kulkarni', '+919800000011', 'mr', 2, 'Family (mother-in-law)', false, false, false, false],
    ['bk_ankita', 'u_ankita', 'Ankita Joshi', '+919700000008', 'en', 3, 'Family (sister)', true, false, false, true],
    ['bk_rohan', 'u_rohan', 'Rohan Kulkarni', '+919800000022', 'en', 4, 'Co-owner', true, true, false, true],
    ['bk_vikram', null, 'Vikram (dog walker)', '+919600000073', 'hi', 5, 'Own paid walker or sitter', false, false, true, true]
  ];
  for (const b of backups) await q(`insert into backup_contact(id, household_id, user_id, name, phone_e164, language, rank, relationship, holds_key, can_give_medicine, owner_arranged, cared_before) values ($1,'${DEMO.household}',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, b);
  await q(`insert into routine_tasks(id, household_id, pet_id, title, task_type, due_minute, min_minutes, escalation_profile, visit_slot, assignee_membership_id, effective_from, urgency, owner_task, instructions) values
    ('r5',$1,'bruno','Evening walk','walk',1170,15,'walk','e1','m_neha','2026-11-01','CanWait',true,'Short walk in the society garden. Lead on before the door opens.'),
    ('r6',$1,'bruno','Dinner + water','feeding',1230,10,'standard','e2','m_neha','2026-11-01','TimeSensitive',true,'1 cup kibble. Refill the water bowl.')`, [DEMO.household]);
  await q(`update routine_tasks set instructions = case id when 'r1' then '1 cup kibble + curd rice. Refill the water bowl.' when 'r2' then '1 chewable with lunch, as on the vet’s card.' when 'r3' then 'One sachet. Scoop the tray. Keep the balcony door shut.' when 'r4' then 'Pads are under the sink.' else instructions end where household_id=$1`, [DEMO.household]);
  return true;
}
