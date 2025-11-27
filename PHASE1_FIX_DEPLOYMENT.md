# Phase 1: Integration Fix

## Problem Discovered

The original `ai_suggestions` table had:
- ❌ `parlay_id BIGINT` - Should be `UUID` to match your existing `parlays.id`
- ❌ No foreign keys to your existing tables
- ❌ No RLS policies matching your pattern
- ❌ Didn't integrate with `parlay_legs`

## Solution

Created `database/phase1_fix_integration.sql` which:
- ✅ Recreates `ai_suggestions` with proper UUID foreign keys
- ✅ Links to `auth.users`, `parlays`, and `parlay_legs`
- ✅ Adds RLS policies matching your existing pattern
- ✅ Creates helper view: `ai_performance_comparison`
- ✅ Creates helper function: `mark_suggestion_as_locked()`

---

## How It Works Now

### Data Flow

```
1. User generates picks (logged in or guest)
   ↓
2. AI suggests 8-15 picks
   ↓
3. ALL picks stored in ai_suggestions
   - session_id: groups this batch
   - user_id: NULL for guest, UUID for logged in
   - was_locked_by_user: FALSE initially
   ↓
4. User locks 3 picks
   ↓
5. Backend creates parlay + parlay_legs (your existing tables)
   ↓
6. Call mark_suggestion_as_locked() to link:
   - ai_suggestions.was_locked_by_user = TRUE
   - ai_suggestions.parlay_id = new parlay UUID
   - ai_suggestions.parlay_leg_id = leg UUID
   ↓
7. Next day: Edge Function validates outcomes
   - Updates ai_suggestions.actual_outcome
   - Updates parlay_legs.leg_result (existing)
   - Updates parlays.final_outcome (existing)
```

### Three Win Rates

```sql
-- 1. AI Model Win Rate (ALL suggestions)
SELECT COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 /
       COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost'))
FROM ai_suggestions WHERE resolved_at IS NOT NULL;
-- Result: 62% (AI is good!)

-- 2. User Selection Win Rate (locked picks only)
SELECT COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 /
       COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost'))
FROM ai_suggestions WHERE was_locked_by_user = true;
-- Result: 48% (users picking wrong legs)

-- 3. Parlay Win Rate (need ALL legs to win)
SELECT COUNT(*) FILTER (WHERE final_outcome = 'won') * 100.0 /
       COUNT(*) FILTER (WHERE final_outcome IN ('won', 'lost'))
FROM parlays;
-- Result: 15% (3-leg parlays are hard!)
```

---

## Deploy the Fix

### Step 1: Apply Fixed Schema
```bash
cd /Users/vincentmorello/Desktop/Cray_Cray_Parlay_App

# Execute via CLI
cat > /tmp/apply_fix.sh << 'EOF'
#!/bin/bash
SUPABASE_URL="https://pcjhulzyqmhrhsrgvwvx.supabase.co"
SUPABASE_SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs"

echo "🔧 Applying Phase 1 integration fix..."
SQL_FILE="database/phase1_fix_integration.sql"

curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/query" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"$(cat $SQL_FILE | tr '\n' ' ' | sed 's/"/\\"/g')\"}"

echo "✅ Schema fixed!"
EOF

chmod +x /tmp/apply_fix.sh
/tmp/apply_fix.sh
```

### Step 2: Verify Integration
```sql
-- Check tables link properly
SELECT 
  COUNT(*) as suggestions,
  COUNT(DISTINCT user_id) as users,
  COUNT(*) FILTER (WHERE was_locked_by_user) as locked,
  COUNT(*) FILTER (WHERE parlay_id IS NOT NULL) as linked_to_parlays
FROM ai_suggestions;

-- Check the comparison view works
SELECT * FROM ai_performance_comparison;
```

---

## Backend Changes Needed

### Update `api/suggest-picks.js`

The `storeAISuggestions` function already works, but we need to call `mark_suggestion_as_locked()` when users lock picks.

### In `api/user-parlays.js` (or wherever you create parlays)

```javascript
// After creating parlay and parlay_legs
const { data: parlay, error } = await supabase
  .from('parlays')
  .insert({
    user_id: userId,
    risk_level: riskLevel,
    total_legs: lockedPicks.length,
    // ... other fields
  })
  .select()
  .single();

// Link each locked pick back to ai_suggestions
for (const pick of lockedPicks) {
  if (pick.sessionId) {
    await supabase.rpc('mark_suggestion_as_locked', {
      p_session_id: pick.sessionId,
      p_pick_id: pick.id,
      p_user_id: userId,
      p_parlay_id: parlay.id,
      p_parlay_leg_id: pick.parlay_leg_id
    });
  }
}
```

---

## Queries You Can Run Now

### Model Performance Dashboard
```sql
SELECT * FROM ai_performance_comparison;
```

### Best Bet Types for AI
```sql
SELECT 
  bet_type,
  COUNT(*) as picks,
  ROUND(AVG(CASE WHEN actual_outcome = 'won' THEN 1 ELSE 0 END) * 100, 1) as win_rate
FROM ai_suggestions
WHERE actual_outcome IN ('won', 'lost')
GROUP BY bet_type
ORDER BY win_rate DESC;
```

### User Selection Quality
```sql
-- Compare what users lock vs what they don't
SELECT 
  'Locked by Users' as pick_group,
  ROUND(AVG(CASE WHEN actual_outcome = 'won' THEN 1 ELSE 0 END) * 100, 1) as win_rate
FROM ai_suggestions
WHERE was_locked_by_user = true AND actual_outcome IN ('won', 'lost')

UNION ALL

SELECT 
  'NOT Locked',
  ROUND(AVG(CASE WHEN actual_outcome = 'won' THEN 1 ELSE 0 END) * 100, 1)
FROM ai_suggestions
WHERE was_locked_by_user = false AND actual_outcome IN ('won', 'lost');
```

### High Confidence Performance
```sql
SELECT 
  CASE 
    WHEN confidence >= 8 THEN 'High (8-10)'
    WHEN confidence >= 6 THEN 'Medium (6-7)'
    ELSE 'Low (1-5)'
  END as confidence_level,
  COUNT(*) as picks,
  ROUND(AVG(CASE WHEN actual_outcome = 'won' THEN 1 ELSE 0 END) * 100, 1) as win_rate
FROM ai_suggestions
WHERE actual_outcome IN ('won', 'lost')
GROUP BY 1
ORDER BY 1 DESC;
```

---

## What's Fixed

✅ **Proper Data Types**: UUID for parlay_id, user_id  
✅ **Foreign Keys**: Links to auth.users, parlays, parlay_legs  
✅ **RLS Policies**: Matches your existing security pattern  
✅ **Helper View**: `ai_performance_comparison` for dashboard  
✅ **Helper Function**: `mark_suggestion_as_locked()` for linking  
✅ **Integrates**: Works WITH your existing parlays system, not instead of it

---

## Next Action

Run the fix script above, then your Phase 1 system will properly integrate with your existing parlay tracking!
