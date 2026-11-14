-- QA update 15 Nov 2026: people can choose any of the 22 scheduled Indian languages or English.
-- Messages are still written in en/hi/mr; other choices get English messages (packages/domain/src/languages.ts).
-- Rollback: packages/db/rollback/008_languages.down.sql (run by hand).
alter table users drop constraint if exists users_language_check;
alter table backup_contact drop constraint if exists backup_contact_language_check;
