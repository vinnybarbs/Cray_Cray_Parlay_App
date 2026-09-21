-- Owner 2026-09-21: "legs should be reserved for near sure things."
--
-- The leg pool floor was a flat 0.65 code constant tuned for MLB, where
-- books cap favorites near -250. In the NFL, where books post -900, it
-- swept in every -200 favorite: 18 NFL legs in 30 days at break even,
-- Sunday's pool was the moneyline favorite in every game. It is a dial
-- now, leg_prob_floor, read per sport by pre-analyze.

insert into public.sport_dials (sport, dial, value) values
  ('__all__', 'leg_prob_floor', 0.75),
  ('NFL', 'leg_prob_floor', 0.80),
  ('MLB', 'leg_prob_floor', 0.70)
on conflict (sport, dial) do update set value = excluded.value, updated_at = now();

insert into public.model_weight_changes (sport, component, before, after, reason, source) values
  ('__all__', 'leg_prob_floor (new dial): the model win probability a no-pick side needs to publish as a Leg',
   jsonb_build_object('leg_prob_floor', 0.65, 'note', 'flat code constant, every sport'),
   jsonb_build_object('__all__', 0.75, 'NFL', 0.80, 'MLB', 0.70, 'code_default', 0.65),
   'Owner 2026-09-21: legs are near sure things. Last 30 days by sport and model band (hit rate vs break even at the price): NFL 65-72 9 legs 78 pct vs 69, NFL 72-80 6 legs 50 pct vs 77, NFL 80 plus 3 legs 67 pct vs 85 (18 NFL legs, -1.7u); MLB 65-72 15 legs 67 pct vs 66; Tennis 184 legs 84 pct vs 80 (+5.9u); UFC 65-72 17 legs 53 pct vs 71 (-4.2u). Legs overall 203-53 for -0.2u: a parlay pool at break even by design. At 0.80 the 30 day NFL pool would have been three legs. MLB sits at 0.70 because the book cap near -250 makes 0.75 an empty pool. Requiring the model to agree with the price was checked and rejected: Tennis legs the model called overpriced went 69-13.',
   'owner-approved-2026-09-21');

insert into public.build_queue (priority, status, title, detail) values
  ('medium', 'done', 'Leg pool floor is a dial: leg_prob_floor __all__ 0.75, NFL 0.80, MLB 0.70 (owner 2026-09-21)',
   'Legs are reserved for near sure things. pre-analyze reads leg_prob_floor per sport from the dial board (edge-calculator dialValue, code default 0.65 so a board outage reproduces the old pool). Evidence in model_weight_changes. The receipts card and the parlay builder both get a shorter, heavier NFL leg list from the next slate.');
