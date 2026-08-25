-- mv_public_record v4: bet_type joins the dedupe key (owner approved
-- 2026-08-24, spotlight lane).
--
-- The v3 dedupe collapsed to one pick per game per domain
-- (matchup + game_date + trap/leg flags), which silently discarded any
-- second market on the same game: a spread spotlight and the headline
-- moneyline can now coexist as separate published picks, so the record
-- must count them separately. Adding s.bet_type to the DISTINCT ON key
-- keeps the duplicate-row protection (same game, same market, published
-- twice still collapses to the freshest row) while letting different
-- markets on one game each count once.
--
-- The transformation edits the live definition in place instead of
-- restating 11KB of SQL, and raises if the expected key text is absent
-- so a drifted definition fails loudly instead of silently rebuilding
-- without the change. Grants are restated because DROP loses them and
-- that has silently zeroed every public stat before (ship-skill gotcha).
DO $mig$
DECLARE
  def text;
  before text;
BEGIN
  SELECT definition INTO def FROM pg_matviews WHERE matviewname = 'mv_public_record';
  IF def IS NULL THEN
    RAISE EXCEPTION 'mv_public_record not found';
  END IF;
  def := rtrim(def, E'; \n');

  before := def;
  def := replace(def,
    'DISTINCT ON (s.home_team, s.away_team, s.game_date, (s.tier = ''Trap''::text), (s.tier = ''Leg''::text))',
    'DISTINCT ON (s.home_team, s.away_team, s.game_date, s.bet_type, (s.tier = ''Trap''::text), (s.tier = ''Leg''::text))');
  IF def = before THEN
    RAISE EXCEPTION 'DISTINCT ON key not found in mv_public_record definition; aborting';
  END IF;

  before := def;
  def := replace(def,
    'ORDER BY s.home_team, s.away_team, s.game_date, (s.tier = ''Trap''::text), (s.tier = ''Leg''::text), ((s.actual_outcome)::text = ''pending''::text)',
    'ORDER BY s.home_team, s.away_team, s.game_date, s.bet_type, (s.tier = ''Trap''::text), (s.tier = ''Leg''::text), ((s.actual_outcome)::text = ''pending''::text)');
  IF def = before THEN
    RAISE EXCEPTION 'ORDER BY key not found in mv_public_record definition; aborting';
  END IF;

  EXECUTE 'DROP MATERIALIZED VIEW public.mv_public_record';
  EXECUTE 'CREATE MATERIALIZED VIEW public.mv_public_record AS ' || def;
END $mig$;

CREATE UNIQUE INDEX idx_mv_public_record_key
  ON public.mv_public_record (period_bucket, dimension_type, dimension_value);

GRANT SELECT ON public.mv_public_record TO anon, authenticated, service_role;
