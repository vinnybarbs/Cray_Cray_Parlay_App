-- =============================================================================
-- DATABASE FUNCTION FOR DASHBOARD STATUS
-- =============================================================================
-- Run this in Supabase SQL Editor to create the function our dashboard uses

CREATE OR REPLACE FUNCTION get_recent_job_runs()
RETURNS TABLE (
    automation_job text,
    when_it_ran timestamp,
    result text,
    how_recent text,
    what_happened text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        j.jobname::text as automation_job,
        r.start_time as when_it_ran,
        CASE 
            WHEN r.status = 'succeeded' THEN '✅ Success'
            WHEN r.status = 'failed' THEN '❌ Failed'
            ELSE '⏳ ' || r.status
        END::text as result,
        CASE
            WHEN r.start_time > NOW() - INTERVAL '1 hour' THEN 'Just ran'
            WHEN r.start_time > NOW() - INTERVAL '6 hours' THEN 'Recent'
            ELSE 'Old run'
        END::text as how_recent,
        LEFT(r.return_message, 200)::text as what_happened
    FROM cron.job_run_details r
    JOIN cron.job j ON r.jobid = j.jobid
    WHERE r.start_time > NOW() - INTERVAL '24 hours'
    ORDER BY r.start_time DESC 
    LIMIT 15;
END;
$$;