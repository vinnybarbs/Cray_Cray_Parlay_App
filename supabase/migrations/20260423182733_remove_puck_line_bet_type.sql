-- Remove 'Puck Line' as a distinct bet_type. It's NHL-speak for a ±1.5 spread,
-- mathematically identical to Spread. Having it as a separate enum value just
-- fragments the analytics and complicates the settlement function for no gain.
--
-- Scope (verified at migration time):
--   - 1 row in ai_suggestions with bet_type='Puck Line'
--   - 0 rows in parlay_legs
--   - MV rows naturally rebuild on next refresh

-- 1a. Delete Puck Line rows that already have a duplicate Spread row for the
--     same (home, away, pick, point, date). One such case exists today — a
--     double-logged Sharks/Blackhawks bet created within a minute of each other.
DELETE FROM public.ai_suggestions pl
WHERE pl.bet_type = 'Puck Line'
  AND EXISTS (
    SELECT 1 FROM public.ai_suggestions s
    WHERE s.bet_type = 'Spread'
      AND s.home_team = pl.home_team
      AND s.away_team = pl.away_team
      AND s.pick = pl.pick
      AND COALESCE(s.point::text, 'null') = COALESCE(pl.point::text, 'null')
      AND s.game_date::date = pl.game_date::date
  );

-- 1b. Relabel remaining Puck Line rows to Spread (should be zero at this point,
--     but defensive in case any slip in before deploy).
UPDATE public.ai_suggestions SET bet_type = 'Spread' WHERE bet_type = 'Puck Line';
UPDATE public.parlay_legs    SET bet_type = 'Spread' WHERE bet_type = 'Puck Line';

-- 2. Simplify determine_outcome() — drop the 'Puck Line' case; Spread covers it.
--    Same behavior as before (the two branches were identical), just one label.
CREATE OR REPLACE FUNCTION public.determine_outcome(
  pick TEXT,
  bet_type TEXT,
  point NUMERIC,
  home_team TEXT,
  away_team TEXT,
  home_score INT,
  away_score INT
) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  pick_lower TEXT := LOWER(pick);
  home_lower TEXT := LOWER(home_team);
  away_lower TEXT := LOWER(away_team);
  picked_home BOOLEAN;
  picked_score NUMERIC;
  other_score NUMERIC;
  total INT;
BEGIN
  IF home_score IS NULL OR away_score IS NULL THEN
    RETURN 'pending';
  END IF;

  CASE bet_type
    WHEN 'Moneyline' THEN
      IF home_score = away_score THEN
        RETURN 'push';
      END IF;
      IF home_score > away_score THEN
        RETURN CASE WHEN pick_lower LIKE '%' || home_lower || '%' THEN 'won' ELSE 'lost' END;
      ELSE
        RETURN CASE WHEN pick_lower LIKE '%' || away_lower || '%' THEN 'won' ELSE 'lost' END;
      END IF;

    WHEN 'Spread' THEN
      -- NHL puck line (±1.5) falls under this branch now too.
      picked_home := pick_lower LIKE '%' || home_lower || '%';
      IF picked_home THEN
        picked_score := home_score + COALESCE(point, 0);
        other_score := away_score;
      ELSE
        picked_score := away_score + COALESCE(point, 0);
        other_score := home_score;
      END IF;
      IF picked_score = other_score THEN RETURN 'push';
      ELSIF picked_score > other_score THEN RETURN 'won';
      ELSE RETURN 'lost';
      END IF;

    WHEN 'Total', 'Totals' THEN
      total := home_score + away_score;
      IF total = COALESCE(point, 0) THEN RETURN 'push';
      ELSIF pick_lower LIKE '%over%' THEN
        RETURN CASE WHEN total > point THEN 'won' ELSE 'lost' END;
      ELSIF pick_lower LIKE '%under%' THEN
        RETURN CASE WHEN total < point THEN 'won' ELSE 'lost' END;
      ELSE
        RETURN 'pending';
      END IF;

    ELSE
      RETURN 'pending';
  END CASE;
END;
$$;

-- 3. Refresh MV so bet_type=Puck Line rows disappear from dashboards.
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_model_accuracy;
