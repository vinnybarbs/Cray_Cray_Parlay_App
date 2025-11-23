# Cray Cray Parlay App – System Architecture

This document describes how the frontend, backend, Supabase, cron jobs, and external services fit together in this project.

---

## 1. High-Level Components

1. **Frontend (Vite + React)** – Browser UI where you configure and view parlays.
2. **Backend API (Node/Express)** – Main application server, hosted on **Railway** in production.
3. **Data Platform (Supabase)** – Postgres database + Edge Functions + pg_cron jobs.
4. **External Data Sources** – Odds API, Serper (search), and RSS feeds.

Each has its own environment configuration and deployment path.

---

## 2. Frontend (Vite + React)

**Location:**

- `src/components/MainApp.jsx`
- `src/App.jsx` / `src/AppLegacy.jsx`

**Tooling (package.json):**

```jsonc
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview"
}
```

**Backend base URL in the frontend:**

```js
const API_BASE = import.meta.env.VITE_API_BASE_URL
  || 'https://craycrayparlayapp-production.up.railway.app';
```

- **Local dev**: if you set `VITE_API_BASE_URL=http://localhost:5001` in `.env.local`, the browser will call your **local** Node server.
- **Production**: `VITE_API_BASE_URL` is usually set to the Railway URL, so the deployed frontend calls Railway.

**Key API calls from the frontend:**

- `POST ${API_BASE}/api/generate-parlay`
- `POST ${API_BASE}/api/suggest-picks`
- `GET  ${API_BASE}/api/health`

---

## 3. Backend API (Node/Express)

### 3.1 Local backend (your laptop)

**Main app:** `server.js` (Express). Routes under `/api` and `/cron`:

- `api/health.js` – basic health check
- `api/generate-parlay.js` – generates parlays
- `api/suggest-picks.js` – suggestions endpoint
- `/cron/refresh-odds` route (in server or a cron route file) – used by external schedulers

**Local commands:**

```bash
npm run server:dev    # nodemon server.js, dev backend on http://localhost:5001
npm run dev           # Vite dev server for frontend
```

`api/health.js` loads local env:

```js
require('dotenv').config({ path: '../.env.local' });
require('dotenv').config({ path: '../.env' });
```

So the local backend uses `.env.local` and `.env` for secrets like `ODDS_API_KEY`, `OPENAI_API_KEY`, etc.

> **Important:** `npm run server:dev` only affects your local machine. It does **not** redeploy or restart Railway.

### 3.2 Production backend (Railway)

**Deployment:**

- Railway is configured to deploy from GitHub repo `vinnybarbs/Cray_Cray_Parlay_App`.
- On push to `main`, Railway:
  1. Pulls the latest commit.
  2. Runs `npm install`.
  3. Runs the start command (usually `npm start` → `node server.js`).
- Exposes the app at:

```text
https://craycrayparlayapp-production.up.railway.app
```

**Production environment:**

- Environment variables are configured in the Railway dashboard (not `.env.local`).
- Frontend in production calls:
  - `https://craycrayparlayapp-production.up.railway.app/api/health`
  - `https://craycrayparlayapp-production.up.railway.app/api/generate-parlay`
  - `https://craycrayparlayapp-production.up.railway.app/api/suggest-picks`

**Debugging:**

- If the container “shuts down” or returns 5xx, open Railway → Service → **Logs** to see the stack trace from `server.js`.

---

## 4. Supabase: Database + Edge Functions + Cron

### 4.1 Postgres schema

**Definition:** `database/supabase_schema.sql`

Key tables:

- **Odds & games**
  - `odds_cache` – core & prop odds for games.
  - `games` – game metadata.
  - `teams`, `team_aliases`, `players`, `player_aliases`.
- **Parlay domain**
  - `parlays`, `parlay_legs` – user parlays and legs.
  - `user_stats_daily` – daily user stats.
- **Research / intelligence**
  - `news_cache` – Serper-based intelligence cache (`sport`, `team_name`, `search_type`, `articles`, `summary`).
  - `news_sources`, `news_articles`, `news_embeddings` – RSS ingestion.
- **Monitoring**
  - `api_call_log` – Serper API usage.
  - `cron_job_logs` – Edge Function cron runs.

Supabase Postgres is the **single source of truth** for odds, parlays, research, and RSS content.

### 4.2 Edge Functions (Deno runtime)

Located under `supabase/functions/`:

- **`refresh-odds-fast/index.ts`**
  - Uses Odds API to fetch multi-sport odds:
    - `americanfootball_nfl`, `americanfootball_ncaaf`, `basketball_nba`, `icehockey_nhl`, `soccer_epl`.
  - Fetches both **core markets** (`h2h,spreads,totals`) and **props** (per-event calls for NFL/NBA).
  - Collects entries, then:
    - Deletes existing rows in `odds_cache` for the fresh `external_game_id`s.
    - Inserts new rows in batched chunks.

- **`refresh-odds/index.ts`**
  - Focused on NFL + NBA.
  - Deletes old NFL/NBA odds by `sport` and then **upserts** into `odds_cache` using the unique key `(external_game_id, bookmaker, market_type)` to avoid duplicate key errors.

- **`refresh-sports-intelligence/index.ts`**
  - Uses **Serper (google.serper.dev)** to run curated search queries per sport and team.
  - Aggregates results into categories like:
    - `injuries`
    - `expert_analysis` → stored as `analyst_picks`
    - `market_intelligence` → stored as `betting_trends`
    - `situational_edges`, `insider_intelligence`, `historical_context`, `breaking_news` → grouped as `team_news`
  - Writes into `news_cache` with `upsert` (`onConflict: 'sport,search_type,team_name'`).

- **`ingest-news/index.ts`**
  - Fetches RSS feeds from ESPN and CBSSports (see `FEEDS` list in the function).
  - For each feed (limited per invocation):
    - Ensures a row exists in `news_sources`.
    - Fetches RSS XML → parses into items.
    - Inserts normalized rows into `news_articles` using REST (`supabasePost`).
  - Embeddings (for `news_embeddings`) are currently disabled to keep runtime small.

**Deployment:**

```bash
supabase functions deploy refresh-odds-fast
supabase functions deploy refresh-odds
supabase functions deploy refresh-sports-intelligence
supabase functions deploy ingest-news
```

### 4.3 Cron jobs (pg_cron + net.http_post)

SQL files under `database/` manage cron, such as:

- `cron_jobs_generous_timeouts.sql`
- `fix_all_cron_jobs_final.sql`
- `setup_enhanced_data_pipeline.sql`

Examples:

- **Hourly odds refresh (FAST)**

  ```sql
  SELECT cron.schedule(
    'refresh-odds-hourly-fast',
    '0 * * * *',
    $$
    SELECT net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/refresh-odds-fast',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key') || ''
      ),
      body := '{}'::jsonb
    );
    $$
  );
  ```

- **Sports intelligence every 2 hours**

  ```sql
  SELECT cron.schedule(
    'refresh-intelligence-2hourly',
    '15 */2 * * *',
    $$
    SELECT net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/refresh-sports-intelligence',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key') || ''
      ),
      body := '{}'::jsonb
    );
    $$
  );
  ```

Supabase cron runs these independent of Railway.

---

## 5. External Data Sources

- **Odds API** (`the-odds-api.com`)
  - Used primarily by `refresh-odds-fast` and older quick scripts.
  - Feeds `odds_cache` for all supported sports and props.

- **Serper (Search API)**
  - Called in `refresh-sports-intelligence`.
  - Produces summarized search-based intelligence stored in `news_cache`.

- **RSS Feeds** (ESPN, CBSSports)
  - Fetched by `ingest-news` Edge Function.
  - Raw headlines and articles stored in `news_sources` and `news_articles`.

---

## 6. Intelligence & Agents

### 6.1 SportsIntelligenceService

**Location:** `lib/services/sports-intelligence.js`

Responsibilities:

- Read from `news_cache` and `news_articles`.
- Provide team-level and matchup-level intelligence, including:
  - Injuries
  - Analyst picks
  - Team news
  - Betting trends
- Construct agent context text for the AI.

Key methods:

- `getTeamIntelligence(sport, teamName)` – loads:
  - `injuries`, `analystPicks`, `teamNews` from `news_cache`.
  - Additional headlines from `news_articles` via a fuzzy match on title/summary/content.
- `getMatchupIntelligence(sport, homeTeam, awayTeam)` – bundles both teams + betting trends.
- `getAgentContext(sport, homeTeam, awayTeam)` – generates a text summary for agents.

### 6.2 Analyst Agent

**Location:** `lib/agents/analyst-agent.js` (and related agent code)

- Combines:
  - Odds and props from `odds_cache`.
  - Intelligence context from `SportsIntelligenceService`.
  - User-selected settings (sports, bet types, risk level).
- Sends a carefully crafted prompt to OpenAI to generate:
  - Suggested legs
  - Rationale (blue research block)
  - Confidence/risk notes

---

## 7. Request Flow End-to-End

### 7.1 Generate Parlay (frontend user action)

1. User clicks **Generate Parlay** in the React frontend.
2. Frontend calls:

   ```http
   POST ${API_BASE}/api/generate-parlay
   ```

3. **Backend (Node/Express on Railway):**
   - Validates request and reads odds from Supabase `odds_cache`.
   - Instantiates `SportsIntelligenceService` and fetches intelligence for the matchup(s):
     - injuries / analyst picks / news / trends via `news_cache` + `news_articles`.
   - Builds an OpenAI prompt (include odds + intelligence context).
   - Calls OpenAI to get suggested legs & explanations.
   - Returns JSON with:
     - Suggested parlays
     - Metadata (e.g., `fallbackUsed`)
     - Research summary.

4. **Frontend:**
   - Renders suggested legs and research.

### 7.2 Data Refresh (cron & background)

- **Odds**: `refresh-odds-fast` Edge Function runs hourly via pg_cron → updates `odds_cache`.
- **Sports Intelligence**: `refresh-sports-intelligence` runs every 2 hours → updates `news_cache`.
- **RSS News**: `ingest-news` runs manually (for now) or via cron → updates `news_articles`.

---

## 8. Docker and Images

### 8.1 Supabase CLI and Docker (local)

- Some `supabase` CLI commands (like `functions serve` or `functions download`) expect Docker running locally to emulate the Deno runtime.
- Errors like:

  > Cannot connect to the Docker daemon at unix:///var/run/docker.sock

  only affect **local emulation**, not the deployed Edge Functions on Supabase.

### 8.2 Railway Docker image (remote)

- Railway effectively builds a Docker image from your repo:
  - Clone repo → `npm install` → build (if configured) → `npm start`.
  - That image runs as the container serving your backend at `...up.railway.app`.
- If the container exits/crashes, Railway logs show the reason (uncaught exception, missing env, etc.).

---

## 9. Mental Model Summary

- **Local dev stack**
  - `npm run server:dev` → Node backend on `http://localhost:5001`.
  - `npm run dev` → Vite frontend on `http://localhost:5173` (or similar).
  - Frontend uses `VITE_API_BASE_URL` to choose local vs Railway backend.

- **Production stack**
  - Frontend deployed (e.g., Vercel) with `VITE_API_BASE_URL` set to Railway.
  - Railway backend (`server.js`) talks to Supabase Postgres & Edge Functions.
  - Supabase Edge Functions + cron keep `odds_cache`, `news_cache`, and `news_articles` fresh.

Keeping this separation in mind (local vs Railway, Node backend vs Supabase Edge) is the key to understanding where to debug when something fails.
