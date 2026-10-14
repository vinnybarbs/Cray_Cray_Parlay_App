-- Odds API credit budget (owner 2026-10-13: "College basketball shouldn't
-- be calling player props", "we need to be at 20 mins on game day but ...
-- too frequent a day or days before a game"). refresh-odds now refreshes
-- a sport every 20 minutes only when it has a game inside 18 hours, and
-- hourly otherwise. A thin hour can write nothing on its game day runs,
-- so directive 14's starved window moves from 2 hours to 4 for margin. Edits the check in place, the rest of it is untouched.
update public.directives
set check_sql = replace(
      replace(check_sql, $q$'odds refresh starved 2h'$q$, $q$'odds refresh starved 4h'$q$),
      $q$job_name = 'refresh-odds-hourly' and status = 'completed' and created_at > now() - interval '2 hours'$q$,
      $q$job_name = 'refresh-odds-hourly' and status = 'completed' and created_at > now() - interval '4 hours'$q$)
where id = 14 and check_sql like '%odds refresh starved 2h%';
