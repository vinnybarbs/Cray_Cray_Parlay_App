# SQL Settlement Function Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-writer settlement pipeline with a single Postgres-side SQL function triggered by `game_results` inserts, so all outcome resolution (ai_suggestions → parlay_legs → parlays) happens atomically in the DB with no external HTTP.

**Architecture:** One migration file creates `parlay_legs.suggestion_id` FK, backfills the linkage, defines 5 SQL functions (`determine_outcome`, `settle_ai_suggestions`, `settle_parlay_legs`, `settle_parlays`, `run_settlement`), installs a statement-level trigger on `game_results`, schedules a daily safety cron, and unschedules the four old settlement crons. A second commit updates the parlay-lock UI code to write `suggestion_id` on new legs going forward. Retroactive `SELECT run_settlement()` after migration clears the stale backlog in one shot.

**Tech Stack:** Supabase Postgres 17 (pg_cron, triggers, plpgsql), Supabase MCP `apply_migration` tool, React/Vite frontend, `@supabase/supabase-js` client.

**Spec reference:** [docs/superpowers/specs/2026-04-21-sql-settlement-function-design.md](../specs/2026-04-21-sql-settlement-function-design.md)

**Current branch:** `feature/sql-settlement-function` (branched off main)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260421194030_sql_settlement_function.sql` | CREATE | Schema change + linkage backfill + 5 SQL functions + trigger + cron + unschedule old |
| `src/components/MainApp.jsx` | MODIFY | Capture returned `ai_suggestions.id` on parlay-lock insert and pass it as `suggestion_id` on each `parlay_legs` row |

**No new tests** — verification is SQL-based (spot-check function outputs with known inputs, verify post-migration state). The repo's Jest suite in `__tests__/` isn't set up for SQL function testing, and adding that infra belongs in its own spec.

**Dead code flagged but NOT deleted this PR:**
- `services/parlay-tracker.js` (Knex-based; not in any active code path)
- `supabase/functions/check-outcomes/` and `supabase/functions/check-parlay-outcomes/` (edge function sources) — retire the CRONS in this PR, delete the source in a cleanup followup after 1 week of observed stability.

---

## Task 1: Write the migration file

Create a single SQL migration file that, in one transaction, does all DB-side work: schema change, linkage backfill, 5 function definitions, trigger installation, cron scheduling, and unscheduling of 4 old cron jobs.

**Files:**
- Create: `supabase/migrations/20260421194030_sql_settlement_function.sql`

- [ ] **Step 1: Create the migration file skeleton**

The full SQL for each section is **verbatim from the spec** at `docs/superpowers/specs/2026-04-21-sql-settlement-function-design.md`. Read that file and copy the SQL exactly — do not rewrite. The migration file is the concatenation of these sections, in order, with a file header:

```sql
-- supabase/migrations/20260421194030_sql_settlement_function.sql
-- SQL-side settlement pipeline. Replaces the Railway+Supabase-EdgeFn
-- multi-writer approach with a single Postgres trigger + coordinator function.
-- See: docs/superpowers/specs/2026-04-21-sql-settlement-function-design.md

-- ============================================================================
-- SECTION 1: Schema change — add suggestion_id FK to parlay_legs
-- ============================================================================

ALTER TABLE public.parlay_legs
  ADD COLUMN suggestion_id BIGINT REFERENCES public.ai_suggestions(id);

CREATE INDEX idx_parlay_legs_suggestion_id ON public.parlay_legs(suggestion_id);

-- ============================================================================
-- SECTION 2: Linkage backfill — populate suggestion_id for existing 113 legs
-- Match on (sport, home_team, away_team, pick, game_date::date).
-- Tiebreaker: earliest ai_suggestions.created_at.
-- Expected: all 113 legs get a suggestion_id (0 unique=70, 43 multi-matched).
-- ============================================================================

-- COPY the "Linkage backfill (runs once, during migration)" SQL block
-- from spec section under that heading — it's a WITH ... UPDATE statement.
-- ============================================================================
-- SECTION 3: determine_outcome() helper function
-- ============================================================================

-- COPY the full CREATE OR REPLACE FUNCTION determine_outcome(...) block
-- from spec section "The determine_outcome() function details".

-- ============================================================================
-- SECTION 4: settle_ai_suggestions()
-- ============================================================================

-- COPY from spec section "The settle_ai_suggestions() function".

-- ============================================================================
-- SECTION 5: settle_parlay_legs()
-- ============================================================================

-- COPY from spec section "The settle_parlay_legs() function".

-- ============================================================================
-- SECTION 6: settle_parlays()
-- ============================================================================

-- COPY from spec section "The settle_parlays() function" (note: this was
-- updated in self-review — profit_loss now uses flat $100 stake for loss
-- and `potential_payout - 100` for win).

-- ============================================================================
-- SECTION 7: run_settlement() coordinator
-- ============================================================================

-- COPY from spec section "The run_settlement() coordinator".

-- ============================================================================
-- SECTION 8: Grants
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.determine_outcome(TEXT, TEXT, NUMERIC, TEXT, TEXT, INT, INT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_ai_suggestions() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_parlay_legs() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_parlays() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_settlement() TO anon, authenticated, service_role;

-- ============================================================================
-- SECTION 9: Trigger on game_results
-- ============================================================================

CREATE TRIGGER trg_settle_on_game_results
  AFTER INSERT OR UPDATE ON public.game_results
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.run_settlement();

-- ============================================================================
-- SECTION 10: Daily safety-net cron
-- ============================================================================

SELECT cron.schedule(
  'settlement_daily_safety',
  '15 6 * * *',  -- 06:15 UTC, right after Railway backfill-game-results-daily at 05:00 UTC
  $$SELECT public.run_settlement();$$
);

-- ============================================================================
-- SECTION 11: Retire old settlement cron jobs
-- ============================================================================

SELECT cron.unschedule('check-outcomes-midnight');
SELECT cron.unschedule('check-outcomes-morning');
SELECT cron.unschedule('check-parlay-outcomes-30min-generous');
SELECT cron.unschedule('check-parlay-outcomes');
```

**Note on the `-- COPY from spec section ...` placeholders:** each of those must be replaced with the actual SQL block from the spec, verbatim. The spec contains ~200 lines of SQL total (spec lines 228-405). Read the spec, copy each block into its matching `SECTION` in the migration file.

- [ ] **Step 2: Verify file length matches expectations**

After pasting all sections, the final file should be roughly 250-300 lines.

```bash
wc -l supabase/migrations/20260421194030_sql_settlement_function.sql
```

Expected: between 250 and 320 lines.

- [ ] **Step 3: Sanity-check structure with grep**

```bash
grep -cE "^CREATE OR REPLACE FUNCTION|^CREATE TRIGGER|^SELECT cron\.(schedule|unschedule)|^ALTER TABLE|^CREATE INDEX|^GRANT EXECUTE" supabase/migrations/20260421194030_sql_settlement_function.sql
```

Expected count: **14** — broken down as:
- 5 `CREATE OR REPLACE FUNCTION` (determine_outcome, settle_ai_suggestions, settle_parlay_legs, settle_parlays, run_settlement)
- 1 `CREATE TRIGGER`
- 1 `SELECT cron.schedule` (daily safety)
- 4 `SELECT cron.unschedule` (retire old)
- 1 `ALTER TABLE`
- 1 `CREATE INDEX`
- (GRANT EXECUTE counts as 5, but grep-counted only if they're at line-start — may be 5 or 0 depending on indentation. If the total comes out as 19 instead of 14, that's GRANT EXECUTE lines also matching; both are acceptable.)

- [ ] **Step 4: Commit the migration file**

```bash
git add supabase/migrations/20260421194030_sql_settlement_function.sql
git commit -m "feat: SQL settlement function — migration file

Single migration introducing:
- parlay_legs.suggestion_id FK column + linkage backfill for 113 existing legs
- 5 SQL functions: determine_outcome, settle_ai_suggestions, settle_parlay_legs,
  settle_parlays, run_settlement
- Statement-level trigger on game_results firing run_settlement
- Daily safety-net pg_cron at 06:15 UTC
- Unschedule 4 obsolete cron jobs (2 Supabase EF schedules + 2 Railway-facing)"
```

---

## Task 2: Apply migration via Supabase MCP + verify DB state

Apply the migration to the live Supabase DB and verify every piece landed correctly. No code changes — this is a DB-only task using the `mcp__claude_ai_Supabase__apply_migration` tool.

**Files:** none modified; applying file created in Task 1.

- [ ] **Step 1: Apply the migration**

Use the MCP tool `mcp__claude_ai_Supabase__apply_migration` with:
- `project_id`: `pcjhulzyqmhrhsrgvwvx`
- `name`: `sql_settlement_function`
- `query`: the full SQL content of `supabase/migrations/20260421194030_sql_settlement_function.sql`

Expected: `{success: true}`. If it fails, the error message will indicate which statement broke. Supabase runs migrations in a transaction, so failure = no partial state.

- [ ] **Step 2: Verify schema change (suggestion_id column + index)**

Use MCP `execute_sql`:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='parlay_legs' AND column_name='suggestion_id';
```

Expected: one row: `suggestion_id | bigint | YES`.

```sql
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename='parlay_legs' AND indexname='idx_parlay_legs_suggestion_id';
```

Expected: one row.

- [ ] **Step 3: Verify linkage backfill populated all 113 legs**

```sql
SELECT
  COUNT(*) AS total_legs,
  COUNT(*) FILTER (WHERE suggestion_id IS NOT NULL) AS linked,
  COUNT(*) FILTER (WHERE suggestion_id IS NULL) AS unlinked
FROM public.parlay_legs;
```

Expected: `total_legs=113, linked=113, unlinked=0`. If any legs are unlinked, the backfill match logic has a bug or a leg slipped through — investigate before continuing.

- [ ] **Step 4: Verify all 5 functions exist**

```sql
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('determine_outcome','settle_ai_suggestions','settle_parlay_legs','settle_parlays','run_settlement')
ORDER BY proname;
```

Expected: 5 rows (one per function name above).

- [ ] **Step 5: Verify the trigger exists**

```sql
SELECT tgname, tgrelid::regclass AS table_name, tgenabled
FROM pg_trigger
WHERE tgname = 'trg_settle_on_game_results';
```

Expected: one row showing `trg_settle_on_game_results | public.game_results | O` (O = enabled by default).

- [ ] **Step 6: Verify new daily cron scheduled + old crons unscheduled**

```sql
SELECT jobname, schedule FROM cron.job
WHERE jobname IN (
  'settlement_daily_safety',
  'check-outcomes-midnight',
  'check-outcomes-morning',
  'check-parlay-outcomes-30min-generous',
  'check-parlay-outcomes'
);
```

Expected: exactly **one row**: `settlement_daily_safety | 15 6 * * *`. The other four should be gone.

---

## Task 3: Sanity-check `determine_outcome()` with known inputs

Run the helper function against hand-constructed cases for each bet type to confirm the win/loss/push logic matches expectations before letting it loose on real data.

**Files:** none modified.

- [ ] **Step 1: Moneyline test cases**

```sql
SELECT
  'ML home won, picked home' AS scenario,
  public.determine_outcome('Kansas Jayhawks', 'Moneyline', NULL, 'Kansas Jayhawks', 'Duke Blue Devils', 85, 78) AS result
UNION ALL
SELECT 'ML home won, picked away', public.determine_outcome('Duke Blue Devils', 'Moneyline', NULL, 'Kansas Jayhawks', 'Duke Blue Devils', 85, 78)
UNION ALL
SELECT 'ML tie', public.determine_outcome('Kansas Jayhawks', 'Moneyline', NULL, 'Kansas Jayhawks', 'Duke Blue Devils', 78, 78);
```

Expected: `'won'`, `'lost'`, `'push'`.

- [ ] **Step 2: Spread test cases**

```sql
SELECT
  'Spread: picked home -7.5, home wins by 10' AS scenario,
  public.determine_outcome('Kansas Jayhawks -7.5', 'Spread', -7.5, 'Kansas Jayhawks', 'Duke Blue Devils', 85, 75) AS result
UNION ALL
SELECT 'Spread: picked home -7.5, home wins by 5 (loses spread)',
  public.determine_outcome('Kansas Jayhawks -7.5', 'Spread', -7.5, 'Kansas Jayhawks', 'Duke Blue Devils', 80, 75)
UNION ALL
SELECT 'Spread: picked away +7.5, away loses by 7 (covers)',
  public.determine_outcome('Duke Blue Devils +7.5', 'Spread', 7.5, 'Kansas Jayhawks', 'Duke Blue Devils', 80, 73)
UNION ALL
SELECT 'Spread: push on exact line',
  public.determine_outcome('Kansas Jayhawks -7', 'Spread', -7, 'Kansas Jayhawks', 'Duke Blue Devils', 80, 73);
```

Expected: `'won'`, `'lost'`, `'won'`, `'push'`.

- [ ] **Step 3: Total test cases**

```sql
SELECT
  'Total: picked over 150, actual 160' AS scenario,
  public.determine_outcome('Over 150', 'Total', 150, 'Kansas Jayhawks', 'Duke Blue Devils', 85, 75) AS result
UNION ALL
SELECT 'Total: picked under 150, actual 160',
  public.determine_outcome('Under 150', 'Total', 150, 'Kansas Jayhawks', 'Duke Blue Devils', 85, 75)
UNION ALL
SELECT 'Total: push on exact',
  public.determine_outcome('Over 155', 'Total', 155, 'Kansas Jayhawks', 'Duke Blue Devils', 80, 75);
```

Expected: `'won'`, `'lost'`, `'push'`.

- [ ] **Step 4: Puck Line test case (reuses Spread logic)**

```sql
SELECT public.determine_outcome('Rangers -1.5', 'Puck Line', -1.5, 'New York Rangers', 'Boston Bruins', 4, 2) AS result;
```

Expected: `'won'` (Rangers won by 2, covers -1.5).

- [ ] **Step 5: Null score guard**

```sql
SELECT public.determine_outcome('Kansas', 'Moneyline', NULL, 'Kansas', 'Duke', NULL, 78) AS result;
```

Expected: `'pending'`.

If any of these return the wrong value, the SQL logic has a bug. Fix in a follow-up commit to Task 1's migration file (append an amending migration — do NOT edit the already-applied file). Report as `BLOCKED` and flag the discrepancy before moving on.

---

## Task 4: Run retroactive settlement + verify backlog cleared

The deploy-time call that settles everything eligible in one shot. This is where we see the visible payoff of the entire spec.

**Files:** none modified.

- [ ] **Step 1: Capture pre-settlement baseline**

```sql
SELECT
  COUNT(*) FILTER (WHERE actual_outcome = 'pending' AND game_date < NOW() - INTERVAL '24 hours') AS stale_pending_suggestions,
  (SELECT COUNT(*) FROM parlay_legs WHERE outcome IN ('won','lost','push') AND (game_completed IS NOT TRUE OR leg_result IS NULL)) AS half_settled_legs,
  (SELECT COUNT(*) FROM parlays WHERE status = 'pending') AS pending_parlays
FROM ai_suggestions;
```

Expected baseline approximately: `stale_pending_suggestions ~400, half_settled_legs ~113, pending_parlays ~5-7`. Record the exact numbers — you'll compare to post-settlement.

- [ ] **Step 2: Run retroactive settlement**

```sql
SELECT * FROM public.run_settlement();
```

Expected: one row with non-zero values in all three columns. Example: `(suggestions_settled=120, legs_settled=113, parlays_settled=3)`. The exact numbers depend on current data state but `legs_settled` should be ≈113 (the count of linked-but-half-settled legs) and `suggestions_settled` should be in the hundreds.

- [ ] **Step 3: Verify stale pending suggestions decreased**

```sql
SELECT
  sport,
  COUNT(*) FILTER (WHERE actual_outcome = 'pending' AND game_date < NOW() - INTERVAL '24 hours') AS still_stale_pending
FROM ai_suggestions
GROUP BY sport
ORDER BY still_stale_pending DESC;
```

Expected: NBA / NHL / MLB / NCAAB stale_pending counts approximately 0 (their game_results are populated). EPL / UFC / Tennis still have high pending counts — those are **expected to remain pending** until Spec 2 fixes the ESPN backfill coverage.

- [ ] **Step 4: Verify parlay_legs state columns fully consistent**

```sql
SELECT COUNT(*) AS inconsistent_legs
FROM parlay_legs
WHERE suggestion_id IS NOT NULL
  AND outcome IS NOT NULL
  AND (game_completed IS NOT TRUE OR leg_result IS NULL OR resolved_at IS NULL);
```

Expected: 0. Every leg with an outcome now has all state columns populated.

- [ ] **Step 5: Verify parlays rolled up correctly**

```sql
SELECT
  p.id, p.status, p.final_outcome,
  COUNT(pl.id) AS total_legs,
  COUNT(pl.id) FILTER (WHERE pl.outcome = 'won') AS legs_won,
  COUNT(pl.id) FILTER (WHERE pl.outcome = 'lost') AS legs_lost,
  COUNT(pl.id) FILTER (WHERE pl.outcome IN ('pending',NULL) OR pl.outcome IS NULL) AS legs_pending
FROM parlays p
LEFT JOIN parlay_legs pl ON pl.parlay_id = p.id
GROUP BY p.id, p.status, p.final_outcome
ORDER BY p.id;
```

Manual sanity check: any parlay with `legs_lost >= 1` should have `status='completed', final_outcome='lost'`. Any parlay where all non-push legs are `won` and zero pending should be `status='completed', final_outcome='won'`. Parlays with pending legs and zero lost should remain `status='pending'`.

- [ ] **Step 6: Verify run_settlement logged to cron_job_logs**

```sql
SELECT job_name, status, created_at, LEFT(details::text, 200) AS details
FROM cron_job_logs
WHERE job_name = 'run_settlement'
ORDER BY created_at DESC LIMIT 3;
```

Expected: at least one entry with details showing the counts that matched Step 2's output.

---

## Task 5: Update MainApp.jsx parlay-lock flow to write `suggestion_id`

The ai_suggestions and parlay_legs inserts are triggered from the same `selectedPicks` array in MainApp.jsx, in order. Capture the returned `ai_suggestions.id` values and pass them as `suggestion_id` on the corresponding legs. Simple 1:1 index match.

**Files:**
- Modify: `src/components/MainApp.jsx` (parlay-lock flow starting around line 719)

- [ ] **Step 1: Modify the ai_suggestions insert to return IDs**

Locate the ai_suggestions insert around [line 740-742](src/components/MainApp.jsx#L740-L742):

```js
const { error: picksError } = await supabase
  .from('ai_suggestions')
  .insert(picksToInsert)
```

Replace with:

```js
const { data: insertedSuggestions, error: picksError } = await supabase
  .from('ai_suggestions')
  .insert(picksToInsert)
  .select('id')
```

- [ ] **Step 2: Build legsToInsert with suggestion_id**

Locate the `legsToInsert = selectedPicks.map(...)` block around [line 750-771](src/components/MainApp.jsx#L750-L771). Update the map callback to include `suggestion_id`:

```js
const legsToInsert = selectedPicks.map((pick, index) => ({
  parlay_id: parlayData.id,
  suggestion_id: insertedSuggestions?.[index]?.id ?? null,  // linkage for settlement propagation
  leg_number: index + 1,
  game_date: pick.gameDate ? pick.gameDate.split('T')[0] : new Date().toISOString().split('T')[0],
  sport: pick.sport,
  home_team: pick.homeTeam,
  away_team: pick.awayTeam,
  bet_type: pick.betType,
  bet_details: {
    pick: pick.pick,
    point: pick.point,
    spread: pick.spread,
    locked_odds: pick.odds,
    locked_at: new Date().toISOString()
  },
  odds: String(pick.odds),
  confidence: pick.confidence ? Math.round(pick.confidence) : 7,
  reasoning: pick.reasoning || '',
  pick_description: `${pick.betType}: ${pick.pick}`,
  pick: pick.pick,
  outcome: 'pending'
}))
```

Only one line changed: added `suggestion_id: insertedSuggestions?.[index]?.id ?? null,` after `parlay_id`. The `?? null` fallback means if ai_suggestions insert failed silently and returned no data, the leg still writes — just without the linkage. Settlement will still work via trigger when game_results arrive, it just won't have the propagation shortcut.

- [ ] **Step 3: Handle the picksError case more carefully**

The existing code at [line 744-747](src/components/MainApp.jsx#L744-L747) logs picksError but doesn't abort. Under the new flow, `insertedSuggestions` will be `null` if `picksError` is set, which means `legsToInsert` will have `suggestion_id: null` for every leg. That's graceful degradation — legs still insert, just without linkage. No change needed here; the `?? null` handles it.

- [ ] **Step 4: Sanity check with grep**

```bash
grep -n "suggestion_id\|insertedSuggestions\|\.select('id')" src/components/MainApp.jsx
```

Expected:
- `insertedSuggestions` appears in 2 places (capture + use)
- `suggestion_id` appears exactly once (in the map)
- `.select('id')` appears exactly once (after the ai_suggestions insert)

- [ ] **Step 5: Lint / build check**

The existing `npm run build` is broken due to a pre-existing Node 18 / Vite ESM issue (documented during the model-accuracy-rollup session). Don't try to fix that. Just confirm no obvious JSX breakage by reading the diff:

```bash
git diff src/components/MainApp.jsx
```

Changes should be small: addition of `.select('id')` and destructuring of `data: insertedSuggestions`, plus one new line in the `legsToInsert` map.

- [ ] **Step 6: Commit**

```bash
git add src/components/MainApp.jsx
git commit -m "feat: Write suggestion_id on new parlay_legs for settlement propagation

When a user locks picks into a parlay, the flow already inserts parallel
ai_suggestions and parlay_legs rows from the same selectedPicks array.
Capture the returned suggestion IDs and set parlay_legs.suggestion_id so
the new SQL settlement pipeline can propagate outcomes leg<-suggestion
instead of doing a second game_results match."
```

---

## Task 6: Push branch + open PR

**Files:** none modified; git operations only.

- [ ] **Step 1: Verify branch state**

```bash
git log --oneline main..HEAD
git status --short
```

Expected:
- Three commits on branch: the spec commit (`af53ac0`), the migration file (Task 1), the MainApp.jsx change (Task 5).
- `git status` should show `api/digest.js` as modified (pre-existing WIP from main, not ours) and nothing else. Do NOT stage or commit `api/digest.js`.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feature/sql-settlement-function
```

Expected: new branch registered on remote.

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "SQL settlement function — atomic settle via Postgres trigger" --body "$(cat <<'EOF'
## Summary

Replaces the multi-writer settlement pipeline (Railway \`ParlayOutcomeChecker\` + Supabase edge functions \`check-outcomes\` and \`check-parlay-outcomes\`) with a single Postgres-side pipeline: five SQL functions triggered by \`game_results\` inserts, plus a daily safety-net \`pg_cron\`.

**Key architectural call:** \`parlay_legs\` settlement becomes pure propagation from \`ai_suggestions\` via a new \`suggestion_id\` FK, eliminating duplicate bet-type logic.

## What's in this PR

- New migration \`supabase/migrations/20260421194030_sql_settlement_function.sql\` — applied to production during implementation (verified in Task 2 steps)
- \`src/components/MainApp.jsx\` — parlay-lock flow now captures returned \`ai_suggestions.id\` values and sets \`parlay_legs.suggestion_id\` for each new leg
- Orphan-leg cleanup (11 legs + 1 dangling parlay) was executed earlier via SQL; not part of this PR code, but a prerequisite for the linkage backfill to reach 100%

## Scope boundary

**In scope:** settlement of any pick whose game appears in \`game_results\`. **Out of scope:** ESPN backfill coverage for UFC (MMA parser), EPL (\`soccer/eng.1\`), Tennis (no ESPN source). Those are Spec 2 — see [docs/superpowers/specs/2026-04-21-sql-settlement-function-design.md](docs/superpowers/specs/2026-04-21-sql-settlement-function-design.md) "Non-goals".

## Retroactive settlement results (from Task 4 verification)

Filled in during implementation by the engineer running the plan.

## Test plan

- [x] MV \`parlay_legs.suggestion_id\` column added; 113/113 legs linked
- [x] All 5 SQL functions exist and callable
- [x] Trigger \`trg_settle_on_game_results\` enabled on \`game_results\`
- [x] New cron \`settlement_daily_safety\` scheduled; 4 old crons unscheduled
- [x] \`determine_outcome()\` passes Moneyline / Spread / Total / Puck Line / push / null-score test cases
- [x] Retroactive \`run_settlement()\` drops stale pending backlog (NBA/NHL/MLB/NCAAB)
- [x] \`parlay_legs\` no longer has any rows with \`outcome\` set but \`game_completed\` / \`leg_result\` / \`resolved_at\` null
- [x] Parlays with a lost leg correctly marked completed+lost
- [x] \`MainApp.jsx\` writes \`suggestion_id\` on new legs (verified by grep, will need a live parlay-lock to confirm end-to-end)

## Rollback

See the "Rollback" section in the design spec. Four-line cleanup if anything goes sideways; source data untouched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

The `[x]` checkboxes in the body assume Tasks 2-4 passed cleanly. If any verification step reported BLOCKED, change the corresponding checkbox to `[ ]` and note the issue.

- [ ] **Step 4: Capture the PR URL**

```bash
gh pr view --json url,number
```

Return the URL in the final status report.

---

## Out of scope for this plan (queued follow-ups)

These are deliberately excluded — do not attempt in this PR:

1. **Spec 2 — ESPN backfill coverage.** Fix UFC MMA parser in Railway cron; add EPL (`soccer/eng.1`) to Railway backfill; research Tennis data source.
2. **Player Props settlement.** 79 picks require `player_game_stats` lookup. Own followup spec.
3. **Delete dead edge function source files** (`supabase/functions/check-outcomes/`, `supabase/functions/check-parlay-outcomes/`) after 1 week of observed stability.
4. **Retire `lib/services/parlay-outcome-checker.js` + `ai-suggestion-outcome-checker.js`.** Node files become dead once the new pipeline is stable. Delete in a cleanup PR.
5. **`services/parlay-tracker.js`.** Knex-based, already appears unused. Confirm dead with a runtime trace, then delete.
