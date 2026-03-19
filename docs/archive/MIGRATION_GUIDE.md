# Parlay Data Migration & Performance Tracking

## Overview

This migration moves old parlay picks from JSON metadata into the `ai_suggestions` table, enabling:
- ✅ Automatic settlement of old parlays
- ✅ Model performance tracking
- ✅ User selection analysis
- ✅ Win rate calculations

---

## Step 1: Run the Migration

```bash
cd /Users/vincentmorello/Desktop/Cray_Cray_Parlay_App
node scripts/migrate-old-parlays.js
```

**What it does:**
- Finds all parlays with `metadata.locked_picks`
- Converts picks to `ai_suggestions` table format
- Links picks to parlays via `parlay_id`
- Marks picks as `was_locked_by_user = true`
- Preserves existing outcomes if already settled

**Expected output:**
```
✅ Migrated: 20 parlays
⏭️  Skipped: 0 parlays (already migrated or no picks)
❌ Errors: 0 parlays
```

---

## Step 2: Analyze Performance

After migration, run these queries in Supabase SQL Editor:

### Quick Summary
```sql
SELECT * FROM performance_summary;
```

Returns:
- `model_win_rate`: AI accuracy across ALL suggestions
- `user_pick_win_rate`: Win rate of picks users actually locked
- `parlay_win_rate`: Complete parlay success rate

### Detailed Analysis

Run individual queries from `scripts/analyze-performance.sql`:

1. **Model Performance**: How accurate is the AI?
2. **User Selection**: Do users pick good suggestions?
3. **Parlay Performance**: How often do full parlays hit?
4. **Performance by Bet Type**: Which types win most?
5. **Confidence Correlation**: Does high confidence = higher win rate?
6. **Profit/Loss**: Hypothetical P&L analysis

---

## Step 3: Enable Auto-Settlement

### Option A: Railway Backend (Recommended)
Call from external cron service:

```bash
# Every hour
curl -X POST https://craycrayparlayapp-production.up.railway.app/api/check-parlays
```

### Option B: Supabase Edge Function
```sql
-- Set up hourly cron
SELECT cron.schedule(
  'check-parlay-outcomes',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url:='https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/check-parlay-outcomes',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    )
  );
  $$
);
```

---

## Understanding the Data Structure

### Before Migration:
```
parlays table:
├─ id: abc-123
├─ metadata: {
│   locked_picks: [
│     { pick: "Ravens -6.5", odds: "-110", ... }
│   ]
└─ }

ai_suggestions table:
└─ (empty for old parlays)
```

### After Migration:
```
parlays table:
├─ id: abc-123
├─ metadata: { locked_picks: [...] }  ← Still here for Dashboard
└─ final_outcome: pending

ai_suggestions table:
├─ id: 1
├─ parlay_id: abc-123  ← Links to parlay
├─ pick: "Ravens -6.5"
├─ actual_outcome: pending
├─ was_locked_by_user: true
└─ ... (all pick details as columns)
```

**Benefits:**
- Dashboard still works (reads metadata)
- Settlement works (queries ai_suggestions)
- Performance tracking works (analyzes ai_suggestions)

---

## Key Metrics to Track

### Model Success Rate
```sql
-- All AI suggestions, whether user locked them or not
SELECT 
  COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
  COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost'))
FROM ai_suggestions;
```

### User Selection Accuracy
```sql
-- Only picks users actually locked
SELECT 
  COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
  COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost'))
FROM ai_suggestions
WHERE was_locked_by_user = true;
```

### Parlay Hit Rate
```sql
-- Complete parlays (all legs must win)
SELECT 
  COUNT(*) FILTER (WHERE final_outcome = 'won') * 100.0 / 
  COUNT(*) FILTER (WHERE final_outcome IN ('won', 'lost'))
FROM parlays;
```

---

## Troubleshooting

### Migration shows 0 parlays migrated
```bash
# Check if parlays have metadata
node scripts/check-parlay-picks.js
```

### Settlement not working
```bash
# Manual trigger
curl -X POST https://craycrayparlayapp-production.up.railway.app/api/check-parlays

# Check logs
railway logs --service backend
```

### Performance queries return NULL
- Wait for games to complete (4+ hours after game time)
- Run settlement manually to update outcomes
- Check that `actual_outcome` is set on ai_suggestions

---

## Next Steps

1. **Run migration** ✅
2. **View performance** ✅
3. **Set up auto-settlement cron** ⏳
4. **Display stats in Dashboard UI** (coming soon)

The `performance_summary` view is ready to be queried from your frontend to show model accuracy vs user selection accuracy!
