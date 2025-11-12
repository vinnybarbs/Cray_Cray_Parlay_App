-- Fix for refresh-odds-fast function - UUID id column issue
-- The problem: id column is UUID, not integer, so "id >= 1" fails
-- Solution: Use TRUNCATE or DELETE without WHERE clause

-- Test the current table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'odds_cache' 
    AND table_schema = 'public'
ORDER BY ordinal_position;

-- Test solutions:

-- Option 1: Simple DELETE all (what the function should use)
DELETE FROM odds_cache;

-- Option 2: TRUNCATE (faster but requires more permissions)
-- TRUNCATE odds_cache;

-- Check if it worked
SELECT COUNT(*) as remaining_records FROM odds_cache;

-- The refresh-odds-fast function needs to be updated to use:
-- DELETE FROM odds_cache;  -- instead of WHERE id >= 1