/**
 * In-browser demo backend: the real Pawsure API (Hono) and database (PGlite, PostgreSQL in WebAssembly) running in the
 * visitor's own browser, seeded with the demo household. Nothing leaves the browser; every visitor gets their own copy,
 * kept between visits in this browser until "Reset demo". Vendors are the same mock adapters the server uses in demo mode.
 */
import { openDb, migrate, seedDemo, DEMO, type MigrationSource } from '@pawsure/db';
import { createApp } from '../../../api/src/app';
import { mockAdapters } from '../../../api/src/adapters';
import { demoClock } from '../../../api/src/clock';
// PGlite's file-system bundle (postgres.data) is copied next to the page as pglite-fs.wasm after the build (npm run build:demo) because artifact
// hosting only serves standard web file types. It is raw bytes either way; PGlite takes it as a Blob.
const fsBundleUrl = new URL('pglite-fs.wasm', document.baseURI).href;

const files = import.meta.glob('../../../../packages/db/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const MIGRATIONS: MigrationSource[] = Object.entries(files).map(([path, sql]) => ({ name: path.split('/').pop()!, sql }));

export const DEMO_DB = 'pawsure-demo';
/** Deletes this browser's copy of the demo (database and sign-ins) so the next load starts fresh. */
export async function resetDemo() {
  try { localStorage.removeItem('pawsure.session'); localStorage.removeItem('pawsure.staff.session'); } catch { /* storage blocked */ }
  const names = (await indexedDB.databases?.().catch(() => [])) ?? [];
  await Promise.all(names.filter(d => d.name?.includes(DEMO_DB)).map(d => new Promise(res => { const r = indexedDB.deleteDatabase(d.name!); r.onsuccess = r.onerror = r.onblocked = () => res(null); })));
}

export async function start() {
  const fsBundle = await fetch(fsBundleUrl).then(r => { if (!r.ok) throw new Error('database files did not load'); return r.blob(); });
  // Kept in this browser (IndexedDB), so a reload, full screen or a new version of the page keeps your account and home.
  // Falls back to memory only where the browser blocks storage. "Reset demo" in the demo tools starts over.
  let db = await openDb({ dataDir: 'memory', pglite: { fsBundle, dataDir: 'idb://' + DEMO_DB, relaxedDurability: true } });
  try { await db.query('select 1'); } catch { db = await openDb({ dataDir: 'memory', pglite: { fsBundle } }); }
  await migrate(db, MIGRATIONS);
  await seedDemo(db);
  // The product owner's own number logs straight into the demo home as a co-owner (no onboarding).
  // Demo build only: the server's seed and its tests are unchanged. Every other new number goes through sign-up.
  await db.query(`insert into users(id, phone_e164, display_name, language) values ('u_demo_owner', '+918860750239', 'Owner', 'en') on conflict do nothing`);
  await db.query(`insert into memberships(id, household_id, user_id, role, status, accepted_at) values ('m_demo_owner', $1, 'u_demo_owner', 'co_owner', 'active', now()) on conflict do nothing`, [DEMO.household]);
  const app = createApp({ db, adapters: mockAdapters(), clock: demoClock('2026-11-06T09:00:00+05:30', { live: true }), pepper: 'demo-pepper-not-secret', demoMode: true });
  await app.request('/jobs/tick', { method: 'POST' });
  return app;
}
