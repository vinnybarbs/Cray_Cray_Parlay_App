# Supabase Edge Function Troubleshooting Guide

## The Problem: Functions Timing Out

If your Edge Functions are deployed but timing out when called via curl or HTTP:

```bash
$ curl -X POST "https://xxx.supabase.co/functions/v1/my-function" -H "Authorization: Bearer ..."
# Hangs for 60+ seconds, then times out
```

## Root Causes & Solutions

### 1. ❌ Wrong Export Pattern

**Problem:** Using `export default function handler()` instead of `serve()`

```ts
// ❌ DOESN'T WORK in Supabase
export default async function handler(req: Request) {
  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

**Solution:** Use `serve()` from Deno standard library

```ts
// ✅ WORKS in Supabase
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async (req: Request) => {
  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
});
```

### 2. ⏱️ Long-Running Synchronous Operations

**Problem:** Edge Functions have ~150-200 second timeout limits. If your function does heavy work before returning, it will timeout.

**Symptoms:**
- Function works locally but times out in production
- Doing multiple API calls, database operations, or RSS parsing synchronously
- Waiting for all work to complete before returning HTTP response

**Solution:** Return immediately, process in background

```ts
// ✅ Return 202 Accepted immediately, process async
serve(async (req: Request) => {
  // Return immediately
  const response = new Response(
    JSON.stringify({ 
      status: 'accepted', 
      message: 'Processing started in background',
      timestamp: new Date().toISOString()
    }),
    { status: 202, headers: { 'Content-Type': 'application/json' } }
  );
  
  // Process in background (fire and forget)
  processHeavyWork().catch(err => {
    console.error('Background job failed:', err);
  });
  
  return response;
});

async function processHeavyWork() {
  // Do your heavy lifting here
  // Fetch APIs, parse data, write to DB, etc.
  console.log('Background work started');
  // ... long running operations ...
  console.log('Background work complete');
}
```

Reference: [Supabase Blog - Processing Large Jobs with Edge Functions](https://supabase.com/blog/processing-large-jobs-with-edge-functions)

### 3. 🔒 Database Permissions for Cron Jobs

**Problem:** Trying to set database parameters fails with permission error

```sql
-- ❌ FAILS with "permission denied"
ALTER DATABASE postgres 
SET app.settings.anon_key TO 'eyJ...';
```

**Solution:** Hardcode the anon key directly in the cron job

```sql
-- ✅ WORKS - hardcode the key
SELECT cron.schedule(
  'my-job',
  '0 */3 * * *',
  $$
    SELECT net.http_post(
      url := 'https://xxx.supabase.co/functions/v1/my-function',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
      ),
      body := '{}'::jsonb
    );
  $$
);
```

**Note:** Supabase anon keys are safe to hardcode:
- They're public by design (used in frontend)
- They don't expire for decades
- RLS policies protect your data

---

## Complete Working Example

```ts
// my-function/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// Heavy background work
async function doHeavyWork() {
  console.log('[background] Starting heavy work...');
  
  try {
    // Fetch external APIs
    const response = await fetch('https://api.example.com/data');
    const data = await response.json();
    
    // Process data
    for (const item of data.items) {
      // Do something with each item
      await processItem(item);
    }
    
    console.log('[background] Heavy work complete');
  } catch (error) {
    console.error('[background] Error:', error);
  }
}

// Main handler
serve(async (req: Request) => {
  console.log('[handler] Request received');
  
  // Return immediately
  const response = new Response(
    JSON.stringify({ 
      status: 'accepted', 
      message: 'Processing started',
      timestamp: new Date().toISOString()
    }),
    { 
      status: 202, 
      headers: { 'Content-Type': 'application/json' } 
    }
  );
  
  // Start background work (fire and forget)
  doHeavyWork().catch(err => {
    console.error('[handler] Background job failed:', err);
  });
  
  return response;
});
```

Deploy:
```bash
supabase functions deploy my-function
```

Test:
```bash
# Should return immediately with 202 Accepted
curl -X POST "https://xxx.supabase.co/functions/v1/my-function" \
  -H "Authorization: Bearer eyJ..."

# Response (instant):
# {"status":"accepted","message":"Processing started","timestamp":"2025-11-27T04:43:14.112Z"}
```

Schedule:
```sql
SELECT cron.schedule(
  'my-function-hourly',
  '0 * * * *', -- Every hour
  $$
    SELECT net.http_post(
      url := 'https://xxx.supabase.co/functions/v1/my-function',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
      ),
      body := '{}'::jsonb
    );
  $$
);
```

---

## Debugging Checklist

When an Edge Function won't work:

1. ✅ **Check export pattern** - Must use `serve()`, not `export default`
2. ✅ **Check imports** - Must use `https://deno.land/std@0.168.0/http/server.ts`
3. ✅ **Check response timing** - Heavy work? Return 202 and process async
4. ✅ **Check logs** - View in Supabase Dashboard → Functions → [Your Function] → Logs
5. ✅ **Test locally first** - `supabase functions serve my-function --env-file .env.local`
6. ✅ **Verify deployment** - Check Functions dashboard shows "Active" status
7. ✅ **Check authorization** - Using correct anon or service role key?

---

## TypeScript Errors in VSCode (Normal)

You may see these errors in your IDE:

```
Cannot find module 'https://deno.land/std@0.168.0/http/server.ts'
Cannot find name 'Deno'
```

**This is normal!** These imports work fine in Deno runtime. VSCode just can't resolve remote HTTPS imports.

To reduce noise, you can add to the top of your Edge Function files:
```ts
// @ts-ignore - Deno imports
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
```

---

## Real-World Example: RSS Ingestion

**Before (didn't work):**
- Used `export default function handler()`
- Tried to fetch 5 RSS feeds and parse/insert before returning
- Timed out after 60+ seconds

**After (working):**
- Changed to `serve()`
- Returns `202 Accepted` immediately
- Processes RSS feeds in background
- Completes in 30-60 seconds without blocking HTTP response

Files:
- `/supabase/functions/ingest-news/index.ts`
- `/supabase/functions/ingest-news-lite/index.ts`

Both use this pattern successfully.

---

## Cron Schedule Patterns

Common schedules:

```sql
'*/5 * * * *'    -- Every 5 minutes
'0 * * * *'      -- Every hour
'0 */3 * * *'    -- Every 3 hours
'0 */6 * * *'    -- Every 6 hours
'0 0 * * *'      -- Daily at midnight
'0 2 * * *'      -- Daily at 2 AM
'0 */2 * * 0'    -- Every 2 hours on Sunday only
'0 6 * * 1-5'    -- Weekdays at 6 AM
```

---

## Quick Reference

**Template for new Edge Function:**

```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async (req: Request) => {
  // Your code here
  return new Response(
    JSON.stringify({ status: 'ok' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
```

**Template for scheduled cron job:**

```sql
SELECT cron.schedule(
  'job-name',
  '0 * * * *', -- Schedule
  $$
    SELECT net.http_post(
      url := 'https://YOUR_PROJECT.supabase.co/functions/v1/your-function',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_ANON_KEY'
      ),
      body := '{}'::jsonb
    );
  $$
);
```

---

## Additional Resources

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Processing Large Jobs Pattern](https://supabase.com/blog/processing-large-jobs-with-edge-functions)
- [Deno HTTP Server](https://deno.land/std/http/server.ts)
- [pg_cron Documentation](https://github.com/citusdata/pg_cron)
