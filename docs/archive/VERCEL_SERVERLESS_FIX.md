# Fix: Vercel Serverless Function Limit Exceeded

## Problem

Vercel Hobby plan allows **12 serverless functions**. Your app was deploying backend code (`/api` folder) as serverless functions, exceeding this limit.

## Root Cause

Your `vercel.json` had API rewrites that made Vercel think it should deploy backend code:

```json
// ❌ OLD - Caused Vercel to deploy backend as serverless functions
{
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/api/$1"  // Vercel tries to deploy /api as functions
    }
  ]
}
```

## Solution

**Vercel = Frontend only (static files)**  
**Railway = Backend only (API, database)**

### Changes Made

1. **Created `.vercelignore`** - Tells Vercel to ignore backend code
   ```
   api/
   server.js
   lib/
   database/
   ```

2. **Updated `vercel.json`** - Configure for SPA deployment only
   ```json
   {
     "framework": "vite",
     "outputDirectory": "dist",
     "rewrites": [
       {
         "source": "/(.*)",
         "destination": "/index.html"  // SPA routing only
       }
     ]
   }
   ```

3. **Verified Environment Variables** - Frontend calls Railway backend
   ```
   VITE_API_BASE_URL=https://craycrayparlayapp-production.up.railway.app
   ```

---

## Deploy to Vercel

### 1. Commit Changes

```bash
git add .vercelignore vercel.json
git commit -m "Fix Vercel serverless function limit - frontend only deployment"
git push origin main
```

### 2. Verify Environment Variables in Vercel

Go to: https://vercel.com/your-project/settings/environment-variables

**Required Variables:**
```
VITE_API_BASE_URL = https://craycrayparlayapp-production.up.railway.app
VITE_SUPABASE_URL = your-supabase-url
VITE_SUPABASE_ANON_KEY = your-supabase-anon-key
```

**NOT needed** (these are backend-only, Railway handles them):
- ❌ OPENAI_API_KEY
- ❌ ODDS_API_KEY
- ❌ SUPABASE_SERVICE_ROLE_KEY
- ❌ CRON_SECRET

### 3. Redeploy

Vercel will auto-deploy on push, or manually trigger:
```bash
vercel --prod
```

### 4. Verify Function Count

After deployment:
1. Go to Vercel dashboard → Your project → Settings → Functions
2. Should see: **0-2 functions** (just routing/middleware)
3. Before: **12+ functions** ❌
4. After: **0-2 functions** ✅

---

## Architecture Overview

```
┌──────────────────────────────────────────┐
│ USER                                     │
│   ↓                                      │
│ VERCEL (Frontend)                        │
│   - Static files only (HTML/CSS/JS)     │
│   - Vite build output (dist/)            │
│   - No API routes                        │
│   - No serverless functions              │
│   ↓                                      │
│ RAILWAY (Backend)                        │
│   - Express API server                   │
│   - /api/suggest-picks                   │
│   - /api/user/parlays                    │
│   - AI function calling                  │
│   - Database queries                     │
│   ↓                                      │
│ SUPABASE (Database)                      │
│   - PostgreSQL                           │
│   - Row Level Security                   │
│   - Real-time subscriptions              │
└──────────────────────────────────────────┘
```

---

## Troubleshooting

### Still Seeing "Function Limit Exceeded"?

1. **Check Vercel build logs:**
   ```
   Look for: "Creating serverless functions..."
   Should be: 0-2 functions only
   ```

2. **Verify .vercelignore is working:**
   ```bash
   # In Vercel build logs, should NOT see:
   - api/ being built
   - server.js being processed
   ```

3. **Clear Vercel cache:**
   - Go to Vercel dashboard
   - Settings → General → Clear Cache
   - Redeploy

### Frontend Can't Reach Backend?

Check browser console:
```javascript
// Should call Railway, not Vercel
fetch('https://craycrayparlayapp-production.up.railway.app/api/suggest-picks')
```

If calling wrong URL:
- Verify `VITE_API_BASE_URL` in Vercel env vars
- Check `import.meta.env.VITE_API_BASE_URL` in code
- Rebuild frontend: `npm run build`

### API Returns 404?

- ✅ Check Railway deployment is running
- ✅ Verify Railway URL is correct
- ✅ Test API directly: `curl https://craycrayparlayapp-production.up.railway.app/health`

---

## Cost Comparison

| Plan | Serverless Functions | Cost |
|------|---------------------|------|
| **Hobby (Free)** | 12 functions | $0/mo |
| **Pro** | 100 functions | $20/mo |

**With this fix:** Stay on Hobby plan (0 functions used) ✅

---

## Verification Commands

```bash
# 1. Check .vercelignore exists
cat .vercelignore

# 2. Check vercel.json config
cat vercel.json

# 3. Verify frontend env var
grep VITE_API_BASE_URL .env.local

# 4. Test build locally
npm run build
# Should output to dist/ with NO api/ folder

# 5. Test Railway backend
curl https://craycrayparlayapp-production.up.railway.app/health
# Should return: {"status":"ok"}
```

---

**Status:** ✅ Fixed - Frontend only deployment
**Serverless Functions:** 0 (was 12+)
**Deployment:** Vercel (frontend) + Railway (backend)
