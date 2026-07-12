-- One soccer pre-analyze covering EPL + MLS + marquee tournaments (World
-- Cup, Champions League, Copa America, Euros) via the soccer_% prefix group.
-- Replaces the separate epl/mls jobs — the 2026 World Cup ran a month with
-- zero coverage because those two were the only soccer keys anywhere.
-- (Applied to prod 2026-07-12 evening; secret embedded per existing pattern.)
select cron.unschedule('pre-analyze-epl');
select cron.unschedule('pre-analyze-MLS');
-- cron.schedule('pre-analyze-soccer', '5 */2 * * *', <http_post to /cron/pre-analyze-games?sports=soccer>);
