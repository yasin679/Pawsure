-- Rollback for 010_visit_codes.sql. Run by hand after a backup; it deletes the start and end code photos' records.
delete from checkin_signals where kind in ('code_start','code_end');
alter table checkin_signals drop constraint checkin_signals_kind_check;
alter table checkin_signals add constraint checkin_signals_kind_check
  check (kind in ('photo','voice','ivr','friend_photo','call_arrive','call_exit','gate'));
alter table care_visits drop column start_code_sealed;
alter table care_visits drop column start_code_at;
alter table care_visits drop column end_code_sealed;
alter table care_visits drop column end_code_at;
delete from schema_migrations where version = '010_visit_codes.sql';
