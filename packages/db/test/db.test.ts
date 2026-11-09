import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate, type Db } from '../src/index.js';
import { seedDemo } from '../src/seed.js';

let db: Db;
beforeAll(async () => { db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db); }, 60000);

describe('schema', () => {
  it('migrates and seeds the demo household', async () => {
    expect((await db.query('select count(*)::int as n from pets'))[0]).toEqual({ n: 2 });
  });
  it('audit log is append-only', async () => {
    await db.query(`insert into audit_log(actor, action) values ('test','x')`);
    await expect(db.query(`update audit_log set action='y'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from audit_log`)).rejects.toThrow(/append-only/);
  });
  it('duplicate inbound signals are rejected by idempotency key', async () => {
    const ins = () => db.query(`insert into checkin_signals(id, household_id, kind, channel, event_time, idempotency_key) values ($1,'hh_demo','call_arrive','ivr', now(), 'ivr:call:123')`, ['s' + Math.random()]);
    await ins();
    await expect(ins()).rejects.toThrow(/duplicate key/);
  });
  it('a helper can belong to two households with separate memberships', async () => {
    await db.query(`insert into households(id, society) values ('hh_other','Hill View CHS, Powai')`);
    await db.query(`insert into memberships(id, household_id, user_id, role, status) values ('m_sunita2','hh_other','u_sunita','helper','active')`);
    const r = await db.query<{ n: number }>(`select count(*)::int as n from memberships where user_id='u_sunita'`);
    expect(r[0]!.n).toBe(2);
  });
});
