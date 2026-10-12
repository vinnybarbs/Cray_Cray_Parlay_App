-- The weekly dial search (owner 2026-10-11): every live team sport, last
-- week searched for the dial moves that would have made it more
-- profitable, the winners replayed on the 60 days before that week, and
-- the ones that pass the three tests filed to build_queue.
-- Mondays 06:30 UTC (00:30 MDT), after the MLB Sunday sweep at 05:00 and
-- before the bucket scorecard at 06:50. The secret is read from an
-- existing job, never written here.

do $$
declare
  v_secret text;
begin
  select substring(command from 'secret=([^&'']+)') into v_secret
    from cron.job where jobname = 'weekly-replay-sweep' limit 1;
  if v_secret is null then
    raise exception 'weekly-replay-sweep job not found, cannot read the cron secret';
  end if;

  perform cron.schedule('weekly-dial-search', '30 6 * * 1', format($j$
    SELECT net.http_post(
      url := 'https://craycrayparlayapp-production.up.railway.app/cron/dial-search?secret=%s&sports=NFL,NHL,NCAAF,MLB&recent_days=7&confirm_days=60',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 300000);
  $j$, v_secret));
end $$;
