-- Owner 2026-10-03, reaffirmed 10-04: "Get all inputs you need figure out
-- how and execute on it." The NHL lineup input beside the goalie input.
-- lib/services/nhl-lines.js reads each club's DailyFaceoff line chart:
-- the injured group (IR in full, day to day at 0.4), the player's even
-- strength slot or his cap hit as the ladder, nhl_skater_out_pp per full
-- weight skater, nhl_lineup_cap_pp per club. It replaces the generic
-- injury word counter for NHL, which stays as the fallback.

insert into public.sport_dials (sport, dial, value) values
  ('NHL', 'nhl_skater_out_pp', 0.015),
  ('NHL', 'nhl_lineup_cap_pp', 0.05)
on conflict (sport, dial) do update set value = excluded.value, updated_at = now();

insert into public.model_weight_changes (sport, component, before, after, reason, source) values
  ('NHL', 'nhl_skater_out_pp, nhl_lineup_cap_pp: the lineup factor',
   jsonb_build_object('factor', 'generic injury word counter', 'note', 'out 2pp, doubtful 1pp, questionable 0.5pp from news_cache text, capped 3pp, blind to who the player is'),
   jsonb_build_object('nhl_skater_out_pp', 0.015, 'nhl_lineup_cap_pp', 0.05, 'slot_ladder', 'f1 1, f2 0.7, f3 0.4, f4 0.15, d1 1, d2 0.6, d3 0.25', 'cap_ladder', '0 at 1.0M, 1 at 7.5M', 'status', 'ir 1, dtd 0.4'),
   'Owner 2026-10-03: goalie and lineup inputs for NHL. The chart names the absences and the cap hit prices them where the chart has already pulled the player off the lines, the same idea as the NFL depth gate. Seeded at 1.5pp per full weight skater and a 5pp club cap, inside the old 3pp generic cap on a single star and above it only for a club missing several. Judged in the weekly NHL per market review and the lookback once 100 reads carry it.',
   'owner-approved-2026-10-03');

insert into public.build_queue (priority, status, title, detail) values
  ('medium', 'done', 'NHL lineup input: DailyFaceoff line chart absences weighted by slot or cap hit, two dials, replaces the word counter for NHL',
   'Shipped 2026-10-04 with the goalie input. edge_factors.injuryReport carries the per player rows (player, position, status, slot, cap_hit, weight, cost) for NHL like it does for NFL, so the dial board shows what each absence cost. Confirmed lines as a factor on their own (line quality ratings) stay a later build.');
