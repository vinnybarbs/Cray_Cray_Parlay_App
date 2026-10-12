-- v2 NFL props price rushing and receiving yards on a lognormal
-- (owner 2026-10-12: rushing yards is a sweet spot, tune it). Shadow only.
insert into public.sport_dials (sport, dial, value)
values ('NFL_props', 'prop_skew_shape', 1)
on conflict (sport, dial) do update set value = excluded.value, updated_at = now();

insert into public.model_weight_changes (sport, component, before, after, reason, source)
values ('NFL_props', 'prop_skew_shape', '0'::jsonb, '1'::jsonb,
  $r$v2 rushing and receiving yards move from a normal on the mean to a moment matched lognormal. Through week 4 rushing v2 at 4pp+ went 57-70 with overs 38-52 while 40.5 percent of graded rushing lines went over: the mean sits above the median the book prices. Replay on the same graded reads at 4pp+: rushing 57-70 -19.2u to 109-90 +5.0u, receiving yards 154-129 +6.8u to 210-172 +12.4u. In sample on four weeks, shadow only, judged as a new regime from 2026-10-12. Passing yards, counts and v1 unchanged.$r$,
  'owner-approved-shadow');
