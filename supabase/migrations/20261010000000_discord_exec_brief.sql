-- 2026-10-09 (owner): the exec assistant's daily message goes to the
-- Discord channel too. The server reads the newest agent_reports row
-- from agent exec-assistant and posts it once (the log row carries the
-- report id, later slots skip). Three slots cover the 08:57 Denver
-- firing in both daylight and standard time plus a half hour run.
do $$
declare
  v_secret text;
begin
  select substring(command from 'secret=([^&'']+)') into v_secret
    from cron.job where jobname = 'discord-morning-board' limit 1;
  if v_secret is null then
    raise exception 'discord-morning-board job not found, cannot read the cron secret';
  end if;

  if exists (select 1 from cron.job where jobname = 'discord-exec-brief') then
    perform cron.unschedule('discord-exec-brief');
  end if;

  perform cron.schedule('discord-exec-brief', '45 15,16,17 * * *', format($j$
    SELECT net.http_post(
      url := 'https://craycrayparlayapp-production.up.railway.app/cron/discord-exec-brief?secret=%s',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 120000);
  $j$, v_secret));
end $$;
