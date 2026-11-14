-- v1.1.0 QA update: consolidated tracker 14 Nov 2026 (PAW-017 to PAW-062). Forward-only; adds columns and one table.
-- Rollback script: packages/db/rollback/007_qa_consolidated.down.sql (run by hand, never automatically).

-- PAW-026 / PAW-034: how many pets a friend will look after at once, and which kinds.
alter table friend_profiles add column max_pets int not null default 1 check (max_pets between 1 and 4);
alter table friend_profiles add column species jsonb not null default '["Dog","Cat","Other"]';

-- PAW-018 / PAW-036: a society is identified by name and city, never by name alone.
create table societies (
  id text primary key,
  name text not null,
  area text,
  city text not null,
  state text not null,
  unique (name, city)
);
insert into societies(id, name, area, city, state) values
  ('soc_lakevista_mum', 'Lake Vista CHS', 'Powai', 'Mumbai', 'Maharashtra'),
  ('soc_hiranandani_mum', 'Hiranandani Gardens', 'Powai', 'Mumbai', 'Maharashtra'),
  ('soc_lakevista_pune', 'Lake Vista CHS', 'Baner', 'Pune', 'Maharashtra'),
  ('soc_amanora_pune', 'Amanora Park Town', 'Hadapsar', 'Pune', 'Maharashtra'),
  ('soc_prestige_blr', 'Prestige Shantiniketan', 'Whitefield', 'Bengaluru', 'Karnataka'),
  ('soc_myhome_hyd', 'My Home Avatar', 'Narsingi', 'Hyderabad', 'Telangana');

alter table households add column city text;
alter table households add column state text;
alter table households add column society_id text references societies(id);
-- A society typed by hand (not in the list) is kept but marked unverified until ops checks it.
alter table households add column society_verified boolean not null default false;
