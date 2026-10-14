-- League tables for the six European soccer competitions (owner
-- 2026-10-13: "league tables with records").
--
-- 1. current_standings: the record column reads wins, draws, losses for
--    EPL and MLS only. The six new display sports join that list so a
--    La Liga tile reads 5-1-0 (W-D-L) like EPL. Edits the live view in
--    place (the soccer list literal only) so nothing else can drift.
-- 2. sync-standings: the cron query param gains the six short codes
--    (mapped to display sports in api/cron/sync-standings.js). The secret
--    stays in cron.job.

do $mig$
declare
  old_list text := $l$ARRAY['EPL'::character varying, 'MLS'::character varying]$l$;
  new_list text := $l$ARRAY['EPL'::character varying, 'MLS'::character varying, 'Champions League'::character varying, 'Europa League'::character varying, 'La Liga'::character varying, 'Serie A'::character varying, 'Bundesliga'::character varying, 'Ligue 1'::character varying]$l$;
  def text;
begin
  def := pg_get_viewdef('public.current_standings'::regclass, true);
  if position('Ligue 1' in def) = 0 then
    if position(old_list in def) = 0 then
      raise exception 'current_standings soccer list not found';
    end if;
    execute 'create or replace view public.current_standings as ' || replace(def, old_list, new_list);
  end if;
end
$mig$;

do $mig$
declare
  jid bigint;
  cmd text;
begin
  select jobid, command into jid, cmd from cron.job where jobname = 'sync-standings';
  if jid is not null and position('LIGUE1' in cmd) = 0 then
    perform cron.alter_job(jid, command := replace(cmd, 'MLS,EPL', 'MLS,EPL,UCL,UEL,LALIGA,SERIEA,BUNDESLIGA,LIGUE1'));
  end if;
end
$mig$;
