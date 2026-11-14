-- Rollback for migration 007_qa_consolidated.sql (QA update 14 Nov → v1.1.0 of 13 Nov). Run by hand, in one transaction, after taking a backup.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f packages/db/rollback/007_qa_consolidated.down.sql
-- Then deploy the 13 Nov build. The 14 Nov build will re-apply the migration if it is started again.

alter table households drop column if exists society_verified;
alter table households drop column if exists society_id;
alter table households drop column if exists state;
alter table households drop column if exists city;
drop table if exists societies;
alter table friend_profiles drop column if exists species;
alter table friend_profiles drop column if exists max_pets;
delete from schema_migrations where version = '007_qa_consolidated.sql';
