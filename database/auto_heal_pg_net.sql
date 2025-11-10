-- AUTO-HEALING PG_NET EXTENSION
-- This function checks and enables pg_net if missing
-- Can be called from cron jobs as a safety check

CREATE OR REPLACE FUNCTION ensure_pg_net_enabled()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    ext_exists BOOLEAN;
    result TEXT;
BEGIN
    -- Check if pg_net extension exists
    SELECT EXISTS (
        SELECT 1 FROM pg_extension 
        WHERE extname = 'pg_net'
    ) INTO ext_exists;
    
    IF ext_exists THEN
        result := 'pg_net already enabled';
    ELSE
        -- Enable pg_net extension
        EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
        result := 'pg_net enabled successfully';
    END IF;
    
    RETURN result;
EXCEPTION
    WHEN OTHERS THEN
        RETURN 'ERROR enabling pg_net: ' || SQLERRM;
END;
$$;

-- Test the function
SELECT ensure_pg_net_enabled();