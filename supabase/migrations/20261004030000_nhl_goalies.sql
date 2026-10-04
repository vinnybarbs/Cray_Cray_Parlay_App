-- Owner 2026-10-03: "Get all inputs you need figure out how and execute
-- on it." The NHL starting goalie input, the night NHL went live.
--
-- The factor (lib/services/nhl-goalies.js, edge-calculator.js 4d2b): who
-- starts from DailyFaceoff (Confirmed, Likely, Projected, Unconfirmed)
-- with ESPN probables as the fallback, quality from the NHL API blended
-- with a 600 shot league prior, four points of win probability per .010
-- of gap capped at six, damped by goalie_anchor_damp when market anchored.
-- The gate goalie_required logs every NHL moneyline and puck line pick
-- without the factor, and the rail no_goalie_penalty_pp sits at 0 until
-- that log says what the absence costs.

insert into public.sport_dials (sport, dial, value) values
  ('NHL', 'goalie_anchor_damp', 0.5),
  ('__all__', 'no_goalie_penalty_pp', 0),
  ('NHL', 'no_goalie_penalty_pp', 0)
on conflict (sport, dial) do update set value = excluded.value, updated_at = now();

insert into public.model_weight_changes (sport, component, before, after, reason, source) values
  ('NHL', 'goalie_anchor_damp: the starting goalie factor',
   jsonb_build_object('factor', 'none', 'note', 'NHL reads carried no goalie input; the injury factor covered skaters only'),
   jsonb_build_object('goalie_anchor_damp', 0.5, 'pp_per_010_save_pct', 4, 'cap_pp', 6, 'league_prior_shots', 600, 'league_save_pct', 0.905),
   'Owner 2026-10-03, NHL live on 37 shadow reads with no goalie input. The factor mirrors the MLB probable starters factor (4pp per unit of gap, cap 6, damp 0.5 when anchored) so the first weeks are judged against a known shape. Starters from DailyFaceoff with ESPN fallback, quality from the NHL API (current and prior season shots weighted with a 600 shot .905 prior). Judged weekly per market from the first live week and in the football style lookback once 100 reads carry the factor.',
   'owner-approved-2026-10-03'),
  ('NHL', 'no_goalie_penalty_pp: the no goalie rail, seeded off',
   jsonb_build_object('no_goalie_penalty_pp', null),
   jsonb_build_object('no_goalie_penalty_pp', 0),
   'Same pattern as no_starter_penalty_pp (MLB 3). NHL has no ledger evidence yet, so the rail starts at 0 and the shadow gate goalie_required logs every pick without the factor. The rail moves when the held cohort on rule_gate_scorecard says what the absence costs.',
   'owner-approved-2026-10-03');

insert into public.rule_gates (sport, market, side, rule_key, params, mode, evidence, proposed_on, sunset_on) values
  ('NHL', 'any', 'any', 'goalie_required', '{"markets": ["ml", "spread"]}', 'shadow',
   'Built with the factor 2026-10-03. No ledger evidence yet: this gate IS the evidence collector. It logs pass when both starting goalies are named on the read and hold when they are not, so the no_goalie_penalty_pp rail can be sized from the held cohort.',
   '2026-10-04', '2026-11-15')
on conflict (rule_key) do nothing;

update public.build_queue set status = 'done',
  detail = detail || ' SHIPPED 2026-10-04: Starting goalies factor (nhl-goalies.js, DailyFaceoff plus ESPN fallback, NHL API quality blend), goalie_anchor_damp NHL 0.5, goalie_required shadow gate, no_goalie_penalty_pp seeded 0, goalies in the narration context and the change gate. Lineups: the existing ESPN injury factor (injury_weight NHL 1) carries skater absences; a confirmed lines input is a later build.'
 where title like 'NHL live from 2026-10-03: goalie confirmation%';

insert into public.build_queue (priority, status, title, detail) values
  ('medium', 'done', 'Research modal showed NCAAF as Shadow while the digest tile showed the published total',
   'Owner 2026-10-03. The modal fetch of /api/deep-research called setPublishFlags with a response that had no publishMarkets block, which reset the client flags to empty, and the code shadow list (NCAAF still on it) then dressed NCAAF totals as Shadow. setPublishFlags now ignores a response without the block, and /api/deep-research sends publishMarkets so the modal refreshes from the same dial board as the digest.');
