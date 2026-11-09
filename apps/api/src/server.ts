import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { Hono } from 'hono';
import { openDb, migrate } from '@pawsure/db';
import { seedDemo } from '@pawsure/db';
import { createApp } from './app.js';
import { mockAdapters } from './adapters.js';
import { demoClock, systemClock } from './clock.js';

const demoMode = process.env.DEMO_MODE !== '0' && process.env.NODE_ENV !== 'production';
const db = await openDb({ url: process.env.DATABASE_URL, dataDir: process.env.PGLITE_DIR ?? '.data/pglite' });
const applied = await migrate(db);
if (demoMode) await seedDemo(db);
const clock = demoMode ? demoClock(process.env.DEMO_START ?? '2026-11-06T09:00:00+05:30') : systemClock;
const pepper = process.env.OTP_PEPPER ?? (demoMode ? 'demo-pepper-not-secret' : '');
if (!pepper) throw new Error('OTP_PEPPER must be set outside demo mode');

const root = new Hono();
root.use('*', cors({ origin: (o) => (demoMode || (process.env.WEB_ORIGIN ?? '').split(',').includes(o) ? o : ''), allowHeaders: ['authorization', 'content-type'] }));
root.route('/', createApp({ db, adapters: mockAdapters(), clock, pepper, demoMode }));
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: root.fetch, port });
console.log(`Pawsure API on http://localhost:${port} · db=${db.kind} · demoMode=${demoMode} · migrations applied: ${applied.join(', ') || 'none'}`);
