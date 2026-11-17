-- QA update 16 Nov 2026: proof from the app. Helpers, friends and backups send a photo of the bowl or pet and/or
-- today's code from the food-box card. Photos are small (compressed on the phone, under ~60 KB) and deleted after
-- 90 days with the other photos (apps/api/src/ops.ts). Rollback: packages/db/rollback/009_proof_photos.down.sql
create table evidence_photos (
  id text primary key,
  household_id text not null references households(id),
  task_id text not null,
  data_url text,                       -- cleared by retention after 90 days; the hash stays for duplicate checks
  image_hash text not null,
  code_result text not null check (code_result in ('today','old','wrong','none')),
  actor text not null,                 -- helper:<membership>, friend:<user>, cover:<link or backup>
  channel text not null,
  created_at timestamptz not null default now()
);
create index evidence_photos_task on evidence_photos(task_id);
