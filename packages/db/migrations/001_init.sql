-- Pawsure P0 schema (PRD 12.2 domain entities). PostgreSQL 15+.
-- Conventions: every household-owned row carries household_id (tenant boundary); event_time vs received_time are separate;
-- state changes are appended to *_events tables; inbound messages, calls and jobs carry unique idempotency keys.

create table households (
  id text primary key,
  society text not null,            -- coarse location anchor (society/tower only; PS-054)
  tower text,
  flat_private text,                -- never shown to friends until accepted + owner-authorised
  access_note_private text,
  loc_share text not null default 'society' check (loc_share in ('society','tower')),
  gate_app boolean not null default false,
  rewards_arm boolean not null default false,      -- PS-126 cohort assignment
  alone_limit_hours int not null default 6,
  created_at timestamptz not null default now()
);

create table users (
  id text primary key,
  phone_e164 text not null unique,
  display_name text,
  language text not null default 'en' check (language in ('en','hi','mr')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table memberships (                -- role per household; a helper in two homes has two rows (PS-029)
  id text primary key,
  household_id text not null references households(id),
  user_id text not null references users(id),
  role text not null check (role in ('owner','co_owner','backup','family','viewer','helper','friend')),
  status text not null default 'active' check (status in ('invited','active','revoking','revoked')),
  backup_address_authorised boolean not null default false,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  unique (household_id, user_id, role)
);

create table sessions (
  token_hash text primary key,
  user_id text not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table otp_challenges (
  id text primary key,
  phone_e164 text not null,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz
);
create index otp_phone_idx on otp_challenges(phone_e164, created_at desc);

create table consent_records (            -- versioned, timestamped, per household for helpers (PS-002, PS-021, PS-110)
  id text primary key,
  user_id text not null references users(id),
  household_id text references households(id),
  kind text not null,                     -- terms, privacy, alerts, helper_monitoring, friend_discovery, research ...
  version text not null,
  language text not null,
  granted boolean not null,
  scope jsonb,
  recorded_at timestamptz not null default now()
);

create table pets (
  id text primary key,
  household_id text not null references households(id),
  name text not null,
  species text not null default 'Dog',
  breed text, age text, size text, photo_ref text,
  food text, allergies text, medicines text, fears text, notes text,
  vet_name text, vet_phone text, clinic24_name text, clinic24_phone text, backup_name text, backup_phone text,
  source text not null default 'owner-provided',
  updated_at timestamptz not null default now()
);

create table routine_tasks (              -- CarePlan items; edits create a new row with effective_from (PS-011)
  id text primary key,
  household_id text not null references households(id),
  pet_id text not null references pets(id),
  title text not null,
  task_type text not null,
  due_minute int not null check (due_minute between 0 and 1439),
  min_minutes int not null default 5,
  recurrence text not null default 'daily',
  assignee_membership_id text references memberships(id),
  escalation_profile text not null default 'standard' check (escalation_profile in ('standard','medicine','walk')),
  evidence_policy text not null default 'photo_code',
  instructions text,
  visit_slot text,
  enabled boolean not null default true,
  effective_from date not null,
  superseded_by text references routine_tasks(id),
  created_at timestamptz not null default now()
);

create table care_visits (
  id text primary key,
  household_id text not null references households(id),
  care_date date not null,
  slot text not null,
  helper_membership_id text references memberships(id),
  unique (household_id, care_date, slot)
);

create table care_tasks (                 -- one row per task per IST day; state lives in task_events
  id text primary key,
  household_id text not null references households(id),
  pet_id text not null references pets(id),
  routine_task_id text references routine_tasks(id),
  care_date date not null,
  title text not null,
  task_type text not null,
  due_minute int not null,
  min_minutes int not null,
  escalation_profile text not null,
  visit_id text references care_visits(id),
  assignee_membership_id text references memberships(id),
  reassigned_to_task_id text references care_tasks(id),
  ack_at timestamptz, ack_by text,
  resolved_at timestamptz, resolved_note text,
  force_backup boolean not null default false,
  return_check jsonb
);
create index care_tasks_day_idx on care_tasks(household_id, care_date);

create table task_events (                -- PS-121 append-only lifecycle
  id bigserial primary key,
  task_id text not null references care_tasks(id),
  household_id text not null references households(id),
  state text not null,
  actor text not null,
  note text,
  at timestamptz not null default now()
);

create table checkin_signals (            -- raw provenance (PS-030, PS-122, PS-038)
  id text primary key,
  household_id text not null references households(id),
  task_id text references care_tasks(id),
  visit_id text references care_visits(id),
  kind text not null check (kind in ('photo','voice','ivr','friend_photo','call_arrive','call_exit','gate')),
  channel text not null,                  -- whatsapp | ivr | owner | app
  photo_code text,
  image_hash text,
  duplicate boolean not null default false,
  names_task boolean,
  code_ok boolean,
  after_prompt boolean,
  registered_number boolean,
  owner_provided boolean not null default false,
  evidence_ref text,                      -- private object-store key; never a public URL
  event_time timestamptz not null,
  received_time timestamptz not null default now(),
  idempotency_key text not null unique
);
create index signals_hash_idx on checkin_signals(household_id, image_hash);

create table code_cards (
  id text primary key,
  household_id text not null references households(id),
  month text not null,
  version int not null,
  codes_encrypted text not null,          -- encrypt at rest in production (KMS); never logged
  active boolean not null default true,
  rotated_reason text,
  created_at timestamptz not null default now()
);

create table care_days (                  -- PS-111 result per pet per day with rule version; never back-filled
  household_id text not null references households(id),
  pet_id text not null references pets(id),
  care_date date not null,
  status text not null,
  rule_version text not null,
  detail jsonb,
  closed_at timestamptz,
  corrected_by text, corrected_at timestamptz,
  primary key (household_id, pet_id, care_date, rule_version)
);

create table lookin_links (
  id text primary key,
  household_id text not null references households(id),
  task_id text not null references care_tasks(id),
  recipient_membership_id text not null references memberships(id),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create table lookin_opens (
  id bigserial primary key, link_id text not null references lookin_links(id), opened_at timestamptz not null default now(), allowed boolean not null, reason text, session_fingerprint text
);

create table incidents (
  id text primary key,
  household_id text not null references households(id),
  pet_id text references pets(id),
  severity text not null check (severity in ('S1','S2','S3')),
  category text not null,
  reporter text not null,
  note text,
  voice_ref text,
  reported_at timestamptz not null default now(),
  ack_at timestamptz, ack_by text,
  resolved_at timestamptz, resolution_note text
);

create table notifications (              -- every delivery attempt; dedupe by key (notification matrix)
  id text primary key,
  household_id text references households(id),
  dedupe_key text not null unique,
  recipient text not null,
  channel text not null,
  template text not null,
  payload jsonb,
  status text not null default 'queued',
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create table health_events (
  id text primary key,
  household_id text not null references households(id),
  pet_id text not null references pets(id),
  kind text not null,
  label text not null,
  given_on date,
  next_due date,
  source text not null,
  state text not null default 'upcoming',
  snoozed_until date
);

create table friend_profiles (
  user_id text primary key references users(id),
  discoverable boolean not null default false,
  opt_out_requested_at timestamptz,
  paused boolean not null default false,
  paused_until date,
  windows jsonb not null default '[]',
  capabilities jsonb not null default '{}',
  key_mode text not null default 'handover',
  stairs_ok boolean not null default true,
  live_location_allowed boolean not null default false,
  nearby_opt_in boolean not null default false,
  society text, tower text,
  updated_at timestamptz not null default now()
);

create table friend_links (               -- owner's network; invitation is not discoverability (C2)
  household_id text not null references households(id),
  friend_user_id text not null references users(id),
  status text not null default 'invited' check (status in ('invited','accepted','blocked','left')),
  distance_band int,
  help_count int not null default 0,
  checked_in_count int not null default 0,
  primary key (household_id, friend_user_id)
);

create table friend_requests (
  id text primary key,
  household_id text not null references households(id),
  state text not null,
  parse jsonb,
  parser text,
  corrected_fields text[] not null default '{}',
  doc jsonb not null,                     -- serialized domain FriendRequest (state machine)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table friend_request_events (
  id bigserial primary key, request_id text not null references friend_requests(id), state text not null, note text, at timestamptz not null default now()
);
create table inbound_messages (           -- webhook idempotency (PS-123)
  message_id text primary key, channel text not null, received_at timestamptz not null default now(), payload jsonb
);

create table reward_ledger (
  id text primary key,
  helper_user_id text not null references users(id),
  household_id text not null references households(id),
  task_id text references care_tasks(id),
  points int not null,
  state text not null check (state in ('earned','held','released','reversed','expired','redeemed')),
  reason text not null,
  month text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table rights_requests (
  id text primary key,
  user_id text not null references users(id),
  kind text not null check (kind in ('access','correction','withdrawal','erasure','grievance')),
  channel text not null,
  state text not null default 'received',
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table feature_flags (
  key text primary key, default_value jsonb not null, locked boolean not null default false, note text
);
create table household_flags (
  household_id text not null references households(id), key text not null references feature_flags(key), value jsonb not null, primary key (household_id, key)
);

create table ops_cases (
  id text primary key, household_id text references households(id), kind text not null, title text not null, severity text, state text not null default 'open', created_at timestamptz not null default now(), notes jsonb not null default '[]'
);

create table jobs (                       -- durable queue for timers/escalation (idempotent)
  id bigserial primary key,
  kind text not null,
  idempotency_key text not null unique,
  payload jsonb not null,
  run_at timestamptz not null,
  locked_at timestamptz,
  attempts int not null default 0,
  done_at timestamptz,
  last_error text
);
create index jobs_due_idx on jobs(run_at) where done_at is null;

create table audit_log (                  -- append-only (PS-072)
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  household_id text,
  action text not null,
  detail jsonb
);
create or replace function audit_log_no_change() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end; $$;
create trigger audit_log_immutable before update or delete on audit_log for each row execute function audit_log_no_change();
create trigger task_events_immutable before update or delete on task_events for each row execute function audit_log_no_change();
create trigger consent_records_immutable before update or delete on consent_records for each row execute function audit_log_no_change();

create table schema_migrations (version text primary key, applied_at timestamptz not null default now());
