-- NCAAF program-strength prior (owner-funded CFBD build, 2026-09-05).
-- The human signal encoded: last season's SP+ regressed 70/30 to the
-- current conference mean, the team's 2026 conference and tier, and the
-- preseason AP rank for context. `strength` is what the edge model
-- reads as a factor arguing off the market anchor. Season-static:
-- loaded once per season from the CollegeFootballData API (2026 seed
-- loaded 2026-09-05 via in-database fetch; the API key lives with the
-- owner, not in this repo).
CREATE TABLE IF NOT EXISTS ncaaf_team_strength (
  season integer NOT NULL,
  team text NOT NULL,
  conference text,
  conf_tier integer,
  sp_rating_raw numeric,
  sp_rating numeric,
  preseason_ap_rank integer,
  strength numeric NOT NULL,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (season, team)
);
COMMENT ON TABLE ncaaf_team_strength IS
  'Preseason program strength prior per team-season: prior-year SP+ regressed 70/30 to the current conference mean, preseason AP rank stored for context. strength is what the edge model reads. Loaded from the CollegeFootballData API.';
