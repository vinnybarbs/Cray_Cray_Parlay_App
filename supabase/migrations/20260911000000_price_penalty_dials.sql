-- The price rails become pp deductions on the dial board (owner,
-- 2026-09-10: "doesn't matter what label we give it, we score ourselves
-- off pp ... we should be tweaking pp not adjusting tier label by
-- feel"). Until now the -150 chalk fence withheld the Sharp Take label
-- and the +300 longshot ceiling capped the label at Lean, both inside
-- edgeTier. Now each rail deducts from the claim BEFORE the ladder
-- (lib/services/price-penalties.js), the tier is nothing but the band
-- of the adjusted claim, and the published edge_pp carries the
-- deduction so the record scores exactly what was claimed.
--
--   chalk_penalty_pp    3: flat deduction at -150 or heavier. A 12pp
--                          chalk claim publishes at 9 (Strong Play), a
--                          14pp monster still reaches Sharp Take, which
--                          the fence could never let through.
--   longshot_penalty_pp 6: deduction at +300, scaled by price over 300
--                          (+600 deducts 12, +1300 deducts 26), floored
--                          at the 2pp Lean gate. No name team at +1300
--                          lands at Lean whatever it claimed, the same
--                          end state as the ceiling, now visible in pp.
--
-- Seeded on __all__; a sport row overrides like any other dial and a
-- zero switches a rail off for that sport. Tennis at +251 stays a hard
-- publish fence (directive 4), it is a void not a penalty.
INSERT INTO sport_dials (sport, dial, value) VALUES
  ('__all__', 'chalk_penalty_pp', 3),
  ('__all__', 'longshot_penalty_pp', 6)
ON CONFLICT (sport, dial) DO NOTHING;

INSERT INTO model_weight_changes (sport, component, before, after, reason, source) VALUES
  ('__all__', 'chalk_penalty_pp',
   '{"mode": "label fence", "rule": "no Sharp Take at -150 or heavier"}'::jsonb,
   '{"mode": "deduct pp", "chalk_penalty_pp": 3}'::jsonb,
   'Owner 2026-09-10: every rail is a pp adjustment, never a label swap. Seed 3pp: a fenced 12pp chalk claim used to publish Strong Play, it now publishes 9pp Strong Play with the haircut on the record. Dialable per sport.',
   'claude-code'),
  ('__all__', 'longshot_penalty_pp',
   '{"mode": "label ceiling", "rule": "nothing above Lean at +300 or longer"}'::jsonb,
   '{"mode": "deduct pp", "longshot_penalty_pp": 6, "scaling": "odds over 300"}'::jsonb,
   'Owner 2026-09-10: every rail is a pp adjustment, never a label swap. Seed 6pp at +300 scaling with price so +1300 reads floor at the Lean gate, the ceiling end state made visible in pp. Dialable per sport.',
   'claude-code');

-- Directives 2 and 3 were label rules. They are superseded, not retired:
-- the intent (price is a likelihood and heavy chalk claims are mostly
-- vig) survives as directive 16, enforced on the pp scale.
UPDATE directives SET status = 'superseded', updated_at = now(),
  notes = coalesce(notes, '') || ' Superseded 2026-09-10 by directive 16: the longshot rail is a pp deduction (longshot_penalty_pp), not a label ceiling.'
WHERE id = 2;
UPDATE directives SET status = 'superseded', updated_at = now(),
  notes = coalesce(notes, '') || ' Superseded 2026-09-10 by directive 16: the chalk rail is a pp deduction (chalk_penalty_pp), not a label fence.'
WHERE id = 3;

INSERT INTO directives (directive, decided_on, enforcement, check_sql, notes) VALUES
('Every rail is a pp adjustment on the dial board, never a label swap. The tier is nothing but the pp band of the published claim. Price rails: -150 or heavier deducts chalk_penalty_pp, +300 or longer deducts longshot_penalty_pp scaled by price, floored at the 2pp Lean gate. The exposure guard deducts exposure_guard_pp. Tennis at +251 stays a hard publish fence (directive 4). Tuning happens on the pp dials with evidence, never by feel on the label.', '2026-09-10',
 'lib/services/price-penalties.js and exposure-guard.js deduct before edgeTier; edgeTier in pick-grader.js and src/lib/tiers.js are pure pp bands; sport_dials chalk_penalty_pp, longshot_penalty_pp, exposure_guard_pp; tests price-penalties, tiers-mirror, exposure-guard',
 'select id, sport, tier, odds, edge_pp from ai_suggestions where voided_at is null and session_id like ''auto_digest%'' and created_at > now() - interval ''2 days'' and odds ~ ''^[+-]?[0-9]+$'' and tier in (''Sharp Take'',''Strong Play'',''Play'',''Lean'') and ((odds::numeric <= -150 and reasoning not like ''%Chalk price:%'') or (odds::numeric >= 300 and reasoning not like ''%Longshot price:%'')) and edge_pp_raw is not null and edge_pp_raw >= 2',
 'Born from 2026-09-10 Sharp Take scores publishing as Strong Play through the chalk fence and the exposure guard demotion. The check finds published bet-tier rows at a railed price whose reasoning lacks the deduction marker, meaning a rail was skipped.');
