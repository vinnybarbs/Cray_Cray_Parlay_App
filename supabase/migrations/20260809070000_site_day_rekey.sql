-- Site-day rekey (2026-08-08 "Africa time" incident).
--
-- game_analysis keys, auto_digest session ids, and the board-history day
-- were derived from the UTC clock, so every game after 6 PM Denver filed
-- under tomorrow (tonight's Dodgers at Diamondbacks carried game_key
-- ..._2026-08-09). Code now derives calendar days in America/Denver via
-- shared/site-day.js. This migration rekeys FUTURE analysis rows so the
-- new code upserts onto them instead of creating day-shifted duplicates.
-- Settled history keeps its old keys, nothing joins on them by day.

-- If a corrected key already exists, drop the day-shifted duplicate
-- (it regenerates on the next pre-analyze pass).
DELETE FROM public.game_analysis ga
WHERE ga.game_date > now()
  AND right(ga.game_key, 10) <> to_char(ga.game_date AT TIME ZONE 'America/Denver', 'YYYY-MM-DD')
  AND EXISTS (
    SELECT 1 FROM public.game_analysis g2
    WHERE g2.game_key = regexp_replace(ga.game_key, '\d{4}-\d{2}-\d{2}$',
      to_char(ga.game_date AT TIME ZONE 'America/Denver', 'YYYY-MM-DD'))
  );

UPDATE public.game_analysis
SET game_key = regexp_replace(game_key, '\d{4}-\d{2}-\d{2}$',
  to_char(game_date AT TIME ZONE 'America/Denver', 'YYYY-MM-DD'))
WHERE game_date > now()
  AND right(game_key, 10) <> to_char(game_date AT TIME ZONE 'America/Denver', 'YYYY-MM-DD');
