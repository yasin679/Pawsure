-- Phase 2: daily care and helper channels.

alter table households add column out_from int not null default 540;   -- usual leave time (minutes, IST)
alter table households add column out_to int not null default 1140;    -- usual return time

-- One row per household per IST day: who is caring, leaving checklist, return check, trusted tap.
create table day_states (
  household_id text not null references households(id),
  care_date date not null,
  mode text not null default 'tracked' check (mode in ('tracked','trusted','uncovered','friend')),
  helper_unavailable boolean not null default false,
  unavailable_reason text,
  leaving jsonb,
  left_at timestamptz,
  return_at int,
  back_at timestamptz,
  return_check jsonb,
  trusted_covered_at timestamptz,
  primary key (household_id, care_date)
);

-- Helper channel state, per household (consent is per household; PS-029).
alter table memberships add column method text check (method in ('photo','voice','ivr'));
alter table memberships add column paused boolean not null default false;
alter table memberships add column invite_language text;
alter table memberships add column display_label text;

-- Helper WhatsApp conversation log (what was sent/received; templates only, PS-118).
create table helper_messages (
  id text primary key,
  household_id text not null references households(id),
  membership_id text not null references memberships(id),
  direction text not null check (direction in ('out','in')),
  template text,
  body text not null,
  task_id text references care_tasks(id),
  buttons jsonb,
  at timestamptz not null default now()
);
create index helper_messages_idx on helper_messages(membership_id, at);

alter table health_events add column acknowledged_at timestamptz;
alter table care_tasks add column mismatch_case text;
alter table incidents add column voice_note boolean not null default false;
