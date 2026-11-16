-- 009: societies get a map position so sign-up can suggest the society from the phone's location (owner can change it).
alter table societies add column lat double precision;
alter table societies add column lng double precision;
update societies set lat = 19.1176, lng = 72.9060 where id = 'soc_lakevista_mum';
update societies set lat = 19.1197, lng = 72.9090 where id = 'soc_hiranandani_mum';
update societies set lat = 18.5590, lng = 73.7868 where id = 'soc_lakevista_pune';
update societies set lat = 18.5167, lng = 73.9339 where id = 'soc_amanora_pune';
update societies set lat = 12.9900, lng = 77.7280 where id = 'soc_prestige_blr';
update societies set lat = 17.3910, lng = 78.3530 where id = 'soc_myhome_hyd';
