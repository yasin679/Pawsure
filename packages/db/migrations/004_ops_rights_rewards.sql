-- Phase 4: operations console, privacy rights, rewards.

-- Staff are users with a staff role; role-limited and every view logged (PS-070).
create table staff_roles (
  user_id text primary key references users(id),
  role text not null check (role in ('ops','ops_lead','privacy_lead','tech_lead','auditor')),
  active boolean not null default true,
  granted_at timestamptz not null default now()
);

alter table households add column cohort text not null default 'pilot-1';
alter table reward_ledger add column decided_at timestamptz;
alter table reward_ledger add column decided_by text;
alter table reward_ledger add column decision_note text;
create unique index reward_ledger_task_earned on reward_ledger(task_id, state) where state in ('earned','held');

-- Helper-owned shareable record (PS-104, switch OFF): counts only, revocable.
create table share_links (
  id text primary key,
  helper_user_id text not null references users(id),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Rights requests get a target (7 days) and legal limit (90 days), resolution and reply.
alter table rights_requests add column legal_due_at timestamptz;
alter table rights_requests add column detail text;
alter table rights_requests add column reply text;
alter table rights_requests add column handled_by text;

-- Breach runbook (PS-120): readiness checklist and rehearsals / incidents with the 72 h Board clock.
create table breach_checklist (
  item text primary key,
  done boolean not null default false,
  done_by text, done_at timestamptz
);
create table breach_events (
  id text primary key,
  kind text not null check (kind in ('rehearsal','incident')),
  aware_at timestamptz not null,
  board_due_at timestamptz not null,
  users_notified_at timestamptz,
  board_reported_at timestamptz,
  closed_at timestamptz,
  summary text
);
insert into breach_checklist(item) values
 ('Runbook owners named (privacy lead + tech lead)'), ('Contact list for affected users ready'), ('User notice templates in en/hi/mr'),
 ('Data Protection Board report template (72 h)'), ('Vendor security contacts (WhatsApp, IVR, OTP, LLM, hosting)'), ('Log preservation steps tested'), ('Rehearsal held before pilot');
