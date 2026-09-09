-- Per-input fingerprints next to the change gate hash (ops finding,
-- fourteen consecutive reports): the MLB change gate sat near zero
-- skips for two weeks with the churning input unidentifiable from
-- outside the process. Each analysis now stores a short hash per
-- context input so two versions of the same game can be diffed by name.
ALTER TABLE game_analysis ADD COLUMN IF NOT EXISTS context_parts jsonb;
COMMENT ON COLUMN game_analysis.context_parts IS
  'Per-input fingerprints (first 10 hex of sha256) of the change gate inputs: odds, rank, news, injuries, trends, stats, tennis, pitchers, edge, pick, traps. Diff across versions to name what churned.';
