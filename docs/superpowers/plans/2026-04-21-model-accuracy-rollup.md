# Model Accuracy Rollup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1000-row-capped JavaScript aggregation in the admin and user-facing model-performance UIs with a Postgres materialized view that precomputes win/loss/push/pending + ROI by sport, bet_type, edge score, generate_mode, chat_confidence, across three rolling windows — refreshed by pg_cron after each settlement run.

**Architecture:** One materialized view (`public.mv_model_accuracy`) grained at `(period_bucket, dimension_type, dimension_value)`. Refreshed concurrently twice daily. Both consumers read the MV with a single `.eq('period_bucket', …)` query; no JS aggregation. Orphan `public.model_accuracy` table dropped in the same migration. Odds-capture bug on auto_digest picks fixed separately so ROI math populates on new picks immediately.

**Tech Stack:** Supabase Postgres 17 (MV + pg_cron + CONCURRENTLY refresh), Node.js Express API on Railway, React/Vite frontend on Vercel, `@supabase/supabase-js` client.

**Spec reference:** [docs/superpowers/specs/2026-04-21-model-accuracy-rollup-design.md](../specs/2026-04-21-model-accuracy-rollup-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `api/cron/pre-analyze-games.js` | MODIFY (already edited locally, uncommitted) | Capture real American odds on auto_digest pick insert, not `null` |
| `supabase/migrations/20260421180744_model_accuracy_mv.sql` | CREATE | Drop orphan table; create MV, unique index, grants; schedule two refresh cron jobs |
| `api/admin-dashboard.js` | MODIFY | Replace six `.select()` + JS loops with one MV read, expand response with `byMode` / `edgeBuckets` / `chatConfidenceCalibration` / `roi` / `period` |
| `src/pages/AdminDashboard.jsx` | MODIFY | Period selector dropdown; split calibration into two sections (edge + chat); ROI card; By Generate Mode section |
| `src/pages/ResultsPage.jsx` | MODIFY | Read model stats from MV at `period_bucket='last_30d'` instead of in-page aggregation |

**No new tests are added** — the repo's test infrastructure (Jest in `__tests__/`) is API-endpoint-focused and this work is data-pipeline + UI. Verification uses SQL spot-checks and `curl` of the live admin endpoint per the spec's verification section.

---

## Task 1: Commit the auto_digest odds-capture fix

The fix is already applied to `api/cron/pre-analyze-games.js` in the working tree. This task is about reviewing + committing it cleanly before the MV work starts, so ROI math works on new auto_digest picks from the moment the MV lands.

**Files:**
- Modify: `api/cron/pre-analyze-games.js` (already edited — review only)

- [ ] **Step 1: Review the diff**

```bash
git diff api/cron/pre-analyze-games.js
```

Expected changes:
1. `extractOddsContext()` now also captures `spread_home_odds`, `spread_away_odds`, `over_odds`, `under_odds` (the juice/price per side, alongside the existing point/line values).
2. Two new helpers added below: `formatAmericanOdds(price)` (numeric → signed string like `+130` / `-110`) and `resolveOddsForPick(oddsCtx, recommendedSide)` (maps `home_spread`/`away_spread`/`over`/`under`/`home_ml`/`away_ml` → the right juice value).
3. At the `ai_suggestions` insert site (~line 920), the hardcoded `odds: null` is replaced with `odds: pickOdds` computed from the helpers.

- [ ] **Step 2: Syntax check**

```bash
node --check api/cron/pre-analyze-games.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit the fix on its own**

```bash
git add api/cron/pre-analyze-games.js
git commit -m "$(cat <<'EOF'
fix: Auto-digest picks now capture real American odds

ai_suggestions rows written by pre-analyze-games had odds hardcoded to null
since the auto_digest insert was added, making ROI computation impossible
for 100% of auto_digest picks (1,278 rows over ~3 weeks). extractOddsContext
now captures spread/total juice in addition to lines; the insert resolves
the correct side's odds via recommended_side.

Forward-only fix; historical rows stay null until a separate backfill task.
EOF
)"
```

- [ ] **Step 4: Verify commit landed**

```bash
git log -1 --stat
```

Expected: one commit touching only `api/cron/pre-analyze-games.js`.

---

## Task 2: Write the migration file

One migration file does everything: drops the orphan, creates the MV + unique index, grants permissions, does the initial (non-concurrent) refresh, and schedules the two pg_cron refresh jobs. Applied atomically via Supabase MCP in Task 3.

**Files:**
- Create: `supabase/migrations/20260421180744_model_accuracy_mv.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260421180744_model_accuracy_mv.sql
-- Model accuracy rollup materialized view — replaces JS-side aggregation.
-- See docs/superpowers/specs/2026-04-21-model-accuracy-rollup-design.md

-- 1. Drop the orphan table that was never populated
DROP TABLE IF EXISTS public.model_accuracy;

-- 2. Create the materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_model_accuracy AS
WITH picks AS (
  SELECT
    id, sport, bet_type, confidence, generate_mode, actual_outcome, odds,
    created_at, game_date,
    CASE
      WHEN odds ~ '^[+-]?\d+$' THEN
        CASE
          WHEN odds::int > 0 THEN 1 + odds::int / 100.0
          WHEN odds::int < 0 THEN 1 + 100.0 / abs(odds::int)
          ELSE NULL
        END
      ELSE NULL
    END AS decimal_odds
  FROM public.ai_suggestions
),
picks_periods AS (
  SELECT picks.*, 'all'::text AS period_bucket FROM picks
  UNION ALL
  SELECT picks.*, 'last_30d' FROM picks WHERE game_date >= NOW() - INTERVAL '30 days'
  UNION ALL
  SELECT picks.*, 'last_7d'  FROM picks WHERE game_date >= NOW() - INTERVAL '7 days'
),
aggs AS (
  -- Block 1: overall
  SELECT
    period_bucket,
    'overall'::text AS dimension_type,
    'all'::text AS dimension_value,
    COUNT(*) FILTER (WHERE actual_outcome = 'won')     AS won,
    COUNT(*) FILTER (WHERE actual_outcome = 'lost')    AS lost,
    COUNT(*) FILTER (WHERE actual_outcome = 'push')    AS push,
    COUNT(*) FILTER (WHERE actual_outcome = 'pending') AS pending,
    COUNT(*)                                           AS total,
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL) AS settled_with_odds,
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')) AS avg_decimal_odds,
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0
    END) AS roi_units
  FROM picks_periods
  GROUP BY period_bucket

  UNION ALL
  -- Block 2: sport
  SELECT period_bucket, 'sport', sport,
    COUNT(*) FILTER (WHERE actual_outcome = 'won'),
    COUNT(*) FILTER (WHERE actual_outcome = 'lost'),
    COUNT(*) FILTER (WHERE actual_outcome = 'push'),
    COUNT(*) FILTER (WHERE actual_outcome = 'pending'),
    COUNT(*),
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL),
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')),
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0 END)
  FROM picks_periods
  WHERE sport IS NOT NULL
  GROUP BY period_bucket, sport

  UNION ALL
  -- Block 3: bet_type
  SELECT period_bucket, 'bet_type', bet_type,
    COUNT(*) FILTER (WHERE actual_outcome = 'won'),
    COUNT(*) FILTER (WHERE actual_outcome = 'lost'),
    COUNT(*) FILTER (WHERE actual_outcome = 'push'),
    COUNT(*) FILTER (WHERE actual_outcome = 'pending'),
    COUNT(*),
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL),
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')),
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0 END)
  FROM picks_periods
  WHERE bet_type IS NOT NULL
  GROUP BY period_bucket, bet_type

  UNION ALL
  -- Block 4: edge_integer (auto-modes only)
  SELECT period_bucket, 'edge_integer', confidence::text,
    COUNT(*) FILTER (WHERE actual_outcome = 'won'),
    COUNT(*) FILTER (WHERE actual_outcome = 'lost'),
    COUNT(*) FILTER (WHERE actual_outcome = 'push'),
    COUNT(*) FILTER (WHERE actual_outcome = 'pending'),
    COUNT(*),
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL),
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')),
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0 END)
  FROM picks_periods
  WHERE generate_mode IN ('auto_digest','AI Edge Advantages','Top Picks of the Day','Easy Money','Heavy Favorites')
    AND confidence BETWEEN 1 AND 10
  GROUP BY period_bucket, confidence

  UNION ALL
  -- Block 5: edge_bucket (auto-modes only)
  SELECT period_bucket, 'edge_bucket',
    CASE
      WHEN confidence BETWEEN 1 AND 4  THEN 'Low (1-4)'
      WHEN confidence BETWEEN 5 AND 6  THEN 'Medium (5-6)'
      WHEN confidence BETWEEN 7 AND 8  THEN 'High (7-8)'
      WHEN confidence BETWEEN 9 AND 10 THEN 'Strong (9-10)'
    END,
    COUNT(*) FILTER (WHERE actual_outcome = 'won'),
    COUNT(*) FILTER (WHERE actual_outcome = 'lost'),
    COUNT(*) FILTER (WHERE actual_outcome = 'push'),
    COUNT(*) FILTER (WHERE actual_outcome = 'pending'),
    COUNT(*),
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL),
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')),
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0 END)
  FROM picks_periods
  WHERE generate_mode IN ('auto_digest','AI Edge Advantages','Top Picks of the Day','Easy Money','Heavy Favorites')
    AND confidence BETWEEN 1 AND 10
  GROUP BY period_bucket,
    CASE
      WHEN confidence BETWEEN 1 AND 4  THEN 'Low (1-4)'
      WHEN confidence BETWEEN 5 AND 6  THEN 'Medium (5-6)'
      WHEN confidence BETWEEN 7 AND 8  THEN 'High (7-8)'
      WHEN confidence BETWEEN 9 AND 10 THEN 'Strong (9-10)'
    END

  UNION ALL
  -- Block 6: generate_mode
  SELECT period_bucket, 'generate_mode', generate_mode,
    COUNT(*) FILTER (WHERE actual_outcome = 'won'),
    COUNT(*) FILTER (WHERE actual_outcome = 'lost'),
    COUNT(*) FILTER (WHERE actual_outcome = 'push'),
    COUNT(*) FILTER (WHERE actual_outcome = 'pending'),
    COUNT(*),
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL),
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')),
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0 END)
  FROM picks_periods
  WHERE generate_mode IS NOT NULL
  GROUP BY period_bucket, generate_mode

  UNION ALL
  -- Block 7: chat_confidence (degenny_chat only)
  SELECT period_bucket, 'chat_confidence', confidence::text,
    COUNT(*) FILTER (WHERE actual_outcome = 'won'),
    COUNT(*) FILTER (WHERE actual_outcome = 'lost'),
    COUNT(*) FILTER (WHERE actual_outcome = 'push'),
    COUNT(*) FILTER (WHERE actual_outcome = 'pending'),
    COUNT(*),
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL),
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')),
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0 END)
  FROM picks_periods
  WHERE generate_mode = 'degenny_chat'
    AND confidence BETWEEN 1 AND 10
  GROUP BY period_bucket, confidence
)
SELECT
  period_bucket, dimension_type, dimension_value,
  won, lost, push, pending, total,
  settled_with_odds, avg_decimal_odds, roi_units,
  CASE
    WHEN settled_with_odds > 0 THEN roi_units / settled_with_odds * 100
    ELSE NULL
  END AS roi_pct,
  NOW() AS updated_at
FROM aggs;

-- 3. Unique index (required for REFRESH CONCURRENTLY)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_model_accuracy_key
  ON public.mv_model_accuracy (period_bucket, dimension_type, dimension_value);

-- 4. Grants (matching other public read-paths in this project)
GRANT SELECT ON public.mv_model_accuracy TO anon, authenticated, service_role;

-- 5. Schedule two refresh cron jobs tied to check-outcomes runs
SELECT cron.schedule(
  'refresh_mv_model_accuracy_morning',
  '10 6 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_model_accuracy;$$
);

SELECT cron.schedule(
  'refresh_mv_model_accuracy_midnight',
  '10 0 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_model_accuracy;$$
);
```

Note on block 2–7 formatting: the first `FROM picks_periods` in block 1 names each aggregate column. Blocks 2–7 rely on positional matching inside `UNION ALL` — the column names come from block 1. This is standard Postgres `UNION ALL` behavior; the column list at the outer SELECT (`period_bucket, dimension_type, dimension_value, won, ...`) confirms the final names.

- [ ] **Step 2: Commit the migration file**

```bash
git add supabase/migrations/20260421180744_model_accuracy_mv.sql
git commit -m "feat: Model accuracy rollup MV migration

Creates public.mv_model_accuracy grained at (period, dimension_type, value).
Drops orphan public.model_accuracy. Schedules two pg_cron refresh jobs."
```

---

## Task 3: Apply the migration via Supabase MCP and verify

**Files:**
- Apply: `supabase/migrations/20260421180744_model_accuracy_mv.sql` (already committed in Task 2)

- [ ] **Step 1: Apply the migration**

Use the Supabase MCP `apply_migration` tool with:
- `project_id`: `pcjhulzyqmhrhsrgvwvx`
- `name`: `model_accuracy_mv`
- `query`: the full SQL from the migration file above

Expected: success response, no error.

- [ ] **Step 2: Verify the view exists and has expected row count**

Use Supabase MCP `execute_sql`:

```sql
SELECT COUNT(*) AS row_count FROM public.mv_model_accuracy;
```

Expected: `row_count` between 100 and 200 (approximately 140 at current data volume — see spec Dimensions section).

- [ ] **Step 3: Verify row distribution by dimension_type**

```sql
SELECT dimension_type, COUNT(*)
FROM public.mv_model_accuracy
WHERE period_bucket = 'all'
GROUP BY dimension_type
ORDER BY dimension_type;
```

Expected rows approximately:
- `overall`: 1
- `sport`: 8-9
- `bet_type`: 4-5
- `edge_integer`: up to 10
- `edge_bucket`: up to 4
- `generate_mode`: 7-9
- `chat_confidence`: up to 10

- [ ] **Step 4: Truth check against `ai_suggestions` for NBA**

```sql
-- MV says:
SELECT won, lost, push, pending, total
FROM public.mv_model_accuracy
WHERE period_bucket = 'all' AND dimension_type = 'sport' AND dimension_value = 'NBA';

-- Ground truth:
SELECT
  COUNT(*) FILTER (WHERE actual_outcome = 'won')     AS won,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost')    AS lost,
  COUNT(*) FILTER (WHERE actual_outcome = 'push')    AS push,
  COUNT(*) FILTER (WHERE actual_outcome = 'pending') AS pending,
  COUNT(*)                                           AS total
FROM public.ai_suggestions
WHERE sport = 'NBA';
```

Expected: the five numbers match exactly.

- [ ] **Step 5: ROI plausibility check**

```sql
SELECT dimension_value, won, lost, push, settled_with_odds, roi_units, roi_pct
FROM public.mv_model_accuracy
WHERE period_bucket = 'all' AND dimension_type = 'generate_mode'
ORDER BY settled_with_odds DESC;
```

Expected: `Easy Money` (Moneyline-only, all rows have odds per earlier DB inspection) shows `settled_with_odds > 0` and a non-null `roi_pct`, typically between -30% and +30%. `auto_digest` shows `settled_with_odds = 0` and `roi_pct IS NULL` because the historical rows still lack odds (backfill is a future task). `degenny_chat` shows non-null `roi_pct`.

- [ ] **Step 6: Cron jobs scheduled**

```sql
SELECT jobname, schedule
FROM cron.job
WHERE jobname LIKE 'refresh_mv_model_accuracy_%';
```

Expected: two rows — `refresh_mv_model_accuracy_morning` (`10 6 * * *`) and `refresh_mv_model_accuracy_midnight` (`10 0 * * *`).

---

## Task 4: Rewrite `api/admin-dashboard.js` to read from the MV

Replace the six existing `.select()` + JS-loop aggregations with one MV read per period. Preserve the response JSON shape for the three fields `AdminDashboard.jsx` already renders (`overall`, `bySport`, `byBetType`) and add four new fields (`byMode`, `edgeCalibration`, `edgeBuckets`, `chatConfidenceCalibration`, `roi`). The endpoint also accepts a new `?period=` query param.

**Files:**
- Modify: `api/admin-dashboard.js`

- [ ] **Step 1: Replace the model-accuracy aggregation block**

Locate the existing block in `api/admin-dashboard.js` — three `safeQuery` calls for `overallAccuracyResult`, `sportBreakdownResult`, and `betTypeBreakdownResult` (the contiguous block of `.select('actual_outcome')` / `.select('sport, actual_outcome')` / `.select('bet_type, actual_outcome')` and their loop aggregations). Replace that entire block with:

```js
// --- 3. Model Accuracy: single MV read, slice by dimension ---
const period = ['all', 'last_30d', 'last_7d'].includes(req.query.period)
  ? req.query.period
  : 'all';

const modelAccuracyResult = await safeQuery(async () => {
  const { data, error } = await supabase
    .from('mv_model_accuracy')
    .select('*')
    .eq('period_bucket', period);
  if (error) throw error;

  const keyByValue = (rows) => {
    const out = {};
    for (const r of rows) {
      out[r.dimension_value] = {
        won: r.won || 0,
        lost: r.lost || 0,
        push: r.push || 0,
        pending: r.pending || 0,
        total: r.total || 0,
        settled_with_odds: r.settled_with_odds || 0,
        roi_units: r.roi_units != null ? Number(r.roi_units) : null,
        roi_pct: r.roi_pct != null ? Number(r.roi_pct) : null,
      };
    }
    return out;
  };

  const overallRow = data.find(r => r.dimension_type === 'overall');
  const overall = overallRow ? {
    won: overallRow.won || 0,
    lost: overallRow.lost || 0,
    push: overallRow.push || 0,
    pending: overallRow.pending || 0,
    total: overallRow.total || 0,
    settled_with_odds: overallRow.settled_with_odds || 0,
    roi_units: overallRow.roi_units != null ? Number(overallRow.roi_units) : null,
    roi_pct: overallRow.roi_pct != null ? Number(overallRow.roi_pct) : null,
  } : { won: 0, lost: 0, push: 0, pending: 0, total: 0, settled_with_odds: 0, roi_units: null, roi_pct: null };

  return {
    overall,
    bySport:   keyByValue(data.filter(r => r.dimension_type === 'sport')),
    byBetType: keyByValue(data.filter(r => r.dimension_type === 'bet_type')),
    byMode:    keyByValue(data.filter(r => r.dimension_type === 'generate_mode')),
    edgeCalibration:           data.filter(r => r.dimension_type === 'edge_integer').sort((a, b) => Number(a.dimension_value) - Number(b.dimension_value)),
    edgeBuckets:               data.filter(r => r.dimension_type === 'edge_bucket'),
    chatConfidenceCalibration: data.filter(r => r.dimension_type === 'chat_confidence').sort((a, b) => Number(a.dimension_value) - Number(b.dimension_value)),
    roi: {
      units: overall.roi_units,
      pct: overall.roi_pct,
    },
    period,
  };
});
```

- [ ] **Step 2: Remove the now-unused `confidenceCalibrationResult` block**

Locate the `safeQuery` call that builds `confidenceCalibrationResult` (selects `confidence, actual_outcome` from `ai_suggestions`, loops through buckets). Delete it entirely — it is now supplied by the MV via `edgeCalibration` and `chatConfidenceCalibration`.

- [ ] **Step 3: Update the final `res.json(...)` response**

Locate the existing `res.json({...})` at the end of `getAdminDashboard`. Replace the `modelAccuracy` field and remove `confidenceCalibration`:

```js
res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  cronHealth: cronHealthResult || [],
  recentErrors: recentErrorsResult || [],
  modelAccuracy: modelAccuracyResult || {
    overall: { won: 0, lost: 0, push: 0, pending: 0, total: 0, settled_with_odds: 0, roi_units: null, roi_pct: null },
    bySport: {},
    byBetType: {},
    byMode: {},
    edgeCalibration: [],
    edgeBuckets: [],
    chatConfidenceCalibration: [],
    roi: { units: null, pct: null },
    period: 'all',
  },
  recentPicks: recentPicksResult || [],
  settlementStatus: {
    parlaysByStatus: parlayStatusResult || {},
    legsByOutcome: parlayLegsResult || {}
  },
  dataFreshness: freshnessResults,
});
```

Note: `confidenceCalibration` is removed from the response. `AdminDashboard.jsx` will be updated to consume `edgeCalibration` + `chatConfidenceCalibration` in Task 6.

- [ ] **Step 4: Syntax check**

```bash
node --check api/admin-dashboard.js
```

Expected: no output, exit code 0.

- [ ] **Step 5: Hit the endpoint locally and verify shape**

If the dev API is running on Railway (production) or via `npm run dev`:

```bash
curl -sS "https://craycrayparlayapp-production.up.railway.app/api/admin/dashboard?secret=admin123" \
  | jq '.modelAccuracy | {overall, period, sportKeys: (.bySport | keys), roiPct: .roi.pct, edgeCount: (.edgeCalibration | length), chatCount: (.chatConfidenceCalibration | length)}'
```

NOTE: Step 5 requires the code to be deployed. If developing locally, commit and deploy first, then re-run this step. Alternatively run the dev server (`npm run dev` per `package.json`) and curl `http://localhost:<port>/api/admin/dashboard?secret=admin123`.

Expected:
- `overall.total` matches `SELECT COUNT(*) FROM ai_suggestions` (not 1000)
- `sportKeys` includes all sports seen in the DB (NBA, MLB, NHL, NCAAB, EPL, MLS, UFC, Tennis, NFL)
- `roiPct` is a number or null
- `edgeCount` between 1 and 10
- `chatCount` between 1 and 10

- [ ] **Step 6: Period parameter works**

```bash
curl -sS "https://craycrayparlayapp-production.up.railway.app/api/admin/dashboard?secret=admin123&period=last_7d" \
  | jq '.modelAccuracy.period, .modelAccuracy.overall.total'
```

Expected: `"last_7d"` and a smaller total than the `all` period.

- [ ] **Step 7: Commit**

```bash
git add api/admin-dashboard.js
git commit -m "refactor: Admin endpoint reads from mv_model_accuracy

Replaces six .select() + JS-loop aggregations with a single MV query
that returns precomputed won/lost/push/pending + ROI by every dimension
the dashboard needs. Adds ?period=all|last_30d|last_7d query param.
Response shape is backwards-compatible for existing UI; adds byMode,
edgeCalibration, edgeBuckets, chatConfidenceCalibration, roi."
```

---

## Task 5: Add period selector to AdminDashboard UI

The endpoint now accepts `?period=`. The React page needs a dropdown that drives that parameter.

**Files:**
- Modify: `src/pages/AdminDashboard.jsx`

- [ ] **Step 1: Add period state and update fetch call**

Near the top of `AdminDashboard` component (around line 495 where `useState` hooks live), add:

```jsx
const [period, setPeriod] = useState('all')
```

- [ ] **Step 2: Update the fetch URL to include period**

Locate `fetchData` (around line 501). Change the `fetch(...)` URL:

```jsx
const res = await fetch(`${API_BASE}/api/admin/dashboard?secret=${ADMIN_SECRET}&period=${period}`)
```

And update the `useEffect` dependency list so changing the period triggers a refetch:

```jsx
useEffect(() => {
  fetchData()
}, [fetchData])
```

And update `fetchData`'s `useCallback` deps:

```jsx
const fetchData = useCallback(async () => {
  // ... existing body ...
}, [period])
```

- [ ] **Step 3: Add the dropdown to the sticky header**

Locate the header's refresh button (around line 545 — `<button onClick={fetchData}...>Refresh</button>`). Insert a dropdown BEFORE the refresh button, inside the same flex container:

```jsx
<select
  value={period}
  onChange={(e) => setPeriod(e.target.value)}
  className="bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700"
>
  <option value="all">All-time</option>
  <option value="last_30d">Last 30 days</option>
  <option value="last_7d">Last 7 days</option>
</select>
```

- [ ] **Step 4: Smoke test in dev**

```bash
npm run dev
```

Open the admin page, pick each period from the dropdown, confirm the numbers change between options. `Last 7 days` should show a smaller total than `All-time`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AdminDashboard.jsx
git commit -m "feat: Period selector on admin dashboard (all / 30d / 7d)"
```

---

## Task 6: Split calibration sections + add ROI card + By-Mode section

Three UI additions in one file. Keeping them together because they all consume the same freshly-added endpoint fields and touch contiguous regions of `AdminDashboard.jsx`.

**Files:**
- Modify: `src/pages/AdminDashboard.jsx`

- [ ] **Step 1: Update `ConfidenceCalibrationSection` to take generic props**

Locate the existing `ConfidenceCalibrationSection({ calibration })` function (around line 383). Rename it to `CalibrationSection` and accept a `title` + `subtitle` + `calibration` shape matching MV row output:

```jsx
function CalibrationSection({ title, subtitle, calibration }) {
  if (!calibration || calibration.length === 0) return null
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <SectionHeader title={title} sub={subtitle} />
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mt-4">
        {calibration.map(b => {
          const won = b.won || 0
          const lost = b.lost || 0
          const total = won + lost
          const winPct = total > 0 ? Math.round((won / total) * 100) : 0
          const expected = Number(b.dimension_value) * 10
          const isCalibrated = Math.abs(winPct - expected) < 15
          return (
            <div key={b.dimension_value} className="bg-gray-900 rounded-lg p-3 text-center border border-gray-700">
              <div className="text-2xl font-bold text-yellow-400">{b.dimension_value}/10</div>
              <div className={`text-lg font-bold mt-1 ${winPct >= 65 ? 'text-green-400' : winPct >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                {winPct}%
              </div>
              <div className="text-xs text-gray-500 mt-1">{won}W-{lost}L ({total})</div>
              <div className="mt-2 w-full bg-gray-700 rounded-full h-2">
                <div className={`h-2 rounded-full ${winPct >= 65 ? 'bg-green-500' : winPct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${winPct}%` }} />
              </div>
              <div className="text-[10px] mt-1 text-gray-600">
                {total === 0 ? '—' : isCalibrated ? '✓ calibrated' : winPct > expected ? '↑ underconfident' : '↓ overconfident'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Replace the single `<ConfidenceCalibrationSection ... />` render with two**

Locate where `<ConfidenceCalibrationSection calibration={data.confidenceCalibration} />` is rendered (around line 619 in the main return). Replace with two `<CalibrationSection>` calls:

```jsx
<CalibrationSection
  title="Edge Score Performance"
  subtitle="Win rate by calculated edge score (auto-generated picks only)"
  calibration={data.modelAccuracy?.edgeCalibration}
/>
<CalibrationSection
  title="De-Genny Confidence Calibration"
  subtitle="Win rate by De-Genny's self-stated confidence (chat picks only)"
  calibration={data.modelAccuracy?.chatConfidenceCalibration}
/>
```

- [ ] **Step 3: Add the ROI card to the quick-stats row**

Locate the quick-stats grid (around line 580 — the four `<StatCard>` in a `grid-cols-2 sm:grid-cols-4` grid). Add a fifth StatCard for ROI after the "Total Parlays" card, and widen the grid to 5 columns on large screens:

```jsx
<div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
  <StatCard
    label="Cron Jobs Tracked"
    value={(data.cronHealth || []).length}
    color="blue"
  />
  <StatCard
    label="Recent Failures"
    value={data.recentErrors?.length ?? 0}
    color={data.recentErrors?.length > 0 ? 'red' : 'green'}
  />
  <StatCard
    label="Total AI Picks"
    value={(data.modelAccuracy?.overall?.total ?? 0).toLocaleString()}
    color="yellow"
  />
  <StatCard
    label="Total Parlays"
    value={Object.values(data.settlementStatus?.parlaysByStatus || {}).reduce((s, v) => s + v, 0).toLocaleString()}
    color="purple"
  />
  <StatCard
    label="ROI"
    value={data.modelAccuracy?.roi?.pct != null
      ? `${data.modelAccuracy.roi.pct >= 0 ? '+' : ''}${data.modelAccuracy.roi.pct.toFixed(1)}%`
      : '—'}
    sub={data.modelAccuracy?.roi?.units != null
      ? `${data.modelAccuracy.roi.units >= 0 ? '+' : ''}${data.modelAccuracy.roi.units.toFixed(2)} units`
      : 'no settled odds'}
    color={data.modelAccuracy?.roi?.pct == null ? 'gray'
      : data.modelAccuracy.roi.pct > 0 ? 'green'
      : data.modelAccuracy.roi.pct < 0 ? 'red'
      : 'yellow'}
  />
</div>
```

- [ ] **Step 4: Add `ByModeSection` component**

Add a new section component near `ModelPerformanceSection` (around line 230). It reuses the existing `WinRateBar` shared component:

```jsx
function ByModeSection({ byMode }) {
  if (!byMode || Object.keys(byMode).length === 0) return null
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
      <SectionHeader title="By Generate Mode" sub="Performance by pick-generation pipeline" />
      <div className="space-y-2">
        {Object.entries(byMode)
          .sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost))
          .map(([mode, counts]) => {
            const roi = counts.roi_pct
            return (
              <div key={mode} className="flex items-center gap-3">
                <span className="text-gray-300 text-xs w-40 flex-shrink-0">{mode}</span>
                <div className="flex-1">
                  <WinRateBar won={counts.won} lost={counts.lost} />
                </div>
                <span className="text-gray-500 text-xs w-20 text-right flex-shrink-0">
                  {counts.won}W / {counts.lost}L
                </span>
                <span className={`text-xs font-bold w-16 text-right flex-shrink-0 ${
                  roi == null ? 'text-gray-600' :
                  roi > 0 ? 'text-green-400' :
                  roi < 0 ? 'text-red-400' : 'text-gray-400'
                }`}>
                  {roi != null ? `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%` : '—'}
                </span>
              </div>
            )
          })}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Render `ByModeSection` in the main return**

Locate the main render (around line 613 — after `<ModelPerformanceSection modelAccuracy={data.modelAccuracy} />`). Add the By Mode section right after:

```jsx
<ModelPerformanceSection modelAccuracy={data.modelAccuracy} />

<ByModeSection byMode={data.modelAccuracy?.byMode} />
```

- [ ] **Step 6: Dev-server smoke test**

```bash
npm run dev
```

Verify in the browser:
- ROI card appears in the header stats row (5 columns, last one)
- Edge Score Performance section renders with up to 10 tiles, sorted 1→10
- De-Genny Confidence Calibration section appears separately below (or hides if no chat rows)
- By Generate Mode section shows all pick-generation modes with ROI column
- Period dropdown still works — changing it updates every section

- [ ] **Step 7: Commit**

```bash
git add src/pages/AdminDashboard.jsx
git commit -m "feat: Admin dashboard ROI card + edge/chat calibration + by-mode

- Top-line ROI % / units card
- Split Confidence Calibration into Edge Score Performance and
  De-Genny Confidence Calibration
- New By Generate Mode section with per-mode ROI"
```

---

## Task 7: Swap ResultsPage to read from MV

The user-facing ResultsPage runs its own 14-day aggregation query that is subject to the same 1000-row cap. Swap it to read `mv_model_accuracy` at `period_bucket='last_30d'`.

**Files:**
- Modify: `src/pages/ResultsPage.jsx`

- [ ] **Step 1: Replace the model-stats loader**

Locate the existing block in `ResultsPage.jsx` starting around line 146 (the `// Load model performance (public)` comment through the `setModelStats({...})` call). Replace the entire block with:

```jsx
// Load model performance from precomputed MV (public)
if (supabase) {
  const { data: mvRows } = await supabase
    .from('mv_model_accuracy')
    .select('*')
    .eq('period_bucket', 'last_30d')

  if (mvRows && mvRows.length > 0) {
    const overallRow = mvRows.find(r => r.dimension_type === 'overall')
    const sportRows  = mvRows.filter(r => r.dimension_type === 'sport')
    const modeRows   = mvRows.filter(r => r.dimension_type === 'generate_mode')

    const asMap = (rows) => {
      const out = {}
      for (const r of rows) {
        out[r.dimension_value] = {
          wins: r.won || 0,
          losses: r.lost || 0,
          total: (r.won || 0) + (r.lost || 0) + (r.push || 0),
          roi_pct: r.roi_pct != null ? Number(r.roi_pct) : null,
        }
      }
      return out
    }

    const total   = overallRow ? (overallRow.won + overallRow.lost + overallRow.push) : 0
    const wins    = overallRow?.won || 0
    const losses  = overallRow?.lost || 0
    const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 'N/A'
    const roi_pct = overallRow?.roi_pct != null ? Number(overallRow.roi_pct) : null

    setModelStats({
      total, wins, losses, winRate, roi_pct,
      bySport: asMap(sportRows),
      byMode:  asMap(modeRows),
    })
  }
}
```

- [ ] **Step 2: Change stats grid to 5 columns and add ROI StatCard**

Locate the stats grid around line 271 (`<div className="grid grid-cols-4 gap-3 mb-6">` inside the `tab === 'model'` branch). Change grid columns from 4 to 5 and append an ROI card after the Win % card. Also update the Win % card's `sub` prop from "Last 14 days" to "Last 30 days" since the MV window is 30d:

```jsx
<div className="grid grid-cols-5 gap-3 mb-6">
  <StatCard label="Predictions" value={modelStats.total} color="blue" />
  <StatCard label="Wins" value={modelStats.wins} color="green" />
  <StatCard label="Losses" value={modelStats.losses} color="red" />
  <StatCard label="Win %" value={`${modelStats.winRate}%`} color="yellow" sub="Last 30 days" />
  <StatCard
    label="ROI"
    value={modelStats.roi_pct != null
      ? `${modelStats.roi_pct >= 0 ? '+' : ''}${modelStats.roi_pct.toFixed(1)}%`
      : '—'}
    color={modelStats.roi_pct == null ? 'gray'
      : modelStats.roi_pct > 0 ? 'green'
      : modelStats.roi_pct < 0 ? 'red'
      : 'yellow'}
  />
</div>
```

- [ ] **Step 3: Add ROI column to By-Sport rows**

Locate the By-Sport render block (around lines 281-295). Replace the `Object.entries(modelStats.bySport).map(...)` with a version that appends an ROI span:

```jsx
{Object.entries(modelStats.bySport).map(([sport, stats]) => {
  const wr = stats.wins + stats.losses > 0
    ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)
    : 'N/A'
  const roi = stats.roi_pct
  return (
    <div key={sport} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-2 border border-gray-700">
      <span className="text-sm text-gray-300">{sport}</span>
      <div className="flex items-center gap-4 text-xs">
        <span className="text-green-400">{stats.wins}W</span>
        <span className="text-red-400">{stats.losses}L</span>
        <span className="text-yellow-400 font-bold">{wr}%</span>
        <span className={`font-bold w-14 text-right ${
          roi == null ? 'text-gray-600' :
          roi > 0 ? 'text-green-400' :
          roi < 0 ? 'text-red-400' : 'text-gray-400'
        }`}>
          {roi != null ? `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%` : '—'}
        </span>
      </div>
    </div>
  )
})}
```

- [ ] **Step 4: Add ROI column to By-Mode rows**

Locate the By-Mode render block (around lines 301-315). Apply the same ROI-column pattern:

```jsx
{Object.entries(modelStats.byMode).map(([mode, stats]) => {
  const wr = stats.wins + stats.losses > 0
    ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)
    : 'N/A'
  const roi = stats.roi_pct
  return (
    <div key={mode} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-2 border border-gray-700">
      <span className="text-sm text-gray-300">{mode}</span>
      <div className="flex items-center gap-4 text-xs">
        <span className="text-green-400">{stats.wins}W</span>
        <span className="text-red-400">{stats.losses}L</span>
        <span className="text-yellow-400 font-bold">{wr}%</span>
        <span className={`font-bold w-14 text-right ${
          roi == null ? 'text-gray-600' :
          roi > 0 ? 'text-green-400' :
          roi < 0 ? 'text-red-400' : 'text-gray-400'
        }`}>
          {roi != null ? `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%` : '—'}
        </span>
      </div>
    </div>
  )
})}
```

- [ ] **Step 5: Dev-server smoke test**

```bash
npm run dev
```

Open the user Results page, switch to the "Model" tab, verify:
- Overall win rate number matches the MV's `last_30d` overall row (cross-check via SQL in Supabase: `SELECT * FROM mv_model_accuracy WHERE period_bucket='last_30d' AND dimension_type='overall'`)
- ROI StatCard renders with sign (or `—` if no settled-with-odds rows)
- By-sport rows show an ROI column alongside W/L/Win%
- By-mode rows show an ROI column alongside W/L/Win%

- [ ] **Step 6: Commit**

```bash
git add src/pages/ResultsPage.jsx
git commit -m "refactor: ResultsPage reads model stats from mv_model_accuracy

Removes the 1000-row-capped in-page aggregation; swaps to precomputed
last_30d rollup. Adds ROI stat card and per-sport/per-mode ROI columns."
```

---

## Task 8: Final verification and PR

**Files:** none modified, verification only.

- [ ] **Step 1: Run the full spec verification checklist**

Execute each item from the Verification section of the spec against the live deployment:

1. **Schema row count** (MCP `execute_sql`):
   ```sql
   SELECT COUNT(*) FROM public.mv_model_accuracy;
   ```
   Expected: 100–200.

2. **NBA truth check** — run the "MV says / Ground truth" pair from Task 3 Step 4. Numbers must match.

3. **Admin endpoint sanity**:
   ```bash
   curl -sS "https://craycrayparlayapp-production.up.railway.app/api/admin/dashboard?secret=admin123" \
     | jq '.modelAccuracy.overall.total, (.modelAccuracy.bySport | keys)'
   ```
   Expected: total matches `SELECT COUNT(*) FROM ai_suggestions` (not 1000); every sport in the DB appears in bySport keys.

4. **ROI plausibility**: admin dashboard UI shows a signed ROI % for overall and for `Easy Money`.

5. **Cron verification**:
   ```sql
   SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'refresh_mv_model_accuracy_%';
   SELECT jobname, status, start_time
   FROM cron.job_run_details
   WHERE jobname LIKE 'refresh_mv_model_accuracy_%'
   ORDER BY start_time DESC LIMIT 5;
   ```
   Expected: two jobs scheduled; at least one successful run after the next 0:10 or 6:10 UTC cron fire.

6. **UI smoke**: admin dashboard renders all sections without errors; period dropdown toggles the numbers; De-Genny calibration shows rows separate from edge calibration; ResultsPage model tab renders with ROI.

- [ ] **Step 2: Push the branch**

```bash
git log --oneline origin/main..HEAD
```

Expected: commits from Tasks 1–7 all present.

```bash
git push
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "Model accuracy rollup MV — fix stuck % on admin + user dashboards" --body "$(cat <<'EOF'
## Summary
- Creates `public.mv_model_accuracy` materialized view with 7 dimension types × 3 period buckets, refreshed by pg_cron after each `check-outcomes` run
- Fixes auto_digest odds-capture bug in `pre-analyze-games.js` so ROI math populates on new picks
- Admin endpoint + UI: replaces 1000-row-capped JS aggregation with single MV read, adds ROI card, splits calibration into edge-score vs De-Genny sections, adds period selector and By-Mode section
- ResultsPage: swaps to MV at `last_30d`

Implements [docs/superpowers/specs/2026-04-21-model-accuracy-rollup-design.md](docs/superpowers/specs/2026-04-21-model-accuracy-rollup-design.md).

## Test plan
- [ ] `SELECT COUNT(*) FROM public.mv_model_accuracy` returns 100–200 rows
- [ ] MV `NBA` sport row matches direct `ai_suggestions` groupby
- [ ] `curl /api/admin/dashboard` returns `overall.total` > 1000 when true
- [ ] Period dropdown toggles numbers visibly
- [ ] Edge Score Performance and De-Genny Confidence Calibration render as separate sections
- [ ] ROI card shows signed % on overall
- [ ] By Generate Mode shows per-mode ROI
- [ ] Refresh cron jobs visible in `cron.job`; first successful run logged

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of scope for this plan (queued follow-ups)

These are deliberately excluded — do not attempt in this PR:

1. **Historical odds backfill** on the 1,278 auto_digest picks missing `odds`. Separate script/task.
2. **CLV capture and column**. Requires new cron that snaps closing lines.
3. **Settlement bug fixes**: EPL/Tennis/UFC coverage in `check-outcomes`, `games_fetched: 0` upsert bug, `parlay_legs` half-settlement.
4. **pgvector pregame retrieval**: populate `news_embeddings`/`unified_vectors`, rewrite pick generation to use semantic retrieval.
5. **Parlay correlation warnings**, **public game brief pages**, **Bolt/Lock visual flag** — queued from competitor research.
