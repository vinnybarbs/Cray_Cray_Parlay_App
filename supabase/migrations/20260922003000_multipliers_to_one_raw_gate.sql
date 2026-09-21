-- Owner 2026-09-21 ("go"): no multiplier haircut, the raw claim is the
-- label, the gate reads the raw claim alone.
--
-- "I don't love that we find pp edge and just multiply it down out of
-- fear across the board." Directive 25 amended:
--   1. Every edge_calibration multiplier goes to 1. The column stays as
--      a dial the sweep can propose moving, with evidence, if a whole
--      sport ever proves it should.
--   2. The two mutes that rode on a 0 multiplier (MLB totals, NFL
--      totals) move to publish_total 0 on the dial board, which the
--      write path already enforces (marketPublishOpen). Nothing muted
--      wakes up.
--   3. promote_ready_markets flips publish_<market> to 1 on go-live and
--      leaves the multiplier at 1; it looks for markets whose publish
--      dial is 0, not for a 0 multiplier.
--   4. The publish gate binds on the raw claim only (code, this PR).
--   5. build_queue 44 (NFL multiplier counterfactual) is superseded: NFL
--      publishes at its raw claim and the bucket scorecard judges it.

-- 1. Multipliers to 1.
insert into public.model_weight_changes (sport, component, before, after, reason, source)
select '__all__', 'every edge_calibration multiplier to 1 (dials, no haircut)',
       jsonb_object_agg(key, multiplier),
       jsonb_object_agg(key, 1),
       'Owner 2026-09-21: "I don''t love that we find pp edge and just multiply it down out of fear across the board." The multiplier shrank every claim in a sport because the sport once overclaimed, without saying which factor was wrong; NFL at 0.25 needed an 8pp raw read to publish and shipped three weeks of legs. The raw claim is the label, the rails deduct for price, the bucket scorecard catches a bucket that lies. Directive 25 amended.',
       'owner-approved-2026-09-21'
  from public.edge_calibration;

update public.edge_calibration
   set multiplier = 1.0,
       source = 'owner-approved-2026-09-21 no haircut: multipliers are dials at 1, moved only by the sweep with evidence. Prior value in model_weight_changes.',
       updated_at = now();

-- 2. Mutes onto the publish dials.
insert into public.sport_dials (sport, dial, value) values ('MLB', 'publish_total', 0), ('NFL', 'publish_total', 0)
on conflict (sport, dial) do update set value = 0, updated_at = now();

insert into public.model_weight_changes (sport, component, before, after, reason, source) values
  ('MLB', 'MLB totals mute moves from multiplier 0 to publish_total 0',
   jsonb_build_object('MLB:total multiplier', 0, 'publish_total', 1),
   jsonb_build_object('MLB:total multiplier', 1, 'publish_total', 0),
   'Directive 25 amended 2026-09-21: a mute is a publish dial, never a zero multiplier. The directive 10 mute stands (closing line 3.7pp against on 128 published totals); re-entry through promote_ready_markets on the shadow ledger.',
   'owner-approved-2026-09-21'),
  ('NFL', 'NFL totals mute moves from multiplier 0 to publish_total 0',
   jsonb_build_object('NFL:total multiplier', 0, 'publish_total', 1),
   jsonb_build_object('NFL:total multiplier', 1, 'publish_total', 0),
   'Directive 25 amended 2026-09-21: a mute is a publish dial, never a zero multiplier. The go-live mute stands (preseason totals 6-10); re-entry through promote_ready_markets on the shadow ledger.',
   'owner-approved-2026-09-21');

-- 3. Promotion flips the publish dial and leaves the multiplier at 1.
create or replace function public.promote_ready_markets()
returns jsonb
language plpgsql
as $$
declare
  r record;
  m text;
  k text;
  promoted jsonb := '[]'::jsonb;
begin
  for r in
    select rr.* from public.shadow_market_readiness() rr
     where rr.ready
  loop
    m := case r.market when 'h2h' then 'ml' when 'spreads' then 'spread' else 'total' end;
    k := r.sport || ':' || m;
    -- Only a market that is currently off (its own row at 0) is a candidate.
    if not exists (select 1 from sport_dials d where d.sport = r.sport and d.dial = 'publish_' || m and d.value = 0) then
      continue;
    end if;

    update sport_dials set value = 1, updated_at = now() where sport = r.sport and dial = 'publish_' || m;

    insert into edge_calibration (key, multiplier, sample_n, measured_k, source, updated_at)
      values (k, 1, r.publishable, null,
        format('go-live %s via promote_ready_markets: shadow ledger %s-%s on %s publishable, %s actual vs %s implied, %su, CLV %spp (%s pct beat close). Multiplier 1 (directive 25).',
          current_date, r.wins, r.losses, r.publishable, r.actual_pct, r.implied_pct, r.units, r.avg_clv_pp, r.pct_beat_close),
        now())
      on conflict (key) do update set multiplier = 1, sample_n = excluded.sample_n, source = excluded.source, updated_at = now();

    insert into model_weight_changes (sport, component, before, after, reason, source)
      values (r.sport, k || ' go-live',
        jsonb_build_object('publish', 0),
        jsonb_build_object('publish', 1, 'multiplier', 1),
        format('Automatic promotion (directive 20 rule, owner 2026-09-13): %s-%s on %s publishable shadow reads, %s actual vs %s implied, %su, closing line value %spp, %s pct beat close.',
          r.wins, r.losses, r.publishable, r.actual_pct, r.implied_pct, r.units, r.avg_clv_pp, r.pct_beat_close),
        'promote_ready_markets');

    insert into agent_reports (agent, summary, findings)
      values ('promote-ready-markets',
        format('%s went LIVE automatically (publish_%s 1, multiplier 1): shadow ledger %s-%s on %s publishable reads, %s actual vs %s implied, %su, CLV %spp (%s pct beat close). Directive 20 rule. The owner reverses by setting sport_dials publish_%s to 0 for %s.',
          k, m, r.wins, r.losses, r.publishable, r.actual_pct, r.implied_pct, r.units, r.avg_clv_pp, r.pct_beat_close, m, r.sport),
        jsonb_build_object('key', k, 'publishable', r.publishable, 'units', r.units, 'avg_clv_pp', r.avg_clv_pp, 'pct_beat_close', r.pct_beat_close));

    promoted := promoted || jsonb_build_object('key', k, 'publishable', r.publishable);
  end loop;
  return jsonb_build_object('promoted', promoted, 'at', now());
end;
$$;

-- 4. Directives.
update public.directives
   set directive = directive || ' Amended 2026-09-21 (owner "go", no haircut): every multiplier sits at 1. The tier is the raw claim minus the price rails. The publish gate binds on the raw claim alone; the multiplier is a dial that sizes the label and can neither open nor close the gate. A market mute is publish_<market> 0 on the dial board, never a zero multiplier, and promote_ready_markets lifts a mute by flipping that dial with the multiplier at 1. A multiplier leaves 1 only through the sweep or an owner call, with a model_weight_changes row.',
       check_sql = check_sql || $chk$
union all select 'multiplier off 1 without a sweep or owner row', key from edge_calibration where multiplier <> 1 and coalesce(source, '') not like 'sunday-sweep-approved%' and coalesce(source, '') not like 'owner-approved%'
union all select 'mute riding on a zero multiplier', key from edge_calibration where multiplier = 0$chk$,
       updated_at = now()
 where id = 25;

update public.directives
   set directive = directive || ' Clarified 2026-09-21 (directive 25 amended): the raw claim is the ONLY gate. The scaled claim never closes it either; a scaled claim under 2pp publishes at the Lean floor.',
       updated_at = now()
 where id = 17;

-- 5. Queue.
update public.build_queue
   set status = 'dismissed',
       detail = detail || ' DISMISSED 2026-09-21: superseded by directive 25 as amended. Every multiplier is 1, NFL publishes at its raw claim from the next slate, and the bucket scorecard judges NFL at 50 rows instead of a multiplier replay.'
 where id = 44;

insert into public.build_queue (priority, status, title, detail) values
  ('high', 'done', 'No haircut: every multiplier to 1, raw only publish gate, mutes on the publish dials (owner 2026-09-21)',
   'Directive 25 amended, directive 17 clarified. edge_calibration all keys 1 (prior values in model_weight_changes), MLB and NFL publish_total 0 carry the two mutes, promote_ready_markets flips the publish dial with the multiplier at 1, pre-analyze and the replay gate on the raw claim only with the Lean floor for a scaled claim under 2pp. Sunday 09-20 under this rule would have published seven NFL reads (one Play, six Leans) at 5-2. Tennis publishes at its raw claim too and its Lean bucket is already under its floor, so it is the first place the scorecard will speak.');
