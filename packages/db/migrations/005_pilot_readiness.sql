-- Phase 5: pilot readiness — vendor delivery log, service checks, retention runs.

-- Every outbound delivery attempt, including retries and fallbacks (vendor failover, §12 monitoring).
-- Recipients are stored masked; message bodies are not stored here.
create table delivery_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  channel text not null,
  recipient_masked text not null,
  template text not null,
  status text not null check (status in ('sent','failed','fallback_sent','gave_up')),
  attempt int not null default 1,
  error text,
  latency_ms int,
  fallback_of text
);
create index delivery_log_at_idx on delivery_log(at desc);

-- Current state of each service check; a change into 'alert' opens one ops case.
create table service_checks (
  key text primary key,
  status text not null check (status in ('ok','warn','alert')),
  value text,
  since timestamptz not null default now(),
  case_id text
);

-- One row per retention run (§9 retention schedule), with counts only.
create table retention_runs (
  run_date date primary key,
  ran_at timestamptz not null default now(),
  counts jsonb not null
);
