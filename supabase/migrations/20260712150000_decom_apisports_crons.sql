-- API-Sports is PERMANENTLY removed from the stack (2026-07-12, Vince's
-- call: never using them again). All code call sites are deleted in the
-- same change. These three jobs called API-Sports and die with it:
--   apisports-daily-sync     -> /api/sync-apisports          (endpoint deleted)
--   apisports-weekly-stats   -> /api/sync-apisports?type=weekly (endpoint deleted)
--   daily-sports-stats-sync  -> edge fn sync-sports-stats    (pure API-Sports client)
select cron.unschedule('apisports-daily-sync');
select cron.unschedule('apisports-weekly-stats');
select cron.unschedule('daily-sports-stats-sync');
