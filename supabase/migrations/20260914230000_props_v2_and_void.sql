-- Owner 2026-09-14 on the first graded props week (192-170 shadow, the
-- ladder flat, claims four times what they deliver, CLV negative):
-- "yards over under passing yards are more reliable and with the right
-- research and data can become reliable hits", "1-4 suggestions go".
--
-- 1. Grading gap: a pending read whose player has no stat line after the
--    week's file has landed is a book void, not a pick that waits
--    forever. The grader voids it (actual_outcome void).
-- 2. A v2 shadow read stored NEXT TO the v1 read on every prop_reads row
--    and graded next to it: the v1 baseline mean scaled by the opponent's
--    allowance per game against league average, the team's implied
--    points from the game line against the slate average, and wind on
--    the passing markets outdoors, with the read skipped when the player
--    is listed out (Sleeper status or the official designation). The v1
--    read, its edge and its tier are untouched, so the frozen regime
--    (directive 21) is measured as is and v2 is measured beside it.
--    Directive 19 audit, stated plainly: the book's line already prices
--    the opponent and the game environment to a large degree, so v2 is
--    expected to REDUCE over claiming (a mean closer to what the book
--    knows) rather than add information the line lacks. Availability is
--    the one input the line can lag. The weekly review judges v1 against
--    v2 per market and band, and v2 replaces v1 only through the three test
--    counterfactual after the freeze.

ALTER TABLE public.prop_reads
  ADD COLUMN IF NOT EXISTS v2_mean numeric,
  ADD COLUMN IF NOT EXISTS v2_prob numeric,
  ADD COLUMN IF NOT EXISTS v2_edge_pp numeric,
  ADD COLUMN IF NOT EXISTS v2_side text,
  ADD COLUMN IF NOT EXISTS v2_tier text,
  ADD COLUMN IF NOT EXISTS v2_outcome text,
  ADD COLUMN IF NOT EXISTS v2_factors jsonb;
COMMENT ON COLUMN public.prop_reads.v2_edge_pp IS
  'Shadow v2 read (2026-09-14): v1 baseline scaled by opponent allowance, team implied points and wind, same anchor and damp. Judged next to edge_pp, never published. v2_outcome grades v2_side against the same stat line; actual_outcome void means the player had no stat line after the week file landed.';

-- The v2 dials on the NFL_props board (directive 7). Code defaults in
-- prop-edge.js mirror these.
INSERT INTO sport_dials (sport, dial, value) VALUES
  ('NFL_props', 'prop_opp_weight', 0.5),
  ('NFL_props', 'prop_env_weight', 0.5),
  ('NFL_props', 'prop_wind_weight', 0.1)
ON CONFLICT (sport, dial) DO NOTHING;

INSERT INTO model_weight_changes (sport, component, before, after, reason, source) VALUES
  ('NFL_props', 'prop_v2_shadow_seed', '{}'::jsonb,
   '{"prop_opp_weight": 0.5, "prop_env_weight": 0.5, "prop_wind_weight": 0.1, "availability": "skip when Sleeper or the official report lists the player out, doubtful, IR, PUP or suspended"}'::jsonb,
   'Shadow only seed of the props v2 read, stored beside v1 and graded beside it; no published claim changes. Evidence for building it: week 1 v1 shadow 192-170 with a flat ladder (Sharp Take 35-32 on 12.7pp claims, Play 47-36 on 5.2pp) and price CLV -0.22pp beating the close 29.7 percent, so the player log alone over claims by about four to one. Opponent allowance pooled from the 2025 season and 2026 to date (nfl_player_game_stats by opponent), team implied points from the median spread and total across books, wind from Open-Meteo on the passing markets. Promotion only through the three test counterfactual after 2026-09-27.',
   'props-v2-seed');

-- Directive 21: a shadow only seed touches no published claim. Amend by
-- id so the freeze check knows the source.
UPDATE directives SET
  directive = directive || ' Amended 2026-09-14 (owner "go" on the props v2 shadow): a shadow-only formula seed that changes no published claim (source props-v2-seed) is allowed during the freeze; it is measured beside the frozen read and replaces it only through the three tests after the freeze.',
  check_sql = replace(check_sql, '''directive-10-restore''', '''directive-10-restore'', ''props-v2-seed''')
WHERE id = 21;

UPDATE build_queue SET updated_at = now(),
  detail = detail || ' FIRST GRADED WEEK 2026-09-14 (run a day early, the nflverse week 1 file was out): 192-170 shadow, Sharp Take 35-32 on 12.7pp claims, Strong Play 34-31, Play 47-36, Lean 36-35, Skip 40-36; overs 100-80, unders 52-54; pass yds 12-8 the best market; price CLV -0.22pp beating the close 29.7 percent. The ladder is flat, claims run four times delivery. SHIPPED the same day: the grader voids a read whose player has no stat line after the week file lands (13 stuck rows), and a v2 shadow read (opponent allowance, team implied points, wind, availability skip; dials prop_opp_weight 0.5, prop_env_weight 0.5, prop_wind_weight 0.1) stored beside v1 in prop_reads.v2_* and graded beside it. NEXT: the Monday review compares v1 to v2 per market and band on three weeks (section 5b in the review skill); a props band map fit and the damp revisit wait for the freeze to lift 2026-09-27; display waits for the directive 20 bar (build_queue 38).'
WHERE id = 6;

INSERT INTO build_queue (priority, status, title, detail) VALUES
  ('low', 'open', 'Props on the site: a digest tile after the directive 20 bar',
   'Nothing about props reaches users until the shadow ledger clears the bar (75 publishable graded reads, actual at or above implied, positive units, positive closing line value) and the owner calls it. When it does: a props tile on the digest that reuses the existing pick card, the existing tier ladder and mv_public_record for its record, so nothing new has to be trusted. Owner preference 2026-09-14: yards markets first, passing yards in particular (week 1 pass yds 12-8). No API serves prop_reads today and the frontend has no props view; both are deliberate.');
