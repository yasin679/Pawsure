-- v1.1.0: cover continuity (PRD v1.4 section 7.7, 9.6; PS-127 to PS-141). Forward-only; adds tables and columns.
-- Rollback script: packages/db/rollback/006_cover_continuity.down.sql (run by hand, never automatically).

-- Household settings
alter table households add column standing_backup_approval boolean not null default false;  -- PS-130 opt-in; PRD 9.5 exception
alter table households add column remind_trusted boolean not null default false;           -- PS-127: reminder in Trusted Helper mode
alter table households add column hot_day boolean not null default false;                  -- PS-132: water tasks must happen
alter table households add column cover_config jsonb;                                      -- per-household timing overrides
alter table households add column cluster text;                                            -- PS-135 advisory target

-- PS-132 urgency, PS-138 handling note, PS-136 owner tasks
alter table routine_tasks add column urgency text check (urgency in ('CanWait','TimeSensitive','MustHappen'));
alter table routine_tasks add column owner_task boolean not null default false;            -- the owner does it when home; planned only when delayed
alter table routine_tasks add column cover_config jsonb;                                   -- per-task timing overrides
alter table care_tasks add column urgency text check (urgency in ('CanWait','TimeSensitive','MustHappen'));
alter table care_tasks add column moved_from_minute int;
alter table pets add column handling_note text;
alter table day_states add column no_cover_planned boolean not null default false;   -- PS-134 owner left anyway
alter table day_states add column plan_b text;                                        -- PS-134 leaving-check answer
alter table helper_messages add column gloss text;                                    -- English line for a non-English message

-- PS-130 ordered, pre-approved backup list (max 5 active per household; enforced in the API)
create table backup_contact (
  id text primary key,
  household_id text not null references households(id),
  user_id text references users(id),               -- set when the person is also a care-circle member
  name text not null,
  phone_e164 text not null,
  language text not null default 'en' check (language in ('en','hi','mr')),
  rank int not null check (rank between 1 and 5),
  relationship text not null,
  holds_key boolean not null default false,
  can_give_medicine boolean not null default false,
  owner_arranged boolean not null default false,   -- own paid walker or sitter: "owner-arranged, not verified by Pawsure"
  cared_before boolean not null default false,     -- false → handling note + gate and key checklist (PS-137, PS-138)
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index backup_contact_idx on backup_contact(household_id, rank) where removed_at is null;

-- PRD 9.6 cover state per task, separate from evidence
create table task_cover (
  task_id text primary key references care_tasks(id),
  household_id text not null references households(id),
  state text not null check (state in ('Assigned','ConfirmedByCaregiver','AtRisk','SubstituteProposed','AskingBackups','FriendFinder','CoveredByReplacement','CoverNotFound','OwnerHandling','NoCoverPlanned','Extended')),
  person_kind text check (person_kind in ('helper','co_owner','friend','backup','substitute','adhoc','owner')),
  person_id text,
  person_name text,
  original_assignee text,                          -- membership id from the routine; never rewritten
  reason text,
  lost_by text,                                    -- who said they can't come; their task access is revoked
  confirmed_at timestamptz,
  job_id text,
  skipped boolean not null default false,          -- skipped after cover not found: never counts as covered
  handled_pre boolean not null default false,      -- cover continuity ran before the task (PRD 10.4 note)
  timers jsonb,
  rule_version text not null,
  updated_at timestamptz not null default now()
);
create index task_cover_hh_idx on task_cover(household_id, state);
create table task_cover_event (                    -- append-only; event time and received time (IST shown in the app)
  id bigserial primary key,
  task_id text not null references care_tasks(id),
  household_id text not null references households(id),
  event text not null,
  state text not null,
  reason text,
  actor text not null,
  note text,
  event_time timestamptz not null,
  received_time timestamptz not null default now()
);
create index task_cover_event_idx on task_cover_event(task_id, id);

-- One at-risk job per visit: who was asked, when, replies, holds (serialised BackupJob + log)
create table cover_jobs (
  id text primary key,
  household_id text not null references households(id),
  care_date date not null,
  state text not null,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cover_jobs_idx on cover_jobs(household_id, care_date);

-- PS-127 one reminder per visit
create table reminder (
  id text primary key,
  household_id text not null references households(id),
  care_date date not null,
  visit_key text not null,                         -- visit id (or task id) + assignee
  recipient_kind text not null,
  recipient_id text not null,
  channel text not null,
  template text not null default 'cover_reminder',
  sent_at timestamptz not null,
  deadline_at timestamptz not null,
  reply text check (reply in ('yes','cant','substitute','noreply')),
  reply_at timestamptz,
  reply_channel text,
  message_id text,
  unique (household_id, care_date, visit_key)
);

-- PS-137 gate and key checklist
create table visit_access_checklist (
  task_id text primary key references care_tasks(id),
  household_id text not null references households(id),
  person_name text not null,
  gate_approved boolean not null default false,
  key_plan text check (key_plan in ('helper','named_person','lockbox','owner_returns')),
  key_note text,
  ticked_at timestamptz,
  reminded_at timestamptz
);

-- PS-136
create table delay_extension (
  id text primary key,
  household_id text not null references households(id),
  care_date date not null,
  old_return int not null,
  new_return int not null,
  created_tasks text[] not null default '{}',
  asked jsonb,
  result text,
  created_at timestamptz not null default now()
);

-- PS-135
create table cluster_advisory (
  id text primary key,
  cluster text not null,
  reason text not null,
  body text not null,
  sent_by text not null,
  sent_at timestamptz not null,
  remind_at timestamptz not null,
  for_date date not null
);

-- PS-140
create table circle_builder_invite (
  id text primary key,
  household_id text not null references households(id),
  kind text not null check (kind in ('society_link','pet_swap','building_helper','paid_provider')),
  token text,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);

-- PS-128 / PS-133 one-time task links for a substitute or an ad-hoc number. Task-scoped and expiring; purged with access grants.
create table task_links (
  id text primary key,
  household_id text not null references households(id),
  kind text not null check (kind in ('substitute','adhoc')),
  name text not null,
  phone_e164 text not null,
  language text not null default 'en',
  task_ids text[] not null,
  job_id text,
  proposed_by text,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  note_read_at timestamptz,
  approved_at timestamptz,
  declined_at timestamptz,
  opened_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index task_links_hh_idx on task_links(household_id);

-- Conversation log for backups, substitutes and ad-hoc numbers (templates only, PS-118). Message metadata kept 12 months.
create table cover_messages (
  id text primary key,
  seq bigserial,                                   -- send order (several messages can share a timestamp)
  household_id text not null references households(id),
  person_kind text not null,
  person_id text not null,
  direction text not null check (direction in ('out','in')),
  template text,
  language text,
  body text not null,
  gloss text,                                      -- English line for a non-English message (demo and support)
  buttons jsonb,
  job_id text,
  at timestamptz not null default now()
);
create index cover_messages_idx on cover_messages(person_id, at);

insert into feature_flags(key, default_value, locked, note) values ('sameSocietyFallback', 'false', true, 'PS-141: built, OFF until the verification rule is decided (PRD 20.3)') on conflict (key) do nothing;
