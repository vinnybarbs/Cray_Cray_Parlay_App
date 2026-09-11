-- Closing line value on every market (owner 2026-09-11: "Closing line
-- 10000%"). The fastest proof of an edge is beating the number the
-- market closed at, and it needs no outcomes. closing_lines holds one
-- snapshot per event, book, and market taken 9 to 17 minutes before
-- start, so the consensus close is the average across books.
--
-- pick_clv_all: every published pick (moneyline, spread, total).
--   price_clv_pp   close implied minus our implied, raw on both sides
--                  (same vig assumption), positive when the price moved
--                  our way. Only meaningful when the line did not move.
--   line_clv_points points in our favor between our line and the close
--                  (spread: our point minus close point for our team;
--                  over: close total minus ours; under: ours minus close).
-- replay_clv: the same for replay_picks, so the harness judges a
--   formula or dial by the close as well as the result.
-- prop_read_clv: NFL prop reads against the last props sync before
--   kickoff (the props close proxy): consensus line and devigged over
--   probability then, versus the read's anchor.

CREATE OR REPLACE VIEW public.closing_consensus AS
SELECT c.external_game_id, c.home_team, c.away_team, c.commence_time, c.market_type,
       o.value ->> 'name' AS name,
       round(avg((o.value ->> 'price')::numeric), 0) AS close_price,
       round(avg((o.value ->> 'point')::numeric), 2) AS close_point,
       count(DISTINCT c.bookmaker) AS books
FROM public.closing_lines c
CROSS JOIN LATERAL jsonb_array_elements(c.outcomes) o(value)
GROUP BY 1, 2, 3, 4, 5, 6;

CREATE OR REPLACE FUNCTION public.implied_pp(price numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN price IS NULL OR price = 0 THEN NULL
              WHEN price > 0 THEN round(100.0 * 100.0 / (price + 100.0), 2)
              ELSE round(100.0 * (-price) / ((-price) + 100.0), 2) END
$$;

CREATE OR REPLACE VIEW public.pick_clv_all AS
WITH s AS (
  SELECT s.id, s.session_id, s.sport, s.tier, s.bet_type, s.pick, s.point, s.odds, s.game_date, s.actual_outcome,
         s.home_team, s.away_team, s.odds_event_id, s.edge_pp, s.edge_pp_raw,
         CASE WHEN s.bet_type ILIKE '%total%' THEN 'totals' WHEN s.bet_type ILIKE '%spread%' THEN 'spreads' ELSE 'h2h' END AS market_type,
         CASE WHEN s.bet_type ILIKE '%total%' THEN (CASE WHEN s.pick ILIKE 'over%' THEN 'Over' WHEN s.pick ILIKE 'under%' THEN 'Under' END)
              WHEN s.pick ILIKE ('%' || s.home_team || '%') THEN s.home_team::text
              WHEN s.pick ILIKE ('%' || s.away_team || '%') THEN s.away_team::text END AS side_name,
         NULLIF(regexp_replace(s.odds::text, '[^0-9-]', '', 'g'), '')::numeric AS stored_odds
  FROM public.ai_suggestions s
  WHERE s.session_id::text LIKE 'auto_digest%' AND s.voided_at IS NULL
)
SELECT s.id, s.session_id, s.sport, s.tier, s.bet_type, s.market_type, s.pick, s.point, s.game_date, s.actual_outcome,
       s.edge_pp, s.edge_pp_raw, s.stored_odds, cl.close_price, cl.close_point, cl.books,
       public.implied_pp(s.stored_odds) AS stored_implied_pp,
       public.implied_pp(cl.close_price) AS close_implied_pp,
       public.implied_pp(cl.close_price) - public.implied_pp(s.stored_odds) AS price_clv_pp,
       CASE s.market_type
         WHEN 'totals'  THEN CASE WHEN s.side_name = 'Over' THEN cl.close_point - s.point::numeric ELSE s.point::numeric - cl.close_point END
         WHEN 'spreads' THEN s.point::numeric - cl.close_point
         ELSE NULL END AS line_clv_points,
       (s.market_type = 'h2h' OR s.point::numeric = cl.close_point) AS same_line
FROM s
JOIN public.closing_consensus cl
  ON cl.market_type = s.market_type AND cl.name = s.side_name
 AND ((s.odds_event_id IS NOT NULL AND cl.external_game_id = s.odds_event_id)
   OR (s.odds_event_id IS NULL AND cl.home_team = s.home_team::text AND cl.away_team = s.away_team::text
       AND abs(EXTRACT(epoch FROM (cl.commence_time - s.game_date))) <= 10800))
WHERE s.side_name IS NOT NULL AND s.stored_odds IS NOT NULL;

CREATE OR REPLACE VIEW public.replay_clv AS
WITH r AS (
  SELECT r.*,
         CASE WHEN r.side IN ('over','under') THEN 'totals' WHEN r.side LIKE '%_spread' THEN 'spreads' ELSE 'h2h' END AS market_type,
         CASE WHEN r.side = 'over' THEN 'Over' WHEN r.side = 'under' THEN 'Under'
              WHEN r.side LIKE 'home_%' THEN r.home_team ELSE r.away_team END AS side_name,
         CASE WHEN r.side IN ('over','under') OR r.side LIKE '%_spread'
              THEN NULLIF(regexp_replace(split_part(r.pick, ' ', array_length(string_to_array(r.pick, ' '), 1)), '[^0-9.+-]', '', 'g'), '')::numeric
              ELSE NULL END AS point
  FROM public.replay_picks r
)
SELECT r.run_id, r.formula, r.sport, r.game_key, r.game_date, r.side, r.market_type, r.pick, r.point, r.tier, r.edge_pp, r.edge_pp_raw, r.outcome, r.units,
       r.odds AS stored_odds, cl.close_price, cl.close_point, cl.books,
       public.implied_pp(r.odds) AS stored_implied_pp,
       public.implied_pp(cl.close_price) AS close_implied_pp,
       public.implied_pp(cl.close_price) - public.implied_pp(r.odds) AS price_clv_pp,
       CASE r.market_type
         WHEN 'totals'  THEN CASE WHEN r.side = 'over' THEN cl.close_point - r.point ELSE r.point - cl.close_point END
         WHEN 'spreads' THEN r.point - cl.close_point
         ELSE NULL END AS line_clv_points,
       (r.market_type = 'h2h' OR r.point = cl.close_point) AS same_line
FROM r
JOIN public.closing_consensus cl
  ON cl.market_type = r.market_type AND cl.name = r.side_name
 AND cl.home_team = r.home_team AND cl.away_team = r.away_team
 AND abs(EXTRACT(epoch FROM (cl.commence_time - r.game_date))) <= 10800;

CREATE OR REPLACE VIEW public.prop_read_clv AS
WITH close AS (
  SELECT p.event_id, p.market, p.player_key,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY p.line) AS close_line,
         count(*) AS books,
         avg(public.implied_pp(p.over_price::numeric) / NULLIF(public.implied_pp(p.over_price::numeric) + public.implied_pp(p.under_price::numeric), 0)) AS close_over_prob
  FROM public.player_props p
  WHERE p.line IS NOT NULL AND p.over_price IS NOT NULL AND p.under_price IS NOT NULL
  GROUP BY 1, 2, 3
)
SELECT r.id, r.event_id, r.commence_time, r.market, r.player_name, r.line, r.side, r.edge_pp, r.tier, r.anchor_prob, r.actual_outcome,
       c.close_line, c.books AS close_books, round(c.close_over_prob::numeric, 4) AS close_over_prob,
       round((CASE WHEN r.side = 'over' THEN c.close_over_prob ELSE 1 - c.close_over_prob END
              - CASE WHEN r.side = 'over' THEN r.anchor_prob ELSE 1 - r.anchor_prob END)::numeric * 100, 2) AS price_clv_pp,
       CASE WHEN r.side = 'over' THEN c.close_line - r.line ELSE r.line - c.close_line END AS line_clv_points,
       (r.line = c.close_line) AS same_line
FROM public.prop_reads r
JOIN close c ON c.event_id = r.event_id AND c.market = r.market AND c.player_key = r.player_key;

GRANT SELECT ON public.closing_consensus, public.pick_clv_all, public.replay_clv, public.prop_read_clv TO authenticated, service_role;
