-- Lure-based trap detection (2026-07-24).
--
-- A Trap is no longer the mirror of the pick. It is a side the casual
-- bettor is drawn to (lure score from chalk, streaks, home lean, juicy-dog
-- pricing, popular Overs) that the model prices at -2pp or worse. Both
-- conditions required. See lib/services/trap-detector.js and
-- docs/models/trap-detector.md.

-- All detector-qualified traps for a game, strongest first. The board
-- renders these as standalone trap tiles, independent of the pick.
-- Shape: [{ side, edge_pp, lure_score, signals: [{key, label, pts}] }]
ALTER TABLE game_analysis
  ADD COLUMN IF NOT EXISTS trap_calls JSONB;

-- Published trap rows carry their lure evidence so the trap record can be
-- analyzed by signal (which lures actually mark money-losing sides), not
-- just by edge magnitude. Null on non-trap pick rows.
ALTER TABLE ai_suggestions
  ADD COLUMN IF NOT EXISTS lure_score NUMERIC,
  ADD COLUMN IF NOT EXISTS trap_signals JSONB;

COMMENT ON COLUMN game_analysis.trap_calls IS
  'Detector-qualified traps: lure_score >= 25 AND side edge <= -2pp. Strongest first.';
COMMENT ON COLUMN ai_suggestions.lure_score IS
  'Lure score of the named trap side at publish time. Null for non-trap rows.';
COMMENT ON COLUMN ai_suggestions.trap_signals IS
  'Lure signal breakdown [{key,label,pts}] for trap rows. Null for non-trap rows.';
