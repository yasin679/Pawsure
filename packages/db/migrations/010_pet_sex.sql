-- 010: a pet's sex (asked at sign-up together with the breed). Used for him/her in messages to friends.
alter table pets add column sex text check (sex in ('Male','Female'));
update pets set sex = 'Male' where id = 'bruno';
update pets set sex = 'Female' where id = 'misty';
