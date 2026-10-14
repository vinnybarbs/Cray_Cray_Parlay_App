-- European soccer leagues as shadow sports (owner 2026-10-13: "wire up
-- all major soccer leagues", "display it all but with shadow in small
-- print"). Champions League, Europa League, La Liga, Serie A, Bundesliga
-- and Ligue 1 join EPL and MLS in the three way soccer family.
--
-- 1. shadow_reads_graded: the three_way flag grades a soccer moneyline
--    draw as a loss. A league missing from that list would grade a draw
--    as a push, so the six names join it.
-- 2. shadow_model_readiness: the soccer read count covers the six.
-- 3. backfill-game-results-6h: finals for the six land in game_results
--    under their display sport (short codes in the query param, mapped in
--    api/cron/backfill-game-results.js). The secret stays in cron.job.
--
-- Both object rewrites edit the live definition in place (the soccer list
-- literal only) so nothing else in either body can drift from production.

do $mig$
declare
  old_list text := $l$'Champions League'::character varying, 'Copa America'::character varying$l$;
  new_list text := $l$'Champions League'::character varying, 'Europa League'::character varying, 'La Liga'::character varying, 'Serie A'::character varying, 'Bundesliga'::character varying, 'Ligue 1'::character varying, 'Copa America'::character varying$l$;
  def text;
begin
  def := pg_get_viewdef('public.shadow_reads_graded'::regclass, true);
  if position('Ligue 1' in def) = 0 then
    if position(old_list in def) = 0 then
      raise exception 'shadow_reads_graded soccer list not found';
    end if;
    execute 'create or replace view public.shadow_reads_graded as ' || replace(def, old_list, new_list);
  end if;
end
$mig$;

do $mig$
declare
  old_list text := $l$'Champions League','Copa America'$l$;
  new_list text := $l$'Champions League','Europa League','La Liga','Serie A','Bundesliga','Ligue 1','Copa America'$l$;
  def text;
begin
  def := pg_get_functiondef('public.shadow_model_readiness'::regproc);
  if position('Ligue 1' in def) = 0 then
    if position(old_list in def) = 0 then
      raise exception 'shadow_model_readiness soccer list not found';
    end if;
    execute replace(def, old_list, new_list);
  end if;
end
$mig$;

do $mig$
declare
  jid bigint;
  cmd text;
begin
  select jobid, command into jid, cmd from cron.job where jobname = 'backfill-game-results-6h';
  if jid is not null and position('LIGUE1' in cmd) = 0 then
    perform cron.alter_job(jid, command := replace(cmd, 'EPL,MLS', 'EPL,MLS,UCL,UEL,LALIGA,SERIEA,BUNDESLIGA,LIGUE1'));
  end if;
end
$mig$;

-- 4. The dial board is the publish authority (SHADOW_SPORTS in code is
--    only the fail soft mirror): the five new display sports start muted
--    on all three markets, like every soccer sport. Champions League
--    already has its rows.
insert into public.sport_dials (sport, dial, value, updated_at)
select s, d, '0', now()
from unnest(array['Europa League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1']) s
cross join unnest(array['publish_ml', 'publish_spread', 'publish_total']) d
on conflict do nothing;
