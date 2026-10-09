-- 2026-10-09: owner approved Sunday sweep candidate 85 (MLB venue_lo).
-- venue_weight MLB 0.3125 to 0.2344, the first step capped at 25 percent of
-- the current weight. The reading repeated on 09-27 (candidate 59) and
-- 10-04, so the next repeating Sunday may propose the full move to 0.15.
-- Candidates 47 and 58 (gate3) are discarded: raising the 2pp gate is on
-- the never list.
update sport_dials set value = 0.2344, updated_at = now() where sport = 'MLB' and dial = 'venue_weight';

insert into model_weight_changes (sport, component, before, after, reason, source) values (
  'MLB',
  'venue_weight: Sunday sweep candidate 85 (venue_lo)',
  '{"venue_weight": 0.3125}'::jsonb,
  '{"venue_weight": 0.2344, "measured": 0.15, "step": "25 percent cap, first applied step"}'::jsonb,
  'Owner approved 2026-10-09 ("I approved all the changes"). Sweep weekly_sweep_mlb_20261004: venue_lo 127-134 -11.9u vs base 128-145 -23.3u (delta +11.4u), rescued 11 of 145 base losses, added publications 7-5 +1.5u on 12, Lean bucket -1.7pp vs base -3.4pp. Same reading on weekly_sweep_mlb_20260927 (candidate 59, +4.6u, fixed the Sharp Take bucket), so the reading repeated across two consecutive Sundays and the next repeat may take the full measured move to 0.15. Candidates 47 and 58 (gate3) discarded: raising the 2pp gate is on the never list.',
  'sunday-sweep-approved'
);

update build_queue set status = 'done', detail = detail || ' APPLIED 2026-10-09: owner approved, MLB venue_weight 0.3125 to 0.2344 in sport_dials with a model_weight_changes row (source sunday-sweep-approved). The reading repeated on 09-27 (row 59) and 10-04, so the next repeating Sunday may propose the full move to 0.15.', updated_at = now() where id = 85;
update build_queue set status = 'dismissed', detail = detail || ' DISMISSED 2026-10-09: superseded by candidate 85 (same variant, newer run), which the owner approved.', updated_at = now() where id = 59;
update build_queue set status = 'dismissed', detail = detail || ' DISMISSED 2026-10-09 (owner): raising the 2pp gate is on the never list (AGENTS.md, second report section 3), the gate3 variant will not be applied.', updated_at = now() where id in (47, 58);
