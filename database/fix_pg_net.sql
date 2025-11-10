-- CRITICAL FIX: Enable pg_net extension for Edge Functions
-- Run this in Supabase SQL Editor to fix all failing cron jobs

-- Enable the pg_net extension (required for Edge Functions to make HTTP calls)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Verify it's enabled
SELECT extname, extversion 
FROM pg_extension 
WHERE extname = 'pg_net';