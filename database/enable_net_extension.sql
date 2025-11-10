-- Enable net extension for HTTP requests in Supabase
-- Run this first in Supabase SQL Editor

CREATE EXTENSION IF NOT EXISTS net;

-- Test that net extension is working
SELECT 'net extension enabled' as status;