-- Rollback for 008_languages.sql. Run by hand after a backup. Anyone with another language goes back to English first.
update users set language='en' where language not in ('en','hi','mr');
update backup_contact set language='en' where language not in ('en','hi','mr');
alter table users add constraint users_language_check check (language in ('en','hi','mr'));
alter table backup_contact add constraint backup_contact_language_check check (language in ('en','hi','mr'));
delete from schema_migrations where version = '008_languages.sql';
