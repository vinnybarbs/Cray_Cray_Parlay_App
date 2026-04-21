# Model Accuracy Rollup — Design

**Date:** 2026-04-21
**Status:** Approved, pending implementation plan
**Owner:** Vinny
**Related code:** [api/admin-dashboard.js](../../../api/admin-dashboard.js), [src/pages/ResultsPage.jsx](../../../src/pages/ResultsPage.jsx), [api/cron/pre-analyze-games.js](../../../api/cron/pre-analyze-games.js)

## Problem

The admin dashboard and user `ResultsPage` compute model win/loss/push percentages by selecting rows from `ai_suggestions` and aggregating in JavaScript. Three defects result:

1. **1000-row PostgREST cap truncates the result set silently.** The table has 1,929 rows; the dashboard sees a fixed 1,000-row snapshot (the same 1,000 rows every refresh), which is why per-sport numbers appear "stuck" and why Tennis / UFC / NHL silently drop off the bySport breakdown.
2. **No ROI math.** Win rate alone is misleading (55% on -110 spreads is break-even; 52% on +120 dogs is profitable). Every serious competitor (Unabated, Leans.ai, Dimers) leads with ROI, not win rate.
3. **No edge-score dimension.** The current "Confidence Calibration" chart conflates auto-calculated edge scores with conversational chat confidence, producing meaningless composite numbers.

The empty `public.model_accuracy` table in the schema was clearly designed to solve (1) and (2) but has zero rows; no cron was ever wired up to populate it.

## Goals

- Admin and user-facing model performance numbers reflect the full dataset, always.
- Headline ROI figure available per sport, bet_type, edge level, mode, and time window.
- Dedicated edge-score-vs-result breakdown, distinct from De-Genny chat confidence.
- Per-sport and per-bet-type breakdowns scoped to rolling windows (all-time, last 30d, last 7d).
- Dashboard read path stays a single round-trip, no N+1 queries, no JS-side aggregation.
- Follow the project's don't-cascade-fixes principle: land this without touching settlement bugs, without touching the pregame retrieval pipeline, and without modifying existing cron jobs (except to add two new ones).

## Non-goals

- Closing Line Value (CLV) tracking. Requires new `closing_line_odds` capture infrastructure; queued as a follow-up task.
- Retroactive backfill of the 1,278 auto_digest picks missing `odds`. Separate task after this ships.
- Per-user ROI / user bet log feature inspired by Dimers Dimebot.
- Parlay correlation detection.
- Fixing the EPL / Tennis / UFC settlement coverage gaps.
- Fixing the parlay_legs half-settlement bug (outcome set but game_completed false).
- Adding new inputs to the edge calculator (ATS records, rest days, weather, etc.).

## Design

### Architecture

Single materialized view `public.mv_model_accuracy` holds precomputed aggregates. A pg_cron job refreshes it concurrently after each `check-outcomes` run. Admin endpoint and ResultsPage read the MV directly, filtering by one indexed column.

```
       ai_suggestions  (source of truth)
              │
              │ GROUP BY (period × dimension)
              │ run after check-outcomes
              ▼
       mv_model_accuracy  (~140 rows, indexed)
              │
      ┌───────┴───────┐
      ▼               ▼
Admin Dashboard   ResultsPage
```

### MV schema

**Grain:** one row per `(period_bucket, dimension_type, dimension_value)`. Expected row count: ~140 (grows linearly with new sports / modes).

```sql
CREATE MATERIALIZED VIEW public.mv_model_accuracy AS
SELECT
  period_bucket       text,      -- 'all' | 'last_30d' | 'last_7d'
  dimension_type      text,      -- 'overall' | 'sport' | 'bet_type' |
                                 -- 'edge_integer' | 'edge_bucket' |
                                 -- 'generate_mode' | 'chat_confidence'
  dimension_value     text,      -- NBA | Spread | 7 | 'High (7-8)' |
                                 -- auto_digest | 'all'
  won                 integer,
  lost                integer,
  push                integer,
  pending             integer,
  total               integer,   -- won + lost + push + pending
  settled_with_odds   integer,   -- denominator for ROI
  avg_decimal_odds    numeric,   -- avg of parsed decimal odds (settled)
  roi_units           numeric,   -- SUM(won × (decimal_odds - 1)) - SUM(lost × 1)
  roi_pct             numeric,   -- roi_units / settled_with_odds * 100
  updated_at          timestamptz
FROM ... /* UNION ALL per dimension */;

CREATE UNIQUE INDEX idx_mv_model_accuracy_key
  ON public.mv_model_accuracy (period_bucket, dimension_type, dimension_value);
```

The unique index is required for `REFRESH MATERIALIZED VIEW CONCURRENTLY` (non-locking refresh).

### Dimensions

| dimension_type | dimension_value examples | Source filter |
|---|---|---|
| `overall` | `'all'` | all rows |
| `sport` | `NBA`, `MLB`, `EPL`, ... | all rows |
| `bet_type` | `Spread`, `Moneyline`, `Total`, `Player Props` | all rows |
| `edge_integer` | `1` through `10` | auto-modes only (see below) |
| `edge_bucket` | `Low (1-4)`, `Medium (5-6)`, `High (7-8)`, `Strong (9-10)` | auto-modes only |
| `generate_mode` | `auto_digest`, `Easy Money`, `AI Edge Advantages`, ... | all rows |
| `chat_confidence` | `1` through `10` | `generate_mode = 'degenny_chat'` only |

**Auto-modes filter for edge dimensions:** `generate_mode IN ('auto_digest', 'AI Edge Advantages', 'Top Picks of the Day', 'Easy Money', 'Heavy Favorites')`. These are the modes where `ai_suggestions.confidence` is a rounded edge score. Chat mode stores arbitrary confidence values that have different semantics.

> **Maintenance note:** This list lives in the MV definition SQL. When a new generation mode is added in code, decide whether its `confidence` field is edge-score-meaning (add to this list, then `REFRESH`) or conversational-meaning (leave out, or add to `chat_confidence`). Getting this wrong silently pollutes the calibration chart — verify by spot-checking a few rows' `confidence` values against the code that wrote them.

### Period buckets

| period_bucket | Filter on `game_date` |
|---|---|
| `all` | no filter |
| `last_30d` | `game_date >= NOW() - INTERVAL '30 days'` |
| `last_7d` | `game_date >= NOW() - INTERVAL '7 days'` |

### SQL shape (abbreviated)

```sql
CREATE MATERIALIZED VIEW public.mv_model_accuracy AS
WITH picks AS (
  SELECT
    id, sport, bet_type, confidence, generate_mode, actual_outcome, odds,
    created_at, game_date,
    CASE
      WHEN odds ~ '^[+-]?\d+$' THEN
        CASE WHEN odds::int > 0
          THEN 1 + odds::int / 100.0
          ELSE 1 + 100.0 / abs(odds::int)
        END
      ELSE NULL
    END AS decimal_odds
  FROM public.ai_suggestions
),
picks_periods AS (
  SELECT *, 'all'::text AS period_bucket FROM picks
  UNION ALL
  SELECT *, 'last_30d' FROM picks WHERE game_date >= NOW() - INTERVAL '30 days'
  UNION ALL
  SELECT *, 'last_7d' FROM picks WHERE game_date >= NOW() - INTERVAL '7 days'
),
aggs AS (
  -- Block 1: overall
  SELECT period_bucket, 'overall'::text AS dimension_type, 'all'::text AS dimension_value,
         <agg_columns>
  FROM picks_periods
  GROUP BY period_bucket

  UNION ALL
  -- Block 2: sport
  SELECT period_bucket, 'sport', sport, <agg_columns>
  FROM picks_periods
  WHERE sport IS NOT NULL
  GROUP BY period_bucket, sport

  UNION ALL
  -- Block 3: bet_type
  SELECT period_bucket, 'bet_type', bet_type, <agg_columns>
  FROM picks_periods
  WHERE bet_type IS NOT NULL
  GROUP BY period_bucket, bet_type

  UNION ALL
  -- Block 4: edge_integer (auto-modes only)
  SELECT period_bucket, 'edge_integer', confidence::text, <agg_columns>
  FROM picks_periods
  WHERE generate_mode IN ('auto_digest','AI Edge Advantages','Top Picks of the Day','Easy Money','Heavy Favorites')
    AND confidence BETWEEN 1 AND 10
  GROUP BY period_bucket, confidence

  UNION ALL
  -- Block 5: edge_bucket (auto-modes only)
  SELECT period_bucket, 'edge_bucket',
         CASE
           WHEN confidence BETWEEN 1 AND 4 THEN 'Low (1-4)'
           WHEN confidence BETWEEN 5 AND 6 THEN 'Medium (5-6)'
           WHEN confidence BETWEEN 7 AND 8 THEN 'High (7-8)'
           WHEN confidence BETWEEN 9 AND 10 THEN 'Strong (9-10)'
         END,
         <agg_columns>
  FROM picks_periods
  WHERE generate_mode IN ('auto_digest','AI Edge Advantages','Top Picks of the Day','Easy Money','Heavy Favorites')
    AND confidence BETWEEN 1 AND 10
  GROUP BY period_bucket, 1  -- alias for the CASE expression

  UNION ALL
  -- Block 6: generate_mode
  SELECT period_bucket, 'generate_mode', generate_mode, <agg_columns>
  FROM picks_periods
  WHERE generate_mode IS NOT NULL
  GROUP BY period_bucket, generate_mode

  UNION ALL
  -- Block 7: chat_confidence (degenny_chat only)
  SELECT period_bucket, 'chat_confidence', confidence::text, <agg_columns>
  FROM picks_periods
  WHERE generate_mode = 'degenny_chat'
    AND confidence BETWEEN 1 AND 10
  GROUP BY period_bucket, confidence
)
SELECT *,
       roi_units / NULLIF(settled_with_odds, 0) * 100 AS roi_pct,
       NOW() AS updated_at
FROM aggs;
```

`<agg_columns>` expands to:

```sql
COUNT(*) FILTER (WHERE actual_outcome = 'won')     AS won,
COUNT(*) FILTER (WHERE actual_outcome = 'lost')    AS lost,
COUNT(*) FILTER (WHERE actual_outcome = 'push')    AS push,
COUNT(*) FILTER (WHERE actual_outcome = 'pending') AS pending,
COUNT(*)                                           AS total,
COUNT(*) FILTER (
  WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL
)                                                  AS settled_with_odds,
AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')) AS avg_decimal_odds,
SUM(CASE
  WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
  WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
  ELSE 0
END) AS roi_units
```

ROI math: pushes contribute 0 units (stake returned). Pending and null-odds rows are excluded from `settled_with_odds` so they don't distort `roi_pct`. Rows where `settled_with_odds = 0` get `roi_pct = NULL` (UI renders `—`).

### Refresh strategy

Two new pg_cron jobs:

| Job name | Schedule (UTC) | Purpose |
|---|---|---|
| `refresh_mv_model_accuracy_morning` | `10 6 * * *` | Runs 10 min after `check-outcomes-morning` (6:00 UTC) |
| `refresh_mv_model_accuracy_midnight` | `10 0 * * *` | Runs 10 min after `check-outcomes-midnight` (0:00 UTC) |

Both execute: `REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_model_accuracy;`

Why two and not more: the MV only needs to refresh when `ai_suggestions.actual_outcome` changes, which happens only during `check-outcomes` runs. Additional refreshes would be no-ops. If a third `check-outcomes` run is added later (as part of the settlement-bugs task), a matching third refresh job gets added then.

### Consumer changes

#### Admin endpoint ([api/admin-dashboard.js](../../../api/admin-dashboard.js))

Replace six separate `.select()` queries against `ai_suggestions` with one query against the MV:

```js
const period = req.query.period || 'all';  // 'all' | 'last_30d' | 'last_7d'

const { data: mvRows } = await supabase
  .from('mv_model_accuracy')
  .select('*')
  .eq('period_bucket', period);

const modelAccuracy = {
  overall:    mvRows.find(r => r.dimension_type === 'overall'),
  bySport:    keyBy(mvRows.filter(r => r.dimension_type === 'sport'), 'dimension_value'),
  byBetType:  keyBy(mvRows.filter(r => r.dimension_type === 'bet_type'), 'dimension_value'),
  byMode:     keyBy(mvRows.filter(r => r.dimension_type === 'generate_mode'), 'dimension_value'),
  edgeCalibration:           mvRows.filter(r => r.dimension_type === 'edge_integer'),
  edgeBuckets:               mvRows.filter(r => r.dimension_type === 'edge_bucket'),
  chatConfidenceCalibration: mvRows.filter(r => r.dimension_type === 'chat_confidence'),
  roi: {
    units: mvRows.find(r => r.dimension_type === 'overall')?.roi_units,
    pct:   mvRows.find(r => r.dimension_type === 'overall')?.roi_pct,
  },
};
```

Existing JSON keys (`overall`, `bySport`, `byBetType`) preserve their shape for backwards compatibility with `AdminDashboard.jsx`. New keys added for new UI sections (`byMode`, `edgeBuckets`, `chatConfidenceCalibration`, `roi`).

#### Admin UI ([src/pages/AdminDashboard.jsx](../../../src/pages/AdminDashboard.jsx))

- Add period selector dropdown: `All-time ▾ | Last 30d | Last 7d`, passes `?period=` to endpoint.
- Add top-level ROI card alongside existing Win Rate card.
- Split current `ConfidenceCalibrationSection` into two: "Edge Score Performance" (reads `edgeCalibration` + `edgeBuckets`) and "De-Genny Confidence Calibration" (reads `chatConfidenceCalibration`). Reuses the existing chart component with different data.
- Add "By Generate Mode" section (new component or reuse `bySport` styling).

#### User ResultsPage ([src/pages/ResultsPage.jsx](../../../src/pages/ResultsPage.jsx))

Replace the current 14-day JS aggregation query:

```js
// BEFORE
const { data: suggestions } = await supabase
  .from('ai_suggestions')
  .select('sport, bet_type, actual_outcome, generate_mode, created_at')
  .neq('actual_outcome', 'pending')
  .gte('created_at', since14days);
// ... then JS loop to count per sport/mode

// AFTER
const { data: mvRows } = await supabase
  .from('mv_model_accuracy')
  .select('*')
  .eq('period_bucket', 'last_30d');

const modelStats = {
  total:   mvRows.find(r => r.dimension_type === 'overall')?.total,
  wins:    mvRows.find(r => r.dimension_type === 'overall')?.won,
  losses:  mvRows.find(r => r.dimension_type === 'overall')?.lost,
  winRate: /* computed from overall */,
  roi:     mvRows.find(r => r.dimension_type === 'overall')?.roi_pct,
  bySport: keyBy(mvRows.filter(r => r.dimension_type === 'sport'), 'dimension_value'),
  byMode:  keyBy(mvRows.filter(r => r.dimension_type === 'generate_mode'), 'dimension_value'),
};
```

Window shifts from "last 14d" to "last 30d" — this is the window we precomputed, and it aligns with the competitor-research standard (Leans.ai, Dimers, Unabated all use 30d or all-time).

### Migration

Single migration file `supabase/migrations/YYYYMMDDHHMMSS_model_accuracy_mv.sql`:

1. `DROP TABLE IF EXISTS public.model_accuracy;` (empty, orphan)
2. `CREATE MATERIALIZED VIEW public.mv_model_accuracy AS ...`
3. `CREATE UNIQUE INDEX idx_mv_model_accuracy_key ON public.mv_model_accuracy (period_bucket, dimension_type, dimension_value);`
4. Initial `REFRESH MATERIALIZED VIEW public.mv_model_accuracy;` (first refresh is non-concurrent because the view is empty)
5. Two `SELECT cron.schedule(...)` calls for the refresh jobs
6. `GRANT SELECT ON public.mv_model_accuracy TO authenticated, anon, service_role;` (matching other public read-paths)

### Safe-rollout notes

- The MV creation is additive — no existing table or code breaks at deploy time.
- The admin endpoint and ResultsPage changes can ship in the same PR as the migration, OR the migration can ship first and the endpoint changes follow in a second PR (MV sits unused between, harmless).
- Rolling back is `DROP MATERIALIZED VIEW public.mv_model_accuracy; DROP TABLE public.model_accuracy;` + revert of endpoint changes. Dropping the MV doesn't touch source data.

## Verification

Before declaring complete:

1. **Schema verification:** `SELECT COUNT(*) FROM mv_model_accuracy;` returns ~120-150 rows.
2. **Truth check:** for at least one sport, manually compare MV row against a direct query on `ai_suggestions`:
   ```sql
   -- MV says:
   SELECT won, lost, push, pending FROM mv_model_accuracy
   WHERE period_bucket='all' AND dimension_type='sport' AND dimension_value='NBA';

   -- Direct query:
   SELECT actual_outcome, COUNT(*) FROM ai_suggestions
   WHERE sport='NBA' GROUP BY actual_outcome;
   ```
   Numbers must match exactly.
3. **Admin endpoint sanity:** `curl "$API/api/admin/dashboard?secret=..."` returns `modelAccuracy.overall.total` equal to the true `SELECT COUNT(*) FROM ai_suggestions` (not 1000).
4. **ROI plausibility:** for `generate_mode='Easy Money'` (Moneyline-only, all have odds), `roi_pct` should be non-null and fall in a plausible betting range (say, between -30% and +30%).
5. **Refresh cron verification:** `SELECT * FROM cron.job WHERE jobname LIKE 'refresh_mv_%'` returns the two new jobs; `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5` shows a successful run within 24 hours.
6. **UI smoke:** admin dashboard renders all sections without errors; period dropdown toggles the numbers; De-Genny calibration section shows rows separate from edge calibration.

## Out-of-scope follow-ups (queued for later)

1. **Backfill historical `odds` on the 1,278 auto_digest picks.** Join to `game_analysis` or `odds_cache` on `(sport, home_team, away_team, game_date::date)`. Write a one-shot script. Populates ROI for pre-fix rows.
2. **CLV tracking.** New `closing_line_odds` column on `ai_suggestions`, new cron `capture-closing-lines.js` that snaps lines ~5 min before kickoff, new MV column `avg_clv_cents`.
3. **Settlement bug fixes.** EPL / Tennis coverage, UFC parser, `games_fetched: 0` bug, `parlay_legs` half-settlement.
4. **pgvector pregame retrieval pipeline.** Populate `news_embeddings` and `unified_vectors`, replace raw-text-dump approach in pick generation.
5. **Parlay correlation warnings.** Prompt-engineering pass on the parlay builder, inspired by Goated.
6. **Public game brief pages.** New route exposing `game_analysis` writeups (you already generate them, just need a UI).
