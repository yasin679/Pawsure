-- Rollback for migration 006_cover_continuity.sql (v1.1.0 → v1.0.1). Run by hand, in one transaction, after taking a backup.
-- It deletes all cover continuity data (reminders, backup lists, cover history, one-time links). Evidence and care tasks are kept.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f packages/db/rollback/006_cover_continuity.down.sql
-- Then deploy the v1.0.1 build. The v1.1.0 build will re-apply the migration if it is started again.

drop table if exists cover_messages;
drop table if exists task_links;
drop table if exists circle_builder_invite;
drop table if exists cluster_advisory;
drop table if exists delay_extension;
drop table if exists visit_access_checklist;
drop table if exists reminder;
drop table if exists cover_jobs;
drop table if exists task_cover_event;
drop table if exists task_cover;
drop table if exists backup_contact;

alter table pets drop column if exists handling_note;
alter table day_states drop column if exists no_cover_planned;
alter table day_states drop column if exists plan_b;
alter table helper_messages drop column if exists gloss;
alter table care_tasks drop column if exists moved_from_minute;
alter table care_tasks drop column if exists urgency;
alter table routine_tasks drop column if exists cover_config;
alter table routine_tasks drop column if exists owner_task;
alter table routine_tasks drop column if exists urgency;
alter table households drop column if exists cluster;
alter table households drop column if exists cover_config;
alter table households drop column if exists hot_day;
alter table households drop column if exists remind_trusted;
alter table households drop column if exists standing_backup_approval;

delete from household_flags where key = 'sameSocietyFallback';
delete from feature_flags where key = 'sameSocietyFallback';
delete from schema_migrations where version = '006_cover_continuity.sql';
