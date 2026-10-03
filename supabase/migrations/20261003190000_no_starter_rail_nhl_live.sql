-- Owner 2026-10-03: "for post season if there isn't probable then we
-- should just cut pp and still publish. nhl needs to come out of shadow."
--
-- 1. The no starter rail. An MLB read with no Probable starters factor
--    (October: ESPN probables carry no ERA) deducts no_starter_penalty_pp
--    and publishes, instead of the shadow hold the gate logged on 12 of
--    12 postseason picks. lib/services/price-penalties.js, the pipeline
--    and the replay all read the dial. The shadow gate starter_required
--    keeps logging so rule_gate_scorecard judges the rail's size.
insert into public.sport_dials (sport, dial, value) values
  ('__all__', 'no_starter_penalty_pp', 0),
  ('MLB', 'no_starter_penalty_pp', 3)
on conflict (sport, dial) do update set value = excluded.value, updated_at = now();

insert into public.model_weight_changes (sport, component, before, after, reason, source) values
  ('MLB', 'no_starter_penalty_pp: the no starter rail',
   jsonb_build_object('no_starter_penalty_pp', null, 'note', 'no rail, the shadow gate starter_required logged a hold and the pick published at its full claim'),
   jsonb_build_object('no_starter_penalty_pp', 3),
   'Owner 2026-10-03: a read without probable starters cuts pp and still publishes. Evidence since 08-01: ML favorites without the Probable starters factor 11-13 -6.7u, -1.5 favorites without it 9-22 -11.2u, with it 99-53 +12.7u. Seeded at the chalk rail size (3pp) and judged on rule_gate_scorecard (starter_required held cohort) and the railed population in the weekly review.',
   'owner-approved-2026-10-03');

update public.rule_gates set
  evidence = evidence || ' Owner 2026-10-03: the live answer is the no starter rail (no_starter_penalty_pp, MLB 3), a deduction, not a hold. This gate keeps logging the same reads so the rail is scored.',
  updated_at = now()
 where rule_key = 'starter_required';

update public.directives set
  notes = coalesce(notes, '') || ' 2026-10-03: a third rail, no_starter_penalty_pp (MLB 3), deducts from an MLB read with no Probable starters factor, marker "No starters:" in reasoning.'
 where id = 16;

-- 2. NHL out of shadow. The owner read the shadow ledger (37 reads, h2h
--    60.0 actual against 52.9 implied, CLV -0.92, spreads CLV -3.14,
--    totals CLV +5.38, nothing at the directive 20 bar) and said go. This
--    is an owner exception to directive 10's entry bar, recorded here,
--    and the second clause of directive 10 still applies: NHL is judged
--    weekly against both its published and shadow record.
insert into public.sport_dials (sport, dial, value) values
  ('NHL', 'publish_ml', 1), ('NHL', 'publish_spread', 1), ('NHL', 'publish_total', 1)
on conflict (sport, dial) do update set value = 1, updated_at = now();

insert into public.model_weight_changes (sport, component, before, after, reason, source) values
  ('NHL', 'publish_ml, publish_spread, publish_total: regular season live',
   jsonb_build_object('publish_ml', 0, 'publish_spread', 0, 'publish_total', 0),
   jsonb_build_object('publish_ml', 1, 'publish_spread', 1, 'publish_total', 1),
   'Owner 2026-10-03: "nhl needs to come out of shadow." Five days into the regular season. Shadow ledger at the flip: h2h 15 publishable 60.0 actual vs 52.9 implied CLV -0.92, spreads 12 at 66.7 vs 65.2 CLV -3.14, totals 10 at 20.0 vs 49.4 CLV 5.38. Owner exception to the directive 10 entry bar, judged weekly per its second clause. Goalie and lineup inputs still to build.',
   'owner-approved-2026-10-03');

update public.directives set
  notes = coalesce(notes, '') || ' Owner exception 2026-10-03: NHL went live at the regular season by owner decision with 37 shadow reads, under the entry bar. The weekly judgment clause applies in full and the performance review reports NHL per market from its first live week.'
 where id = 10;

update public.build_queue set
  detail = detail || ' 2026-10-03: NHL flipped to 1 on all three markets by owner decision (model_weight_changes row, source owner-approved-2026-10-03). NBA and NCAAB remain 0 until their regular seasons open.'
 where id = 56;

update public.build_queue set status = 'done',
  detail = detail || ' RESOLVED 2026-10-03 by owner decision: the read publishes with no_starter_penalty_pp (MLB 3) deducted and the marker No starters in reasoning. The postseason probables source (MLB StatsAPI) stays worth building so the factor returns in October.'
 where title like 'MLB postseason reads carry no Probable starters factor%';

insert into public.build_queue (priority, status, title, detail) values
  ('high', 'open', 'NHL live from 2026-10-03: goalie confirmation and lineup inputs into the NHL read, and the first weekly NHL per market review',
   'Owner flipped NHL live on 37 shadow reads. The review skill reports NHL h2h, puck line and total separately from the first live week against the shadow record at the flip (h2h CLV -0.92, spreads -3.14, totals +5.38). The starting goalie is to hockey what the probable starter is to baseball: build the confirmed goalie input (NHL API or ESPN) as a factor with a dial, and a no goalie rail on the same pattern as no_starter_penalty_pp.');
