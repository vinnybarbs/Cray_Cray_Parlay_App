-- Ops check 2026-10-03 (agent_reports 202), owner: "NOT ALL CLEAR". The
-- code half of the findings ships with this migration (depth gate
-- pagination, Discord chunking, news out of the change gate, odds refresh
-- partial status, zero cost scratches). This file carries the database
-- half: the closing line fence and quarantine, the directive amendments
-- (14, 17, 20, 21, 22, 27) and the queue.

-- Finding six: the closing line capture copied quotes the dead odds feed
-- had not refreshed for up to four days (quota outage 2026-09-26 17:20 to
-- 09-30 18:20 MT). The rows are moved to a quarantine table, never
-- deleted, so every CLV view (closing_consensus, pick_clv, v_pick_clv,
-- pick_clv_all) excludes them without a rewrite, and the capture now
-- writes nothing from a quote older than its own 90 minute window.
create table if not exists public.closing_lines_suspect (
  like public.closing_lines including all,
  quarantined_at timestamptz not null default now(),
  reason text not null
);
alter table public.closing_lines_suspect enable row level security;

with moved as (
  delete from public.closing_lines
   where captured_at >= '2026-09-26 18:05:00-06' and captured_at <= '2026-09-30 18:20:00-06'
  returning *
), kept as (
  insert into public.closing_lines_suspect
    select m.*, now(), 'captured during the Odds API quota outage (refresh-odds-hourly rows 0 from 2026-09-26 17:40 to 09-30 18:20 MT): the source quote was 45 minutes to 97 hours stale at capture'
    from moved m
  returning 1
)
insert into public.cron_job_logs (job_name, status, details)
select 'manual-quarantine-closing-lines', 'completed',
       jsonb_build_object('rows', count(*), 'window', '2026-09-26 18:05 to 2026-09-30 18:20 MT',
                          'reason', 'ops finding six, stale quotes captured as closes during the quota outage, moved to closing_lines_suspect')::text
  from kept;

create or replace function public.capture_closing_lines()
 returns void
 language plpgsql
 security definer
as $function$
DECLARE
  v_games int := 0;
  v_rows int := 0;
  v_stale int := 0;
  v_sports text;
BEGIN
  SELECT count(DISTINCT external_game_id), string_agg(DISTINCT sport, ',')
    INTO v_games, v_sports
  FROM public.odds_cache
  WHERE commence_time > now()
    AND commence_time <= now() + interval '90 minutes'
    AND market_type IN ('h2h', 'spreads', 'totals');

  -- The fence: a quote the refresher has not touched inside the capture
  -- window is not a closing line, whatever the cache still holds.
  SELECT count(*) INTO v_stale
  FROM public.odds_cache
  WHERE commence_time > now()
    AND commence_time <= now() + interval '90 minutes'
    AND market_type IN ('h2h', 'spreads', 'totals')
    AND (last_updated IS NULL OR last_updated < now() - interval '90 minutes');

  INSERT INTO public.closing_lines
    (sport, external_game_id, commence_time, home_team, away_team,
     bookmaker, market_type, outcomes, captured_at)
  SELECT sport, external_game_id, commence_time, home_team, away_team,
         bookmaker, market_type, outcomes, now()
  FROM public.odds_cache
  WHERE commence_time > now()
    AND commence_time <= now() + interval '90 minutes'
    AND market_type IN ('h2h', 'spreads', 'totals')
    AND last_updated >= now() - interval '90 minutes'
  ON CONFLICT (external_game_id, market_type, bookmaker) DO UPDATE SET
    outcomes      = EXCLUDED.outcomes,
    commence_time = EXCLUDED.commence_time,
    captured_at   = EXCLUDED.captured_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.cron_job_logs (job_name, status, details)
  VALUES ('capture_closing_lines',
          CASE WHEN v_games > 0 AND v_rows = 0 THEN 'partial' ELSE 'completed' END,
          jsonb_build_object('games_in_window', v_games, 'rows_written', v_rows, 'stale_quotes_skipped', v_stale,
                             'sports', coalesce(v_sports, ''), 'window_minutes', 90)::text);
END;
$function$;

-- Finding four: directive 14 covers the odds refresh. refresh-odds-hourly
-- now reports partial on any failed core request or an empty board, and
-- the check reads it.
update public.directives set
  enforcement = enforcement || ' refresh-odds-hourly (edge function) logs partial on any non 2xx core request or a run with no games, with failed_sports in details, since 2026-10-03.',
  check_sql = check_sql || $chk$ union all select 'odds refresh starved 2h' where not exists (select 1 from cron_job_logs where job_name = 'refresh-odds-hourly' and status = 'completed' and created_at > now() - interval '2 hours' and coalesce((details::jsonb->>'rows')::int, 0) > 0) union all select 'odds refresh partial 6h' where exists (select 1 from cron_job_logs where job_name = 'refresh-odds-hourly' and status = 'partial' and created_at > now() - interval '6 hours') union all select 'closing capture skipped stale quotes 24h' where exists (select 1 from cron_job_logs where job_name = 'capture_closing_lines' and created_at > now() - interval '24 hours' and coalesce((details::jsonb->>'stale_quotes_skipped')::int, 0) > 0)$chk$,
  notes = coalesce(notes, '') || ' Amended 2026-10-03: refresh-odds starvation and partial clauses, closing capture stale quote clause (ops findings four and six).'
 where id = 14;

-- Finding ten of 10-02: the alt spread and alt total rows are graded
-- domains and the raw claim gate check reads them too.
update public.directives set
  check_sql = replace(check_sql, $old$session_id ~ '^auto_digest_\d{4}-\d{2}-\d{2}$'$old$, $new$session_id ~ '^auto_digest_(alt_(spread|total)_)?\d{4}-\d{2}-\d{2}$'$new$),
  notes = coalesce(notes, '') || ' Amended 2026-10-03: the check covers auto_digest_alt_spread and auto_digest_alt_total rows.'
 where id = 17;

-- Finding eleven: a market is shadow when its publish dial is 0, not when
-- the sport sits in a literal list. NCAAF totals went live 09-27 and the
-- check kept returning them.
update public.directives set
  check_sql = $chk$select r.sport, r.market, r.publishable, r.actual_pct, r.implied_pct, r.units, r.avg_clv_pp, r.pct_beat_close, r.ready from public.shadow_market_readiness() r where coalesce((select d.value from sport_dials d where d.sport = r.sport and d.dial = 'publish_' || case r.market when 'h2h' then 'ml' when 'spreads' then 'spread' else 'total' end), (select d.value from sport_dials d where d.sport = '__all__' and d.dial = 'publish_' || case r.market when 'h2h' then 'ml' when 'spreads' then 'spread' else 'total' end), 1) = 0 and (r.ready or (r.publishable >= 50 and r.avg_clv_pp <= -1))$chk$,
  notes = coalesce(notes, '') || ' Amended 2026-10-03: shadow is read from the sport_dials publish flags (sport row, then __all__), never a literal sport list.'
 where id = 20;

-- Finding ten: the dial freeze ended 2026-09-27. The three preseason
-- mutes carried a sweep source string the list never named.
update public.directives set
  status = 'expired',
  notes = coalesce(notes, '') || ' Closed 2026-10-03: the freeze window ended 2026-09-27. model_weight_changes 34 to 36 (NHL, NBA, NCAAB preseason mutes, source pipeline-sweep-2026-09-27) were owner approved in the 09-27 sweep. The standing rule is directive 7 and 8 plus the evidence row.'
 where id = 21;

-- Finding twelve: a mute lives on the publish dial since 2026-09-21, so
-- a multiplier at 1 next to a weight change that records multiplier 0 is
-- the correct state whenever that market's publish dial is 0.
create or replace function public.doc_drift_findings()
 returns table(drift text, subject text, detail text)
 language plpgsql
 stable
as $function$
declare
  d record;
  v_sport text;
  v_market text;
  v_publish numeric;
begin
  for d in
    select distinct s.dial from sport_dials s
     where not exists (select 1 from skills k where k.content ilike '%' || s.dial || '%')
     order by s.dial
  loop
    drift := 'dial_undocumented'; subject := d.dial;
    detail := format('sport_dials carries %s and no skill in the skills table names it; add it to the performance review dial list', d.dial);
    return next;
  end loop;

  for d in
    select dv.id, dv.enforcement, m[1] as fn
      from directives dv, regexp_matches(dv.enforcement, 'public\.([a-z_]+)\(', 'g') as m
     where dv.status = 'active'
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = d.fn) then
      drift := 'dead_enforcement'; subject := 'directive ' || d.id;
      detail := format('enforcement names public.%s() which does not exist', d.fn);
      return next;
    end if;
  end loop;

  for d in select dv.id, dv.check_sql from directives dv where dv.status = 'active' and dv.check_sql is not null loop
    begin
      execute 'select 1 from (' || d.check_sql || ') q limit 0';
    exception when others then
      drift := 'broken_check_sql'; subject := 'directive ' || d.id;
      detail := left(sqlerrm, 200);
      return next;
    end;
  end loop;

  for d in
    select e.key, e.multiplier, e.source, e.updated_at,
           (select m.after from model_weight_changes m where m.component ilike e.key || ' %' or m.component = e.key order by m.changed_at desc limit 1) as latest_after
      from edge_calibration e
     where e.multiplier <> 0
  loop
    if d.latest_after is not null and coalesce((d.latest_after->>'multiplier')::numeric, 1) = 0 then
      -- Since 2026-09-21 a mute is publish_<market> 0 on sport_dials and
      -- every multiplier is 1. A key whose publish dial is 0 is muted
      -- correctly and is not drift.
      v_sport := split_part(d.key, ':', 1);
      v_market := split_part(d.key, ':', 2);
      select coalesce(
        (select s.value from sport_dials s where s.sport = v_sport and s.dial = 'publish_' || v_market),
        (select s.value from sport_dials s where s.sport = '__all__' and s.dial = 'publish_' || v_market), 1)
        into v_publish;
      if v_publish = 0 then
        continue;
      end if;
      drift := 'mute_lifted'; subject := d.key;
      detail := format('latest weight change for %s records multiplier 0 but edge_calibration reads %s (source %s, %s); restore the mute and find what lifted it', d.key, d.multiplier, left(d.source, 40), d.updated_at);
      return next;
    end if;
  end loop;
  return;
end;
$function$;

-- Findings eight and nine: directive 27 is enforced where a cloud routine
-- can see it (a repo test on every run plus this SQL), and the check no
-- longer flags a row whose affiliate language is itself the prohibition.
update public.directives set
  enforcement = '__tests__/no-sportsbook-affiliation.test.js fails the suite on any sportsbook domain link or affiliate parameter in the site, API or server source (every test run, every deploy). This check_sql covers the queue and the directives. Code review on every PR touching Landing, Digest, Ledger, Discord posters or email.',
  check_sql = $chk$select 'affiliate language in build_queue', id::text from build_queue where status not in ('done','dismissed') and (title ilike '%affiliate%' or detail ilike '%sportsbook affiliate%') and not ((title || ' ' || coalesce(detail, '')) ~* 'no sportsbook affiliat')$chk$,
  notes = coalesce(notes, '') || ' Amended 2026-10-03: enforcement moved to a repo test a routine can trust, and the check exempts prohibition language (build_queue 71 false positive).'
 where id = 27;

-- The queue.
insert into public.build_queue (priority, status, title, detail) values
  ('high', 'done', 'Ops 2026-10-03 batch: NFL depth gate loader pages past the PostgREST 1000 row cap, news out of the change gate hash, Discord embeds chunked by characters with a failed status, refresh-odds partial on failures, zero cost scratches never re-price a pick, closing capture fenced and the outage cohort quarantined, directives 14, 17, 20, 21, 22, 27 amended',
   'Finding one: the depth view holds about 2700 rows and one read returned 1000, so ARI through GB resolved and every club from HOU on fell to the 0.5 unknown weight (87 of 133 entries). The loader pages now. Finding two: news alone no longer forces a narration (still fingerprinted). Finding three: the 70 row board exceeded the Discord 6000 character per message cap, so the poster chunks by characters, logs the status and body, and reports failed not skipped. Finding four: refresh-odds logs partial on any failed core request or an empty board and directive 14 reads it. Finding six: 654 closing_lines rows captured 09-26 18:05 to 09-30 18:20 MT moved to closing_lines_suspect, capture skips quotes older than 90 minutes. Finding seven: a scratch the depth chart prices at zero is logged as ignored_zero_cost and never marks the read stale. Findings eight to twelve: directive amendments. Finding thirteen: existing_fresh is the hold witness on a fire where every game sits inside expires_at, skipped_unchanged counts only games past expiry whose inputs matched (skill line).'),
  ('medium', 'open', 'MLB postseason reads carry no Probable starters factor: every published October run line favorite logged starter_required hold',
   'rule_gate_log 2026-10-02 and 10-03: 12 of 12 MLB picks held on starter_required and rl_favorite_rule because edge_factors.adjustments has no Probable starters row. getProbablePitcherStats reads the ESPN scoreboard probables; in the postseason the ERA is missing or the probable is unannounced, so starterEraAdjustment returns 0 and nothing is pushed. The owner rule says starter required, so these holds are real and the shadow scorecard will show it. Fix path: read postseason probables from the MLB StatsAPI schedule (probablePitcher with season stats) and fall back to the regular season ERA when ESPN lacks it, then log a factor row at impact 0 when the names are known and the ERA is not, so the gate can tell unknown from absent.');
