-- Rollback for 009_society_location.sql. Run by hand after a backup.
alter table societies drop column lat;
alter table societies drop column lng;
delete from schema_migrations where version = '009_society_location.sql';
