-- NCAAB team rows that carried another school's ESPN id (build_queue 24).
-- sync-standings found 365 NCAAB teams and stored 355 on every run since
-- 2026-09-09. The ten missing schools were the real owners of these rows:
-- before the identity first matcher (2026-09-09) the mascot fallback let
-- a smaller school claim the big school's row (Western Michigan Broncos
-- took Boise State Broncos, Tulsa Golden Hurricane took Miami Hurricanes),
-- so the big school's name row stored the smaller school's record and the
-- big school itself could neither match its id nor insert its name.
-- Each row gets its own ESPN id back. The displaced schools have no row
-- and get one on the next sync. The standings rows on these team ids are
-- overwritten with the right record by that same sync.
-- Evidence: ESPN mens-college-basketball standings group 50, 2026-10-19.

update public.teams t
   set provider_ids = jsonb_set(coalesce(t.provider_ids, '{}'::jsonb), '{espn}', to_jsonb(v.right_id))
  from (values
    ('Boise State Broncos',      '2711', '68'),
    ('Seton Hall Pirates',       '151',  '2550'),
    ('Michigan State Spartans',  '2908', '127'),
    ('Alabama Crimson Tide',     '108',  '333'),
    ('Kansas Jayhawks',          '2349', '2305'),
    ('Cincinnati Bearcats',      '2066', '2132'),
    ('South Carolina Gamecocks', '55',   '2579'),
    ('Ole Miss Rebels',          '2439', '145'),
    ('Miami Hurricanes',         '202',  '2390'),
    ('Penn State Nittany Lions', '2453', '213')
  ) as v(name, wrong_id, right_id)
 where t.sport = 'NCAAB'
   and t.name = v.name
   and t.provider_ids->>'espn' = v.wrong_id;
