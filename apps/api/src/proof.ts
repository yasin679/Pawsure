/**
 * Proof from the app (16 Nov 2026): helpers, friends and backups send a photo of the bowl or pet and/or today's code
 * from the card in the food box. One place stores the photo, checks the code and records the evidence, so every
 * route grades proof the same way as WhatsApp:
 *   photo + today's code → strong · code only → weak · photo without a code → weak · old or wrong code → flagged
 *   nothing → "said done, no proof" on the task history, never counted as evidence.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { uid, type Db } from '@pawsure/db';
import { checkCode, type CodeCard } from '@pawsure/domain';
import { ingestSignal } from './care.js';
import { istDate } from './clock.js';
import { open } from './secrets.js';

/** A compressed photo as a data URL (the phone shrinks it first). */
export const ProofIn = z.object({
  photo: z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Send the photo as an image.').max(62000, 'That photo is too large. Try again.').nullable().optional(),
  code: z.string().trim().regex(/^\d{4}$/, 'Today’s code has 4 digits.').nullable().optional()
});
/** mediaRef: a photo that arrived on WhatsApp (stored by the provider, not here). */
export type Proof = z.infer<typeof ProofIn> & { mediaRef?: string | null };

export async function codeCards(db: Db, hh: string, now: Date): Promise<CodeCard[]> {
  const rows = await db.query<{ codes_encrypted: string; active: boolean; month: string; version: number }>(`select * from code_cards where household_id=$1 and month=$2`, [hh, istDate(now).slice(0, 7)]);
  return rows.map(r => ({ householdId: hh, month: r.month, version: r.version, active: r.active, codes: open<Record<number, string>>(r.codes_encrypted) }));
}

export interface ProofResult { photo: boolean; code: 'today' | 'old' | 'wrong' | 'none'; grade: 'strong' | 'weak' | 'flagged' | 'none'; duplicate?: boolean }

/** Record proof for one task. `key` makes repeats (double tap, retry) count once. */
export async function recordProof(db: Db, p: { householdId: string; taskId: string; actor: string; channel: string; proof: Proof; now: Date; key: string }): Promise<ProofResult> {
  const t = (await db.query<{ care_date: string }>(`select care_date::text as care_date from care_tasks where id=$1 and household_id=$2`, [p.taskId, p.householdId]))[0];
  if (!t) throw new Error('unknown_task');
  const code = p.proof.code ? checkCode(await codeCards(db, p.householdId, p.now), Number(t.care_date.slice(8, 10)), p.proof.code) : 'none';
  const flagged = code === 'old' || code === 'wrong';
  if (p.proof.photo || p.proof.mediaRef) {
    const hash = createHash('sha256').update(p.proof.photo ?? p.proof.mediaRef!).digest('hex');
    const r = await ingestSignal(db, { householdId: p.householdId, idempotencyKey: p.key, kind: 'photo', taskId: p.taskId, channel: p.channel, photoCode: code, imageHash: hash, eventTime: p.now, receivedTime: p.now, actor: p.actor });
    await db.query(`insert into evidence_photos(id, household_id, task_id, data_url, image_hash, code_result, actor, channel, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [uid('ph'), p.householdId, p.taskId, p.proof.photo ?? null, hash, code, p.actor, p.channel, p.now.toISOString()]);
    const duplicate = !!(r as { duplicateImage?: boolean }).duplicateImage;
    return { photo: true, code, duplicate, grade: duplicate ? 'none' : flagged ? 'flagged' : code === 'today' ? 'strong' : 'weak' };
  }
  if (p.proof.code) {
    await ingestSignal(db, { householdId: p.householdId, idempotencyKey: p.key, kind: 'ivr', taskId: p.taskId, channel: p.channel, codeOk: code === 'today', registeredNumber: true, eventTime: p.now, receivedTime: p.now, actor: p.actor });
    return { photo: false, code, grade: code === 'today' ? 'weak' : 'flagged' };
  }
  await db.query(`insert into task_events(task_id, household_id, state, actor, note) values ($1,$2,'Done reported',$3,'Said done, no photo or code')`, [p.taskId, p.householdId, p.actor]).catch(() => undefined);
  return { photo: false, code: 'none', grade: 'none' };
}

/** What the person is told after sending, in plain words. */
export const proofMessage = (r: ProofResult) =>
  r.duplicate ? 'That photo was sent before, so it doesn’t count again. Please take a new one.'
  : r.grade === 'strong' ? 'Thank you! Photo and today’s code received.'
  : r.grade === 'flagged' ? 'That code isn’t today’s. Check the card in the food box. The owner will see it didn’t match.'
  : r.photo ? 'Photo received. Add today’s code from the food box next time to make it complete.'
  : r.code === 'today' ? 'Today’s code received. A photo next time makes it complete.'
  : 'Marked done without proof. The owner will see there was no photo or code.';
