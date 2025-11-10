## 🧪 TESTING EDGE FUNCTIONS (Alternative Method)

Since the `net` schema isn't available, we'll test Edge Functions through the Supabase Dashboard:

### Method 1: Supabase Dashboard (RECOMMENDED)

1. **Go to your Supabase Dashboard**
2. **Navigate to Edge Functions**
3. **Test each function individually:**

#### Test refresh-odds:
- Function: `refresh-odds`
- Request Body: `{}`
- Expected Response: `{"status": "success", "totalGames": X, "totalOddsInserted": Y}`

#### Test sync-sports-stats:
- Function: `sync-sports-stats` 
- Request Body: `{}`
- Expected Response: `{"status": "success", "sportsProcessed": [...], "totalRecords": X}`

#### Test refresh-sports-intelligence:
- Function: `refresh-sports-intelligence`
- Request Body: `{}`
- Expected Response: `{"status": "success", "articlesProcessed": X}`

### Method 2: Enable net extension (Optional)

If you want to enable SQL HTTP requests for future use:

```sql
-- Enable the net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS net;
```

### Method 3: Direct URL Testing (Browser/Postman)

Test Edge Functions directly via HTTP:

**Base URL:** `https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/`

**Headers needed:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs
Content-Type: application/json
```

**Endpoints to test:**
- POST `refresh-odds` 
- POST `sync-sports-stats`
- POST `refresh-sports-intelligence`

## 🎯 What We're Looking For:

✅ **Success Response** → Function works, proceed to schedule cron job  
❌ **Error Response** → Function has issues, need to debug before scheduling

Once you test the functions and confirm they work, we'll add the missing cron jobs!