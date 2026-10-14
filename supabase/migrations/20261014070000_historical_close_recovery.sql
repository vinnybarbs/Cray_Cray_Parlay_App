-- Recover the games the kickoff snapshot missed (2026-10-14). The first
-- NBA and NHL windows priced about two thirds of their games: the events
-- list a day out carries stale start times, and some books pull a game a
-- few minutes early. backfillWindow now retries each missed game on the
-- per event endpoint and skips games already stored, so a rerun only pays
-- for what is missing. Every finished game market window (soccer and the
-- US team sports) goes back in the queue once.
update public.historical_odds_jobs
set status = 'pending', done_at = null
where status = 'done' and markets not like 'player_%';
