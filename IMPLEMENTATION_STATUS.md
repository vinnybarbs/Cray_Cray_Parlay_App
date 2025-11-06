# Implementation Status - Pick Suggestions Architecture

## ✅ Completed (Phase 1-3)

### Backend Infrastructure
- ✅ **Database Schema**: Added `odds_cache` table to `database/supabase_schema.sql`
- ✅ **New Endpoint**: `/api/suggest-picks` returns 10-30 individual picks (not full parlays)
- ✅ **Coordinator Logic**: `generatePickSuggestions()` method extracts all possible picks from games
- ✅ **AI Selection**: `ParlayAnalyst.selectBestPicks()` uses OpenAI to rank and select best options
- ✅ **Spread Context**: Always includes spread info even for moneyline bets
- ✅ **Independence**: Picks are independent, max 2 from same game

### Authentication
- ✅ **Supabase Client**: Installed `@supabase/supabase-js` and related packages
- ✅ **Auth Context**: Created `AuthContext` provider for session management
- ✅ **Auth UI**: Basic login/signup component ready
- ✅ **Environment Variables**: Updated `env.example` with Supabase frontend vars

### Files Modified/Created
```
✅ database/supabase_schema.sql (added odds_cache table)
✅ api/suggest-picks.js (new endpoint)
✅ lib/agents/coordinator.js (added generatePickSuggestions method)
✅ lib/agents/analyst-agent.js (added selectBestPicks method)
✅ server.js (registered new endpoint)
✅ src/lib/supabaseClient.js (new)
✅ src/contexts/AuthContext.jsx (new)
✅ src/components/Auth.jsx (new)
✅ env.example (updated)
✅ package.json (added Supabase deps)
```

---

## 🚧 Next Steps (Phase 4-6)

### Phase 4: New UI Architecture
**Goal**: Replace full parlay generation with pick suggestions + custom builder

#### Left Panel: AI Suggestions
- Display 10-30 pick cards based on `numLegs` selection
- Each card shows:
  - Game info (teams, date)
  - Bet type and pick
  - Odds
  - **Spread context** (even for ML bets)
  - Confidence score (1-10)
  - Reasoning
  - "Add to Parlay" button

#### Right Panel: Parlay Builder
- Empty state: "Select picks to build your parlay"
- Shows selected picks with:
  - Remove button for each
  - Dynamic payout calculator at bottom
  - "Lock Build" button (saves to DB)

#### API Integration
- Call `/api/suggest-picks` instead of `/api/generate-parlay`
- Parse JSON response (never show raw JSON to user)
- Handle loading states

### Phase 5: User Dashboard
**Goal**: Show parlay history and win rate

#### Features Needed
- List of past parlays (from `parlays` table)
- Win rate calculation
- Profit/loss tracking
- Click to view parlay details

#### Backend Endpoints
```javascript
GET /api/user/parlays - Get user's parlay history
POST /api/user/parlays - Save new parlay
GET /api/user/stats - Get win rate, profit/loss
```

### Phase 6: Odds Caching (Supabase Edge Functions)
**Goal**: Stop hitting Odds API live, use hourly refresh

#### Supabase Edge Function
```sql
-- Create cron job
SELECT cron.schedule(
  'refresh-odds',
  '0 * * * *', -- Every hour
  $$
  SELECT net.http_post(
    url := 'https://your-railway-app.up.railway.app/cron/refresh-odds',
    headers := '{"Authorization": "Bearer YOUR_CRON_SECRET"}'::jsonb
  );
  $$
);
```

#### Backend Cron Endpoint
```javascript
POST /cron/refresh-odds
- Fetch odds from Odds API for next 7 days
- Upsert into odds_cache table
- Track line movements
```

---

## 📋 Configuration Checklist

### Supabase Setup
1. ✅ Run `database/supabase_schema.sql` in Supabase SQL Editor
2. ⬜ Enable Email Auth in Supabase Dashboard
3. ⬜ Get Supabase URL and keys from project settings
4. ⬜ Add to `.env.local`:
   ```
   VITE_SUPABASE_URL=https://xxx.supabase.co
   VITE_SUPABASE_ANON_KEY=xxx
   ```

### Vercel Deployment
1. ⬜ Add environment variables in Vercel dashboard:
   ```
   VITE_API_BASE_URL=https://craycrayparlayapp-production.up.railway.app
   VITE_SUPABASE_URL=https://xxx.supabase.co
   VITE_SUPABASE_ANON_KEY=xxx
   ```
2. ⬜ Redeploy frontend

### Railway Deployment
1. ✅ Backend already deployed and working
2. ⬜ Add Supabase env vars (for backend verification):
   ```
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=xxx
   ```

---

## 🎯 Key Design Decisions

### Pick Suggestions Logic
- **1-3 legs requested**: Return 10 suggestions
- **4+ legs requested**: Return 15-30 suggestions
- AI ranks all possible picks and selects best based on:
  - Risk level (Low/Medium/High)
  - Research insights
  - Value (odds vs. probability)
  - Diversity (max 2 picks per game)

### User Flow
1. User selects sports, bet types, risk level, num legs
2. Click "Get Suggestions" → calls `/api/suggest-picks`
3. AI returns 10-30 independent picks with reasoning
4. User browses suggestions, adds picks to builder
5. Dynamic payout updates as picks are added/removed
6. Click "Lock Build" → saves to DB with user_id
7. View history in dashboard

### No JSON on Frontend
- Backend returns structured data
- Frontend displays as cards/UI elements
- User never sees raw JSON

---

## 🔧 Testing Commands

### Local Development
```bash
# Frontend
npm run dev

# Backend
npm run server:dev

# Test new endpoint
curl -X POST http://localhost:5001/api/suggest-picks \
  -H "Content-Type: application/json" \
  -d '{
    "selectedSports": ["NFL"],
    "selectedBetTypes": ["Moneyline/Spread"],
    "riskLevel": "Medium",
    "dateRange": 1,
    "numLegs": 3
  }'
```

### Production
```bash
# Test Railway backend
curl -X POST https://craycrayparlayapp-production.up.railway.app/api/suggest-picks \
  -H "Content-Type: application/json" \
  -d '{"selectedSports":["NFL"],"selectedBetTypes":["Moneyline/Spread"],"riskLevel":"Medium","dateRange":1,"numLegs":3}'
```

---

## 📝 Notes
- Old `/api/generate-parlay` endpoint still works (marked as legacy)
- Can run both flows in parallel during transition
- Supabase RLS policies already in place for user data security
- Spread context always included per user request
