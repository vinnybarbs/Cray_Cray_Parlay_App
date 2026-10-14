-- Odds API credit budget (owner 2026-10-13: "College basketball shouldn't
-- be calling player props", "we need to be at 20 mins on game day but ...
-- too frequent a day or days before a game"). refresh-odds now refreshes
-- a sport every 20 minutes only when it has a game inside 18 hours, and
-- every 3 hours otherwise. A stretch with no game day sport can go 3 hours
-- with no rows written, so directive 14's starved window moves from 2
-- hours to 4. Edits the check in place, the rest of it is untouched.
update public.directives
set check_sql = replace(
      replace(check_sql, $q$'odds refresh starved 2h'$q$, $q$'odds refresh starved 4h'$q$),
      $q$job_name = 'refresh-odds-hourly' and status = 'completed' and created_at > now() - interval '2 hours'$q$,
      $q$job_name = 'refresh-odds-hourly' and status = 'completed' and created_at > now() - interval '4 hours'$q$)
where id = 14 and check_sql like '%odds refresh starved 2h%';
