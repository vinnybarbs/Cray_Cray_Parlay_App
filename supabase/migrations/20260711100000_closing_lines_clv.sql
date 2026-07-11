-- supabase/migrations/20260711100000_closing_lines_clv.sql
--
-- Closing-line capture + CLV. Step 2 of the NFL-readiness plan.
--
-- Why: win-loss needs weeks of volume before it says anything, but closing
-- line value says within a day whether a pick beat the market. A pick that
-- consistently gets a better price than the close is good process even when
-- it loses. This is the fastest feedback signal we can run once NFL starts.
--
-- How: a pg_cron job snapshots odds_cache rows for games starting within the
-- next 90 minutes, every 15 minutes, upserting on (game, market, bookmaker).
-- The last pre-start write wins and stands as the closing line. Precision is
-- bounded by the hourly odds_cache refresh ('refresh-odds-hourly'), so the
-- captured "close" can be up to ~60 minutes stale. Fine for v1 — tighten by
-- refreshing odds more often near game time when API budget allows.

CREATE TABLE IF NOT EXISTS public.closing_lines (
  sport            text,
  external_game_id text NOT NULL,
  commence_time    timestamptz,
  home_team        text,
  away_team        text,
  bookmaker        text NOT NULL,
  market_type      text NOT NULL,
  outcomes         jsonb,          -- [{name, price, point}] as cached
  captured_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (external_game_id, market_type, bookmaker)
);

GRANT SELECT ON public.closing_lines TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.capture_closing_lines()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
BEGIN
  INSERT INTO public.closing_lines
    (sport, external_game_id, commence_time, home_team, away_team,
     bookmaker, market_type, outcomes, captured_at)
  SELECT sport, external_game_id, commence_time, home_team, away_team,
         bookmaker, market_type, outcomes, now()
  FROM public.odds_cache
  WHERE commence_time > now()
    AND commence_time <= now() + interval '90 minutes'
    AND market_type IN ('h2h', 'spreads', 'totals')
  ON CONFLICT (external_game_id, market_type, bookmaker) DO UPDATE SET
    outcomes      = EXCLUDED.outcomes,
    commence_time = EXCLUDED.commence_time,
    captured_at   = EXCLUDED.captured_at;
END;
$fn$;

SELECT cron.schedule(
  'capture_closing_lines',
  '*/15 * * * *',
  $$SELECT public.capture_closing_lines();$$
);

-- CLV per pick. Positive clv_pp = the pick got a better price than the
-- close (implied prob at close exceeds implied prob at bet). Both sides use
-- raw juiced implied so the vig bias mostly cancels.
CREATE OR REPLACE VIEW public.v_pick_clv AS
WITH picks AS (
  SELECT id, sport, home_team, away_team, game_date, bet_type, pick, odds,
         edge_pp, tier, actual_outcome, pipeline_version,
    CASE bet_type
      WHEN 'Moneyline' THEN 'h2h'
      WHEN 'Spread'    THEN 'spreads'
      WHEN 'Total'     THEN 'totals'
    END AS market_type,
    CASE
      WHEN bet_type = 'Total' AND pick ILIKE 'over%'  THEN 'Over'
      WHEN bet_type = 'Total' AND pick ILIKE 'under%' THEN 'Under'
      WHEN pick ILIKE home_team || '%' THEN home_team
      WHEN pick ILIKE away_team || '%' THEN away_team
    END AS side_name,
    CASE WHEN odds ~ '^[+-]?\d+$' THEN
      CASE WHEN replace(odds,'+','')::numeric > 0
           THEN 100.0 / (replace(odds,'+','')::numeric + 100.0)
           ELSE abs(replace(odds,'+','')::numeric) / (abs(replace(odds,'+','')::numeric) + 100.0)
      END
    END AS bet_implied
  FROM public.ai_suggestions
  WHERE bet_type IN ('Moneyline','Spread','Total')
),
matched AS (
  SELECT DISTINCT ON (p.id)
    p.*, cl.bookmaker, cl.captured_at,
    (SELECT (o->>'price')::numeric
     FROM jsonb_array_elements(cl.outcomes) o
     WHERE o->>'name' = p.side_name
     LIMIT 1) AS close_price
  FROM picks p
  JOIN public.closing_lines cl
    ON cl.market_type = p.market_type
   AND lower(cl.home_team) = lower(p.home_team)
   AND lower(cl.away_team) = lower(p.away_team)
   AND cl.commence_time BETWEEN p.game_date - interval '1 day'
                            AND p.game_date + interval '1 day'
  WHERE p.side_name IS NOT NULL AND p.bet_implied IS NOT NULL
  -- Prefer DraftKings, then FanDuel, then whatever else was cached.
  ORDER BY p.id,
    CASE cl.bookmaker WHEN 'draftkings' THEN 0 WHEN 'fanduel' THEN 1 ELSE 2 END
)
SELECT id, sport, home_team, away_team, game_date, bet_type, pick, odds,
  edge_pp, tier, actual_outcome, pipeline_version, bookmaker, captured_at,
  close_price,
  CASE WHEN close_price IS NOT NULL AND close_price <> 0 THEN
    round((
      (CASE WHEN close_price > 0
            THEN 100.0 / (close_price + 100.0)
            ELSE abs(close_price) / (abs(close_price) + 100.0) END)
      - bet_implied
    ) * 100, 2)
  END AS clv_pp
FROM matched;

GRANT SELECT ON public.v_pick_clv TO anon, authenticated, service_role;
