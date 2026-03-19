-- Clear AI suggestions cache to force fresh generation with research
DELETE FROM ai_suggestions_cache;

-- Verify it's empty
SELECT COUNT(*) as remaining_entries FROM ai_suggestions_cache;
