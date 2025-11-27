# Apply Phase 1 Integration Fix

## Quick Fix (2 minutes)

### Option 1: Supabase SQL Editor (Recommended)

1. Go to: https://supabase.com/dashboard/project/pcjhulzyqmhrhsrgvwvx/sql/new
2. Copy/paste contents of: `database/phase1_fix_integration.sql`
3. Click **"Run"**
4. ✅ Done!

### Option 2: CLI

```bash
cd /Users/vincentmorello/Desktop/Cray_Cray_Parlay_App

# Using psql (if you have connection string)
psql "$SUPABASE_DB_URL" -f database/phase1_fix_integration.sql

# Or using Supabase CLI migration
npx supabase migration new phase1_integration_fix
# Copy contents of phase1_fix_integration.sql into the migration file
npx supabase db push
```

---

## What This Fixes

### Before (Broken)
```sql
CREATE TABLE ai_suggestions (
  user_id UUID,              -- ❌ No foreign key
  parlay_id BIGINT,          -- ❌ Wrong type! Should be UUID
  ...
);
```

### After (Fixed)
```sql
CREATE TABLE ai_suggestions (
  user_id UUID REFERENCES auth.users(id),     -- ✅ Proper FK
  parlay_id UUID REFERENCES parlays(id),      -- ✅ Correct UUID type!
  parlay_leg_id UUID REFERENCES parlay_legs(id), -- ✅ Link to specific leg
  was_locked_by_user BOOLEAN,                 -- ✅ Track what users chose
  ...
);
```

---

## Verify It Worked

After running the SQL, check:

```sql
-- 1. Check table structure
\d ai_suggestions

-- 2. Check foreign keys exist
SELECT 
  conname as constraint_name,
  conrelid::regclass as table_name,
  confrelid::regclass as foreign_table
FROM pg_constraint
WHERE conrelid = 'ai_suggestions'::regclass
  AND contype = 'f';

-- Expected output:
-- ai_suggestions_user_id_fkey | ai_suggestions | users
-- ai_suggestions_parlay_id_fkey | ai_suggestions | parlays
-- ai_suggestions_parlay_leg_id_fkey | ai_suggestions | parlay_legs

-- 3. Test the helper view
SELECT * FROM ai_performance_comparison;

-- 4. Test storing a suggestion
INSERT INTO ai_suggestions (
  session_id, sport, home_team, away_team, game_date,
  bet_type, pick, odds, confidence, risk_level, generate_mode
) VALUES (
  'test_session_123',
  'NFL',
  'Chiefs',
  'Bills',
  NOW() + INTERVAL '1 day',
  'Moneyline',
  'Chiefs',
  '-150',
  8,
  'Medium',
  'test'
);

-- Should succeed! If it does, delete test:
DELETE FROM ai_suggestions WHERE session_id = 'test_session_123';
```

---

## Then Test With Real Suggestions

```bash
# Generate picks (should store in ai_suggestions now)
curl -X POST "https://craycrayparlayapp-production.up.railway.app/api/suggest-picks" \
  -H "Content-Type: application/json" \
  -d '{"sports": ["NFL"], "riskLevel": "Medium", "numLegs": 3}'

# Check they were stored
SELECT * FROM ai_suggestions ORDER BY created_at DESC LIMIT 5;
```

---

## Integration Complete! ✅

Now your Phase 1 system properly integrates with your existing:
- ✅ `parlays` table
- ✅ `parlay_legs` table  
- ✅ RLS security policies
- ✅ User authentication

**Run the SQL file and you're good to go!**
