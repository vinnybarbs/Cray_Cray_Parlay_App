-- Settlement correctness (2026-08-06 incident): the Aug 6 Nationals ML
-- pick was graded WON at 3pm, an hour BEFORE its 4:06pm first pitch. The
-- matcher joined on team pair within a three-day date window, so during
-- a series or a doubleheader a pick could settle off a neighboring
-- game's final.
--
-- Two guards:
--   1. A pick never settles before its scheduled start.
--   2. The result must carry the pick's own local game date (Denver
--      localization handles the UTC boundary that the old +/- 1 day
--      window papered over; US sport dates are Eastern and share the
--      Denver calendar date for all realistic start times).
--
-- Known limit: a same-day doubleheader still has two same-date results
-- for one team pair, and the matcher cannot tell them apart without an
-- event id on the suggestion. Guard 1 at least blocks grading game 2
-- off game 1 while game 2 is unplayed.

CREATE OR REPLACE FUNCTION public.settle_ai_suggestions()
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  updated_count INT;
BEGIN
  WITH matched AS (
    SELECT
      s.id AS suggestion_id,
      public.determine_outcome(
        s.pick, s.bet_type, s.point,
        gr.home_team_name, gr.away_team_name,
        gr.home_score, gr.away_score
      ) AS computed_outcome
    FROM public.ai_suggestions s
    JOIN public.game_results gr
      ON gr.sport = s.sport
     AND gr.status = 'final'
     AND gr.date = (s.game_date AT TIME ZONE 'America/Denver')::date
     AND (
       (LOWER(gr.home_team_name) = LOWER(s.home_team) AND LOWER(gr.away_team_name) = LOWER(s.away_team))
       OR
       (LOWER(gr.home_team_name) = LOWER(s.away_team) AND LOWER(gr.away_team_name) = LOWER(s.home_team))  -- neutral-site / reversed
     )
    WHERE s.actual_outcome = 'pending'
      AND s.game_date <= NOW()
  )
  UPDATE public.ai_suggestions s
  SET actual_outcome = m.computed_outcome,
      resolved_at = NOW()
  FROM matched m
  WHERE s.id = m.suggestion_id
    AND m.computed_outcome IN ('won', 'lost', 'push');  -- skip 'pending' returns

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- Un-grade every row settled ahead of its own game. Settlement re-grades
-- them correctly once the games actually finish.
UPDATE public.ai_suggestions
SET actual_outcome = 'pending', resolved_at = NULL
WHERE actual_outcome IN ('won', 'lost', 'push')
  AND game_date > NOW();
