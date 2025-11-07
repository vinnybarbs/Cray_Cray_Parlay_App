# Deployment Guide - Cray Cray Parlay Builder

Complete guide to deploy the new parlay builder architecture with Vercel (frontend), Railway (backend), and Supabase (database/auth).

---

## Prerequisites

- [ ] Supabase account and project created
- [ ] Vercel account
- [ ] Railway account
- [ ] GitHub repository connected to both Vercel and Railway
- [ ] API keys: Odds API, OpenAI, Serper, API-Sports

---

## Part 1: Supabase Setup

### 1.1 Create Project
1. Go to https://supabase.com/dashboard
2. Click "New Project"
3. Name: `cray-cray-parlay`
4. Choose region closest to your users
5. Set database password (save this!)

### 1.2 Apply Database Schema
1. Go to **SQL Editor** in left sidebar
2. Copy entire contents of `database/supabase_schema.sql`
3. Paste into SQL Editor
4. Click **Run**
5. Verify tables created in **Table Editor**

### 1.3 Enable Email Authentication
1. Go to **Authentication** → **Providers**
2. Ensure **Email** is enabled
3. Configure email templates (optional):
   - Confirmation email
   - Password reset email
   - Magic link email

### 1.4 Get API Credentials
1. Go to **Project Settings** → **API**
2. Copy these values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJhbG...` (safe for frontend)
   - **service_role key**: `eyJhbG...` (secret, backend only)

---

## Part 2: Railway Backend Deployment

### 2.1 Deploy to Railway
1. Go to https://railway.app/dashboard
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `Cray_Cray_Parlay_App` repository
4. Railway will auto-detect Node.js and deploy

### 2.2 Configure Environment Variables
Go to your Railway project → **Variables** tab and add:

```bash
# Node Configuration
NODE_ENV=production
PORT=5001

# API Keys
ODDS_API_KEY=your_odds_api_key_here
OPENAI_API_KEY=your_openai_key_here
SERPER_API_KEY=your_serper_key_here
APISPORTS_API_KEY=your_apisports_key_here

# Supabase (Backend)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...your_service_role_key

# CORS
ALLOWED_ORIGINS=https://your-vercel-app.vercel.app,http://localhost:3001
```

### 2.3 Get Railway URL
1. Go to **Settings** → **Networking**
2. Copy your public URL: `https://your-app.up.railway.app`
3. Save this for Vercel configuration

### 2.4 Verify Deployment
Test endpoints:
```bash
# Health check
curl https://your-app.up.railway.app/health

# CORS debug
curl https://your-app.up.railway.app/debug/cors
```

---

## Part 3: Vercel Frontend Deployment

### 3.1 Deploy to Vercel
1. Go to https://vercel.com/dashboard
2. Click **Add New** → **Project**
3. Import your GitHub repository
4. Vercel will auto-detect Vite and configure build settings

### 3.2 Configure Environment Variables
Go to your Vercel project → **Settings** → **Environment Variables**

Add these for **Production**, **Preview**, and **Development**:

```bash
# Backend API
VITE_API_BASE_URL=https://your-railway-app.up.railway.app

# Supabase (Frontend)
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...your_anon_key
```

### 3.3 Redeploy
After adding env vars:
1. Go to **Deployments** tab
2. Click **...** on latest deployment → **Redeploy**
3. Check "Use existing Build Cache" → **Redeploy**

### 3.4 Get Vercel URL
1. Your app will be at: `https://your-project.vercel.app`
2. Copy this URL

---

## Part 4: Update CORS Configuration

### 4.1 Update Railway ALLOWED_ORIGINS
Go back to Railway → **Variables** and update:
```bash
ALLOWED_ORIGINS=https://your-actual-vercel-url.vercel.app,http://localhost:3001
```

### 4.2 Redeploy Railway
Railway will auto-redeploy when you change environment variables.

---

## Part 5: Testing the Deployment

### 5.1 Test Backend
```bash
# Health check
curl https://your-railway-app.up.railway.app/health

# CORS check
curl https://your-railway-app.up.railway.app/debug/cors

# Suggest picks (should work without auth)
curl -X POST https://your-railway-app.up.railway.app/api/suggest-picks \
  -H "Content-Type: application/json" \
  -d '{"selectedSports":["NFL"],"selectedBetTypes":["Moneyline/Spread"],"riskLevel":"Medium","dateRange":1,"numLegs":3}'
```

### 5.2 Test Frontend
1. Visit your Vercel URL
2. Click **Sign In** → **Sign Up**
3. Create an account with email/password
4. Configure preferences (sports, bet types, etc.)
5. Click **Get AI Suggestions**
6. Add picks to parlay builder
7. Click **Lock Build** (saves to Supabase)
8. Click **Dashboard** to view saved parlays

### 5.3 Verify Database
1. Go to Supabase → **Table Editor**
2. Check `parlays` table for your saved parlay
3. Check `parlay_legs` table for individual legs
4. Verify `user_id` matches your auth user

---

## Part 6: Local Development Setup

### 6.1 Clone Repository
```bash
git clone https://github.com/your-username/Cray_Cray_Parlay_App.git
cd Cray_Cray_Parlay_App
npm install
```

### 6.2 Create .env.local
```bash
# Copy example
cp env.example .env.local

# Edit with your values
nano .env.local
```

Add:
```bash
# API Keys
ODDS_API_KEY=your_key
OPENAI_API_KEY=your_key
SERPER_API_KEY=your_key
APISPORTS_API_KEY=your_key

# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key

# Local development
PORT=5001
NODE_ENV=development
VITE_API_BASE_URL=http://localhost:5001
ALLOWED_ORIGINS=http://localhost:3001
```

### 6.3 Run Locally
```bash
# Terminal 1: Backend
npm run server:dev

# Terminal 2: Frontend
npm run dev
```

Visit: http://localhost:3001

---

## Part 7: Monitoring & Maintenance

### 7.1 Check Railway Logs
1. Go to Railway project → **Deployments**
2. Click on latest deployment
3. View logs for errors

### 7.2 Check Vercel Logs
1. Go to Vercel project → **Deployments**
2. Click on deployment → **Functions** tab
3. View runtime logs

### 7.3 Monitor Supabase
1. Go to Supabase → **Database** → **Logs**
2. Check for slow queries or errors
3. Monitor **Auth** → **Users** for signups

### 7.4 API Rate Limits
Monitor usage:
- **Odds API**: 100k calls/month
- **OpenAI**: Pay per token
- **Serper**: Check dashboard
- **API-Sports**: 100 calls/day

---

## Troubleshooting

### CORS Errors
**Symptom**: "No 'Access-Control-Allow-Origin' header"

**Fix**:
1. Check Railway `ALLOWED_ORIGINS` includes your Vercel URL
2. Verify no trailing slash in URLs
3. Test with curl to isolate issue

### Auth Not Working
**Symptom**: "Invalid or expired token"

**Fix**:
1. Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel
2. Check Supabase email auth is enabled
3. Verify JWT in browser DevTools → Application → Local Storage

### Suggestions Not Loading
**Symptom**: "Failed to fetch suggestions"

**Fix**:
1. Check Railway logs for errors
2. Verify API keys are set correctly
3. Test `/debug/odds-test` endpoint
4. Check Odds API quota

### Database Errors
**Symptom**: "relation does not exist"

**Fix**:
1. Re-run `database/supabase_schema.sql`
2. Check table names match code
3. Verify RLS policies are created

---

## Security Checklist

- [ ] Never commit `.env` or `.env.local`
- [ ] Use `SUPABASE_SERVICE_ROLE_KEY` only on backend
- [ ] Use `SUPABASE_ANON_KEY` only on frontend
- [ ] Enable RLS policies on all tables
- [ ] Use HTTPS in production (automatic with Vercel/Railway)
- [ ] Rotate API keys periodically
- [ ] Monitor for unusual API usage

---

## Cost Estimates (Monthly)

- **Supabase**: Free tier (500MB database, 50k monthly active users)
- **Vercel**: Free tier (100GB bandwidth, unlimited deployments)
- **Railway**: ~$5-10 (based on usage, $5 free credit/month)
- **Odds API**: Free tier (100k calls/month)
- **OpenAI**: ~$10-50 (depends on usage)
- **Serper**: Free tier available
- **API-Sports**: Free tier (100 calls/day)

**Total**: ~$15-60/month depending on traffic

---

## Next Steps

1. ✅ Deploy and test all three services
2. ⬜ Set up custom domain (optional)
3. ⬜ Configure email templates in Supabase
4. ⬜ Add Google OAuth (optional)
5. ⬜ Set up monitoring/alerts
6. ⬜ Implement odds caching with Supabase Edge Functions
7. ⬜ Add learning loop for AI improvement

---

**Questions?** Check the main README.md or IMPLEMENTATION_STATUS.md for more details.
