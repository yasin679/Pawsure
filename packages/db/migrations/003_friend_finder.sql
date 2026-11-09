-- Phase 3: AI Friend Finder (PS-050–069, PS-123, PS-125).

-- Friend WhatsApp thread per request (templates only; PS-118).
create table friend_messages (
  id text primary key,
  request_id text references friend_requests(id),
  friend_user_id text not null references users(id),
  household_id text references households(id),
  direction text not null check (direction in ('out','in')),
  template text,
  body text not null,
  buttons jsonb,
  at timestamptz not null default now()
);
create index friend_messages_idx on friend_messages(friend_user_id, at);

-- A confirmed friend becomes the named person on a cover task (not a household member).
alter table care_tasks add column assignee_friend_user_id text references users(id);
alter table care_tasks add column cover_request_id text references friend_requests(id);
alter table care_tasks add column friend_arrived_at timestamptz;

-- Minimum access details disclosed to one friend for one request; revocable (PS-063, 9.5).
create table access_grants (
  id text primary key,
  request_id text not null references friend_requests(id),
  friend_user_id text not null references users(id),
  household_id text not null references households(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

-- Live location during an accepted visit only; deleted 24 h after the visit (PS-054, §9 retention).
create table live_location_sessions (
  id text primary key,
  request_id text not null references friend_requests(id),
  friend_user_id text not null references users(id),
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  delete_after timestamptz not null
);

alter table friend_links add column display_label text;
alter table friend_links add column invited_at timestamptz not null default now();
alter table friend_profiles add column response_band text;
alter table friend_requests add column created_by text;
alter table households add column nearby_fallback_requested boolean not null default false;
alter table pets add column pronoun text; -- optional, owner-entered (used only in English friend messages)
