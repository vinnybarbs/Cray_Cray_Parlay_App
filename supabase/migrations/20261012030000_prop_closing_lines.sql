-- Prop closing lines and prop CLV (build_queue 94, owner 2026-10-12).
--
-- The props promotion bar (build_queue 65) needs positive closing line
-- value, and the only prop CLV was prop_read_clv, whose close is the
-- last twice daily player_props sync (13:15 or 21:15 UTC). That is hours
-- before kickoff and often the very snapshot the read was priced from
-- (analyze runs 15 minutes after the sync), so it measured almost
-- nothing. sync-nfl-props?mode=close now fetches NFL events starting
-- inside the next 25 minutes and writes the closing consensus onto the
-- matching prop_reads rows, with CLV for the v1 side and the v2 side.
-- At the same line CLV is devigged pp (positive beat the close). When
-- the line moved, clv_pp is null and beat_close follows the move.

ALTER TABLE public.prop_reads
  ADD COLUMN IF NOT EXISTS close_line numeric,
  ADD COLUMN IF NOT EXISTS close_over_prob numeric,
  ADD COLUMN IF NOT EXISTS close_over_price integer,
  ADD COLUMN IF NOT EXISTS close_under_price integer,
  ADD COLUMN IF NOT EXISTS close_books integer,
  ADD COLUMN IF NOT EXISTS close_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS clv_pp numeric,
  ADD COLUMN IF NOT EXISTS beat_close boolean,
  ADD COLUMN IF NOT EXISTS v2_clv_pp numeric,
  ADD COLUMN IF NOT EXISTS v2_beat_close boolean;

-- The scorecard the props flip is judged on: v2 reads at 2pp or more by
-- market and claim band, with record, units at the consensus price for
-- the v2 side, and CLV where a close was captured.
CREATE OR REPLACE VIEW public.prop_clv_scorecard AS
WITH r AS (
  SELECT market, v2_edge_pp, v2_outcome, v2_clv_pp, v2_beat_close, close_captured_at,
    CASE WHEN lower(v2_side) = 'over' THEN consensus_over_price ELSE consensus_under_price END AS price,
    CASE WHEN v2_edge_pp >= 7 THEN '7+' WHEN v2_edge_pp >= 4 THEN '4-7' ELSE '2-4' END AS band
  FROM public.prop_reads
  WHERE v2_edge_pp >= 2 AND v2_side IS NOT NULL
)
SELECT market, band,
  count(*) FILTER (WHERE v2_outcome IN ('won','lost')) AS graded,
  count(*) FILTER (WHERE v2_outcome = 'won') AS won,
  round(sum(CASE
    WHEN v2_outcome = 'won' AND price > 0 THEN price / 100.0
    WHEN v2_outcome = 'won' AND price < 0 THEN 100.0 / abs(price)
    WHEN v2_outcome = 'lost' THEN -1 ELSE 0 END), 2) AS units,
  count(*) FILTER (WHERE close_captured_at IS NOT NULL) AS closed,
  round(avg(v2_clv_pp), 2) AS avg_clv_pp,
  round(100.0 * avg(v2_beat_close::int) FILTER (WHERE v2_beat_close IS NOT NULL), 1) AS beat_close_pct
FROM r
GROUP BY GROUPING SETS ((market, band), (band), ());

GRANT SELECT ON public.prop_clv_scorecard TO authenticated, service_role;

-- NFL kickoffs fall between 13:30 and 01:30 UTC, so the capture fires
-- every 15 minutes in that span.
SELECT cron.schedule(
  'capture-prop-closes',
  '*/15 0-3,12-23 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/sync-nfl-props?secret=' ||
      (SELECT substring(command FROM 'secret=([^&]+)') FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1) || '&mode=close',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) as request_id;
  $cmd$
);

-- Directive 14: judged by rows written when reads sat in the window.
UPDATE public.directives SET check_sql = check_sql ||
  ' union all select ''prop close capture partial 24h'' where exists (select 1 from cron_job_logs where job_name = ''capture-prop-closes'' and status in (''partial'',''failed'') and created_at > now() - interval ''24 hours'')',
  updated_at = now()
WHERE id = 14 AND check_sql NOT LIKE '%prop close capture partial 24h%';
