-- Rollback for 009_proof_photos.sql. Run by hand after a backup; it deletes the stored proof photos.
drop table if exists evidence_photos;
delete from schema_migrations where version = '009_proof_photos.sql';
