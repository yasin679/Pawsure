-- Rollback for 010_pet_sex.sql. Run by hand after a backup.
alter table pets drop column sex;
delete from schema_migrations where version = '010_pet_sex.sql';
