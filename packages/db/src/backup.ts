/**
 * Encrypted backups and restore verification (master prompt §9 "encrypted backups and tested restore; document RPO/RTO").
 * Local/pilot-on-PGlite: a gzipped data-directory snapshot sealed with AES-256-GCM (BACKUP_KEY, 32 bytes, hex or base64).
 * Managed PostgreSQL: use the provider's point-in-time recovery plus a nightly encrypted pg_dump; run the same verification
 * (`verifyRestore`) against the restored instance. See docs/runbooks/restore.md.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import type { Db } from './index.js';

const MAGIC = Buffer.from('PSBK1');

export function backupKey(raw = process.env.BACKUP_KEY ?? ''): Buffer {
  const k = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('BACKUP_KEY must be 32 bytes (64 hex characters or base64)');
  return k;
}

/** Seal a snapshot: MAGIC | iv(12) | tag(16) | ciphertext. */
export function seal(plain: Uint8Array, key: Buffer): Buffer {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(MAGIC);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}
export function unseal(sealed: Buffer, key: Buffer): Buffer {
  if (!sealed.subarray(0, 5).equals(MAGIC)) throw new Error('not a Pawsure backup');
  const iv = sealed.subarray(5, 17), tag = sealed.subarray(17, 33), d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(MAGIC); d.setAuthTag(tag);
  return Buffer.concat([d.update(sealed.subarray(33)), d.final()]); // throws if tampered or wrong key
}

export async function backup(db: Db, key: Buffer): Promise<{ data: Buffer; sha256: string; bytes: number }> {
  if (!db.dump) throw new Error('Use the managed PostgreSQL backup (PITR + pg_dump) for DATABASE_URL deployments');
  const data = seal(await db.dump(), key);
  return { data, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length };
}

/** Row counts for every table plus the latest audit id: the fingerprint compared after a restore. */
export async function fingerprint(db: Db): Promise<Record<string, number>> {
  const tables = await db.query<{ t: string }>(`select table_name as t from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`);
  const out: Record<string, number> = {};
  for (const { t } of tables) out[t] = (await db.query<{ n: number }>(`select count(*)::int as n from "${t}"`))[0]!.n;
  out['audit_log.max_id'] = Number((await db.query<{ m: string | null }>(`select max(id)::text as m from audit_log`))[0]?.m ?? 0);
  return out;
}

export async function verifyRestore(source: Record<string, number>, restored: Db) {
  const got = await fingerprint(restored);
  const mismatches = Object.keys({ ...source, ...got }).filter(k => source[k] !== got[k]).map(k => ({ table: k, expected: source[k] ?? null, restored: got[k] ?? null }));
  // The restored copy must still refuse audit-log edits (append-only trigger survives the restore). A probe row is
  // written so the check works even on an empty log; the restored database is a throwaway copy, not production.
  let appendOnly = false;
  const probe = (await restored.query<{ id: string }>(`insert into audit_log(actor, action, detail) values ('restore-drill','drill.probe','{}') returning id::text`))[0]!.id;
  try { await restored.query(`update audit_log set action='tampered' where id=$1`, [probe]); } catch { appendOnly = true; }
  return { ok: mismatches.length === 0 && appendOnly, mismatches, appendOnly, tables: Object.keys(got).length };
}
