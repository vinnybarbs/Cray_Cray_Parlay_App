-- Soccer 1X2 v2 starting setup (owner "Switch now", 2026-10-13). The v1
-- edge was Shin consensus minus proportional consensus of the same prices,
-- a devig artifact that leaned to the favorite on every game (EPL and MLS
-- shadow reads 46.9 percent against 49.7 implied, -29.8u). v2 devigs both
-- sides one way, so soccer claims are 0 until a fitted factor exists, and
-- adds a 3pp claim floor, an 8pp cap, a 4pp draw cap, a +250 and -250
-- price fence and a three book minimum (lib/services/edge-models/soccer-1x2.js).
--
-- A change to how claims are generated is a new regime: every soccer
-- sport's fit floor advances to 2026-10-14 so v1 reads never mix with v2
-- in a bucket scorecard, and model_weight_changes carries the evidence row.
insert into public.band_fit_floors (sport, fit_floor, reason, updated_at)
select s, '2026-10-14'::date, 'soccer 1X2 v2 starting setup (owner 2026-10-13)', now()
from unnest(array['EPL', 'MLS', 'Soccer', 'World Cup', 'Champions League', 'Europa League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Copa America', 'Euros']) s
on conflict (sport) do update set fit_floor = excluded.fit_floor, reason = excluded.reason, updated_at = excluded.updated_at;

insert into public.model_weight_changes (changed_at, sport, component, before, after, reason, source)
select now(), s, 'soccer_1x2_model',
  '{"devig": "shin over proportional", "goal_weight": 0.35, "max_edge": 0.15, "min_claim": 0, "draw_cap": null, "price_fence": null, "min_books": 1}'::jsonb,
  '{"devig": "proportional both sides", "goal_weight": 0, "max_edge": 0.08, "min_claim": 0.03, "draw_cap": 0.04, "price_fence": [-250, 250], "min_books": 3}'::jsonb,
  'v1 edge was a devig artifact: 245 graded EPL and MLS reads, 99 percent favorites, 46.9 actual vs 49.7 implied, -29.8u. Research 2026-10-13 in the project folder research/2026-10-13-soccer-model-starting-point.md.',
  'owner-approved-2026-10-13'
from unnest(array['EPL', 'MLS']) s;
