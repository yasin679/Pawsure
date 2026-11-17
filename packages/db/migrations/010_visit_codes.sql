-- 17 Nov 2026: random start and end codes for a visit. When the helper's arrival (or exit) missed call comes in,
-- Pawsure sends her a fresh 3-digit code on WhatsApp. She writes it on paper, puts it next to the pet or bowl and
-- sends a photo within 10 minutes. A code nobody knew before the call stops old or pre-taken photos counting, and a
-- copied code card no longer helps. Codes are stored sealed, like the code cards.
-- Rollback: packages/db/rollback/010_visit_codes.down.sql
alter table care_visits add column start_code_sealed text;
alter table care_visits add column start_code_at timestamptz;
alter table care_visits add column end_code_sealed text;
alter table care_visits add column end_code_at timestamptz;
alter table checkin_signals drop constraint checkin_signals_kind_check;
alter table checkin_signals add constraint checkin_signals_kind_check
  check (kind in ('photo','voice','ivr','friend_photo','call_arrive','call_exit','gate','code_start','code_end'));
