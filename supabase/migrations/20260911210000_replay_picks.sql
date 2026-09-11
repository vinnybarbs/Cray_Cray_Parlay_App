-- The counterfactual replay harness (owner 2026-09-11: "replay julys
-- formula against the last 30 days from today"). One row per replayed
-- pick: which formula, which game, which side, at what stored price,
-- and how it graded. Never touches the record; the weekly review reads
-- it to compare formulas on identical games before any dial moves.
CREATE TABLE IF NOT EXISTS public.replay_picks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id text NOT NULL,
  formula text NOT NULL,
  sport text NOT NULL,
  game_key text NOT NULL,
  game_date timestamptz,
  home_team text,
  away_team text,
  side text NOT NULL,
  pick text,
  edge_pp numeric,
  edge_pp_raw numeric,
  tier text,
  odds numeric,
  outcome text,
  units numeric,
  home_score int,
  away_score int,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, formula, game_key)
);
COMMENT ON TABLE public.replay_picks IS
  'Counterfactual replay output (lib/replay/replay-formula.js, /cron/replay-formula). formula july = frozen 2026-07-22 calculator with July multipliers; current = live calculator with live dials, band maps, raw gate, price rails. Graded at analysis-time stored prices. Not the record.';
CREATE INDEX IF NOT EXISTS idx_replay_picks_run ON public.replay_picks (run_id, formula);
ALTER TABLE public.replay_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS replay_picks_service ON public.replay_picks;
CREATE POLICY replay_picks_service ON public.replay_picks FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.replay_picks TO authenticated, service_role;
GRANT INSERT, UPDATE ON public.replay_picks TO service_role;
