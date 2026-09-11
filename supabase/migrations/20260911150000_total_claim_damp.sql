-- Step one for totals (owner, 2026-09-11: "totals should still start
-- with step one"): the book total is the anchor and the PPG scoring
-- model argues off it. edge-calculator._anchoredModelTotal prices
--   modeled = book + total_claim_damp * confidence * (scoring - book)
-- where confidence ramps from 0 at no games to 1 at five games on the
-- shorter of the two seasons. Measured 2026-09-11 across 49 upcoming
-- NCAAF games: average absolute raw read 20.0pp on totals versus 2.4pp
-- moneyline and 2.7pp spread, week-2 PPG off one game claiming 25 to
-- 35pp against the book. That is the noise source in every NCAAF read.
--
-- Seeds: MLB stays at 1 (its totals band map was fitted on the full
-- disagreement and its published totals run 46-38 since 08-17; moving it
-- is a counterfactual for the Monday review, not a seed). Football and
-- the off-season sports seed at 0.5, matching spread_claim_damp. NFL
-- totals are muted at 0 anyway, NCAAF is shadow, so no live published
-- market changes how it generates claims and no band map resets.
INSERT INTO sport_dials (sport, dial, value) VALUES
  ('__all__', 'total_claim_damp', 1),
  ('MLB', 'total_claim_damp', 1),
  ('NFL', 'total_claim_damp', 0.5),
  ('NCAAF', 'total_claim_damp', 0.5),
  ('NBA', 'total_claim_damp', 0.5),
  ('NCAAB', 'total_claim_damp', 0.5),
  ('NHL', 'total_claim_damp', 0.5),
  ('EPL', 'total_claim_damp', 0.5),
  ('MLS', 'total_claim_damp', 0.5)
ON CONFLICT (sport, dial) DO NOTHING;

INSERT INTO model_weight_changes (sport, component, before, after, reason, source) VALUES
  ('NCAAF', 'total_claim_damp',
   '{"mode": "raw scoring total vs book", "damp": 1, "sample_confidence": false}'::jsonb,
   '{"mode": "book total anchor", "damp": 0.5, "sample_confidence": "min(1, games/5)"}'::jsonb,
   'Owner 2026-09-11: totals start with step one, the market anchor. 49 upcoming NCAAF games averaged 20.0pp absolute raw on totals vs 2.4 ml and 2.7 spread; week-2 PPG off one game claimed 25 to 35pp. Shadow sport, no published claims change.',
   'claude-code'),
  ('NFL', 'total_claim_damp',
   '{"mode": "raw scoring total vs book", "damp": 1, "sample_confidence": false}'::jsonb,
   '{"mode": "book total anchor", "damp": 0.5, "sample_confidence": "min(1, games/5)"}'::jsonb,
   'Owner 2026-09-11: totals start with step one. NFL totals are muted at multiplier 0, so the shadow totals record now measures anchored claims; the same 0.5 as spread_claim_damp.',
   'claude-code'),
  ('MLB', 'total_claim_damp',
   '{"mode": "raw scoring total vs book", "damp": 1}'::jsonb,
   '{"mode": "book total anchor", "damp": 1, "sample_confidence": "min(1, games/5)"}'::jsonb,
   'Seeded at 1 to reproduce current behavior exactly (46-38 published totals since 08-17, band map fitted on the full disagreement). A move to 0.5 is a Monday counterfactual under directive 8, not a seed.',
   'claude-code');

UPDATE build_queue SET status = 'done', updated_at = now(),
  detail = detail || ' DONE 2026-09-11: totals now anchor at the book total with total_claim_damp per sport and a season sample confidence (edge-calculator _anchoredModelTotal). NCAAF and NFL at 0.5, MLB at 1 pending the Monday counterfactual. The shadow totals record question stands for the weekly review.'
WHERE id = 22;

INSERT INTO build_queue (title, detail, priority, status) VALUES
  ('Monday counterfactual: MLB total_claim_damp 1 to 0.5', 'Replay the 84 graded MLB totals since 08-17 (46-38) and the shadow totals rows with the disagreement halved. The shadow band map says small claims over-deliver (2-4 band delivered 10.5pp on 38) and big claims under-deliver (10+ delivered 3.3pp on 105), which halving compresses toward. If it rescues the 10+ losers, improves the whole MLB totals record, and holds on shadow, move the dial (25 percent damped step under directive 8) and reset the MLB total band map to identity with p_total_fit_floor advanced (directive 9).', 'medium', 'open');
