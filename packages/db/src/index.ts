/**
 * Database access. Production: managed PostgreSQL via DATABASE_URL (node-postgres).
 * Local/dev/test: PGlite (PostgreSQL compiled to WASM) so no Docker or server is needed.
 */
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'pglite' | 'postgres';
  /** PGlite only: a gzipped tarball of the data directory (backups and restore drills). */
  dump?: () => Promise<Uint8Array>;
}

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '..', 'migrations');

export async function openDb(opts: { url?: string; dataDir?: string; loadFrom?: Uint8Array } = {}): Promise<Db> {
  if (opts.url) {
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString: opts.url });
    const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Db => ({
      kind: 'postgres',
      query: async <T>(s: string, p?: unknown[]) => (await c.query(s, p)).rows as T[],
      tx: async (fn) => { const client = await pool.connect(); try { await client.query('begin'); const r = await fn(wrap(client)); await client.query('commit'); return r; } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); } },
      close: async () => { await pool.end(); }
    });
    return wrap(pool);
  }
  const { PGlite } = await import('@electric-sql/pglite');
  if (opts.dataDir && opts.dataDir !== 'memory') mkdirSync(opts.dataDir, { recursive: true });
  const dir = opts.dataDir && opts.dataDir !== 'memory' ? opts.dataDir : undefined;
  // Options-object form: the positional (dir, opts) form ignores loadDataDir in PGlite 0.2.
  const lite = opts.loadFrom ? new PGlite({ dataDir: dir, loadDataDir: new Blob([opts.loadFrom as unknown as BlobPart], { type: 'application/x-gzip' }) }) : new PGlite(dir);
  const make = (q: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }, root: boolean): Db => ({
    kind: 'pglite',
    query: async <T>(s: string, p?: unknown[]) => (await q.query(s, p)).rows as T[],
    tx: root ? async (fn) => lite.transaction(async (t) => fn(make(t, false))) : async (fn) => fn(make(q, false)),
    close: async () => { await lite.close(); },
    dump: async () => new Uint8Array(await (await lite.dumpDataDir('gzip')).arrayBuffer())
  });
  return make(lite, true);
}

export async function migrate(db: Db): Promise<string[]> {
  const applied: string[] = [];
  await db.query('create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ version: string }>('select version from schema_migrations')).map(r => r.version));
  for (const f of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8').replace(/create table schema_migrations[^;]*;/i, '');
    await db.tx(async (t) => {
      for (const stmt of splitSql(sql)) await t.query(stmt);
      await t.query('insert into schema_migrations(version) values ($1)', [f]);
    });
    applied.push(f);
  }
  return applied;
}

/** Splits on semicolons outside $$-quoted bodies. */
export function splitSql(sql: string): string[] {
  const out: string[] = []; let cur = '', inDollar = false;
  for (const line of sql.split('\n')) {
    const l = line.replace(/--.*$/, '');
    const n = (l.match(/\$\$/g) || []).length; if (n % 2 === 1) inDollar = !inDollar;
    cur += l + '\n';
    if (!inDollar && /;\s*$/.test(l)) { out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

export const uid = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
export { seedDemo, DEMO } from './seed.js';
export * from './backup.js';
