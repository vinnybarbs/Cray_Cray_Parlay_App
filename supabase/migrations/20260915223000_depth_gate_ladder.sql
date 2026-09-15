-- Owner 2026-09-15, on seeing the first gated read: "the depth chart
-- gate only works if it is a starter, backup QB injured means nothing,
-- WR3 means less than WR1, that's why we have the depth chart." The
-- flat half weight for rank 2 becomes a per position ladder in code
-- (DEPTH_LADDER, lib/services/football-injuries.js): QB starter only,
-- RB 1 and 0.5, WR 1, 0.8, 0.6, 0.2, TE 1 and 0.5, one starter per
-- line slot, DL and CB 1 and 0.5, LB and S 1 and 0.3, specialists
-- starter only. The injury_depth2_weight dial is retired, the unknown
-- rank dial stays.

DELETE FROM sport_dials WHERE dial = 'injury_depth2_weight';

INSERT INTO model_weight_changes (sport, component, before, after, reason, source) VALUES
  ('NFL', 'injury factor depth chart gate: per position ladder replaces injury_depth2_weight',
   jsonb_build_object('rank_1', 1, 'rank_2', 'injury_depth2_weight 0.5 for every position', 'rank_3_and_below', 0),
   jsonb_build_object('QB', jsonb_build_array(1), 'RB', jsonb_build_array(1, 0.5), 'WR', jsonb_build_array(1, 0.8, 0.6, 0.2), 'TE', jsonb_build_array(1, 0.5), 'OL', jsonb_build_array(1), 'DL', jsonb_build_array(1, 0.5), 'LB', jsonb_build_array(1, 0.3), 'CB', jsonb_build_array(1, 0.5), 'S', jsonb_build_array(1, 0.3), 'ST', jsonb_build_array(1), 'unlisted', 'injury_depth_unknown_weight 0.5'),
   'Owner 2026-09-15: a backup quarterback out means nothing, a third receiver means less than the first. The nflverse chart ranks a position across the formation (WR1 through WR7), so the rank carries that order and the ladder prices it. Same regime line as the gate (band_fit_floors NFL 2026-09-16).',
   'owner-approved-2026-09-15');

COMMENT ON VIEW public.nfl_depth_rank_floor IS
  'Per club and player, the best (lowest) depth chart rank over the last 28 days of nflverse snapshots. Read by lib/services/football-injuries.js loadDepthRanks for the injury factor depth gate: the position cost times the DEPTH_LADDER share for the rank (QB starter only, WR1 through WR4 tapering, one starter per line slot), unlisted times injury_depth_unknown_weight.';

UPDATE build_queue SET updated_at = now(),
  detail = detail || ' AMENDED 2026-09-15 evening (owner: backup QB means nothing, WR3 less than WR1): the flat rank 2 half weight became the per position DEPTH_LADDER in code and injury_depth2_weight was retired (migration 20260915223000).'
WHERE title = 'NFL injury factor depth chart gate and seed_weight dial (owner 2026-09-15)';
