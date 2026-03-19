# Database Migration Guide

## Issue: Missing bet_amount Column

**Error**: `Failed to save parlay: Could not find the 'bet_amount' column of 'parlays' in the schema cache`

## Quick Fix Applied ✅

The app now works immediately - the `bet_amount` field has been temporarily removed from parlay insertion so you can test all the fixes:
- ✅ Expandable reasoning works for all sports
- ✅ Date filtering excludes past games  
- ✅ Parlay saving works without errors

## Full Fix: Database Migration

To enable full unit size tracking, apply this migration in your Supabase dashboard:

### Step 1: Open Supabase SQL Editor

1. Go to your Supabase dashboard
2. Navigate to **SQL Editor**
3. Create a new query

### Step 2: Run the Migration

Copy and paste this SQL:

```sql
-- Add bet_amount column to parlays table to track unit size
ALTER TABLE parlays ADD COLUMN IF NOT EXISTS bet_amount DECIMAL(10,2) DEFAULT 100.00;

-- Update existing parlays to have default bet amount of $100 
UPDATE parlays SET bet_amount = 100.00 WHERE bet_amount IS NULL;

-- Make the column NOT NULL with a default
ALTER TABLE parlays ALTER COLUMN bet_amount SET DEFAULT 100.00;
ALTER TABLE parlays ALTER COLUMN bet_amount SET NOT NULL;
```

### Step 3: Re-enable bet_amount in Code

After running the migration, uncomment this line in `src/components/MainApp.jsx` (around line 438):

```javascript
// Change this:
// bet_amount: unitSize, // TODO: Add this after running database migration

// To this:
bet_amount: unitSize,
```

### Step 4: Test Full Functionality

1. Refresh your app
2. Generate suggestions 
3. Add picks to parlay
4. Click "🔒 Lock Build"
5. Check your dashboard - unit sizes should be properly tracked

## Alternative: Use Existing Schema

If you don't want to modify the database, the app works perfectly without the migration. The unit size selector still functions in the UI, but won't be stored in the database permanently.

## Files Involved

- ✅ **Migration**: `database/add_bet_amount_column.sql`  
- ✅ **Frontend**: `src/components/MainApp.jsx` (quick fix applied)
- ✅ **Dashboard**: `src/components/Dashboard.jsx` (has fallback)