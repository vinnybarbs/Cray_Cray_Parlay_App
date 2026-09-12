-- venue_center dial (2026-09-12): venue splits are centered on the
-- league's own home and road bump before they argue.
--
-- Raw, the venue split compares a team's home record to its overall
-- record. Every MLB club is about 2.8pp better at home than overall and
-- 2.8pp worse on the road, so "strong at home" plus "weak on road" fired
-- on nearly every matchup and re-added home field against a base that
-- already prices it. The 30 day replay under the current formula picked
-- 257 of 364 home (home -1.1u, away +18.6u). With venue_center 1 only
-- the excess over the league norm argues. 0 restores the raw split.

insert into sport_dials (sport, dial, value)
values ('__all__', 'venue_center', 1)
on conflict (sport, dial) do update set value = excluded.value;

insert into model_weight_changes (sport, component, before, after, reason, source)
values ('__all__', 'venue_center (new dial)',
  '{"venue_center": "absent, splits read raw against the team overall record"}',
  '{"venue_center": 1, "effect": "league mean home and road bump removed before the split argues"}',
  'Second home field double count found the same day as home advantage on the anchor. current_standings MLB 2026-09-12: mean home bump +2.82pp, mean road bump -2.85pp over 30 clubs, so an average matchup argued about +1.8pp home through the venue split alone. Replay emergency_sweep_mlb_30d_0912 base: 257 home picks 137-120 -1.1u, 107 away picks 66-41 +18.6u; venue_weight 0.15 and 0.5 variants did not fix the lean (240 and 262 home). Directive 19.',
  'claude-code');

-- The band map regime changes with the formula (CLAUDE.md): the weekly
-- refit now fits from today forward. The Monday cron passes the floor
-- explicitly so the function default no longer decides it.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'edge-band-calibration-raw-weekly'),
  command := $$ select public.refresh_edge_band_calibration_raw(p_fit_floor := '2026-09-12'::date); $$
);
