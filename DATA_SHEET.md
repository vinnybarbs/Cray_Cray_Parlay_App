# Cray Cray for Parlays - Technical Data Sheet

## Overview

Sports betting analytics platform that ingests real-time odds, game results, news, injuries, and standings data across 10+ sports, runs AI-powered pre-game analysis, and presents picks through a daily digest and conversational chat interface (De-Genny).

**Stack:** React 19 + Vite (frontend) | Node.js + Express 5 (API) | PostgreSQL via Supabase (database) | Supabase Edge Functions (Deno) | Railway (hosting) | OpenAI GPT-4o / GPT-4o-mini (AI)

**Repo:** Private GitHub | **DB:** Supabase (us-east-1) | **API Server:** Railway

---

## Architecture Diagram

```
                    pg_cron (28 scheduled jobs)
                           |
            +--------------+--------------+
            |              |              |
     Supabase Edge    Railway API     Direct SQL
     Functions (22)   Server (42       (materialized
                      endpoints)        view refreshes)
            |              |
     +------+------+  +---+---+
     |             |  |       |
  Odds API    ESPN   OpenAI  ESPN
  (The Odds   (free  GPT-4o  Scoreboard
   API)       API)   GPT-4o  Standings
                     -mini
            |              |
            +--------------+
                   |
            PostgreSQL (Supabase)
            44 tables, ~100K rows
                   |
            React Frontend
            (5 pages, Tailwind CSS)
```

---

## Data Sources

| Source | Type | Auth | Cost | What We Get |
|--------|------|------|------|-------------|
| **The Odds API** | REST | API Key | Paid (credit-based) | H2H, spreads, totals, outrights, player props from DraftKings + FanDuel |
| **ESPN** | REST | None (public) | Free | Scoreboards, standings, injuries, rosters, rankings, leaderboards |
| **OpenAI** | REST | API Key | Pay-per-token | GPT-4o (chat), GPT-4o-mini (pre-analysis, fact-checking) |
| **Google News RSS** | RSS | None | Free | Sports news articles from 50+ sources |

### Sports Coverage

| Sport | Odds | Pre-Analysis | Game Results | Standings | Settlement |
|-------|------|-------------|-------------|-----------|------------|
| NBA | H2H, spreads, totals, player props | Every 2h | ESPN backfill | ESPN sync | Auto |
| NHL | H2H, spreads, totals | Every 2h | ESPN backfill | ESPN sync | Auto |
| MLB | H2H, spreads, totals | Every 3h | ESPN backfill | ESPN sync | Auto |
| NFL | H2H, spreads, totals, player props | Every 3h | ESPN backfill | ESPN sync | Auto |
| NCAAB | H2H, spreads, totals, player props | Every 2h | ESPN backfill | ESPN sync | Auto |
| NCAAF | H2H, spreads, totals | Seasonal | ESPN backfill | ESPN sync | Auto |
| EPL | H2H, spreads, totals | Every 3h | ESPN backfill | ESPN sync | Auto |
| MLS | H2H, spreads, totals | Every 3h | ESPN backfill | ESPN sync | Auto |
| UFC/MMA | H2H | Every 4h | ESPN backfill | N/A | Auto |
| Tennis (ATP/WTA) | H2H, spreads, totals | Every 4h | ESPN backfill | N/A | Auto |
| Golf (PGA Majors) | Outright winner | Leaderboard | ESPN leaderboard | N/A | Manual |

---

## Database Schema (44 tables)

### Core Tables (actively used, with row counts)

| Table | Rows | Size | Purpose |
|-------|------|------|---------|
| `players` | 11,943 | 32 MB | Player roster data |
| `news_articles` | 10,172 | 13 MB | Enriched news from 50+ RSS sources |
| `injuries` | 18,876 | 4.3 MB | Player injury reports from ESPN |
| `player_game_stats` | 16,269 | 5.2 MB | Per-game player statistics |
| `player_recent_form` | 11,943 | 4.1 MB | Materialized recent form data |
| `news_cache` | 3,530 | 8.9 MB | ESPN intelligence (injuries, standings, scores) |
| `odds_cache` | 461 | 10 MB | Current betting odds (refreshed hourly) |
| `ai_suggestions` | 937 | 2.8 MB | Every AI pick with outcome tracking |
| `game_analysis` | 568 | 1.9 MB | Pre-computed game briefs (GPT-4o-mini) |
| `game_results` | 792 | 728 KB | Final scores from ESPN (all sports) |
| `rosters` | 5,149 | 1 MB | Team rosters |
| `teams` | 448 | 440 KB | Team master data (all sports) |
| `team_aliases` | 532 | 392 KB | Name normalization (ESPN vs Odds API vs display) |
| `standings` | 191 | 104 KB | W-L records from ESPN (synced every 6h) |
| `rankings_cache` | 25 | 104 KB | AP Top 25 (college) |
| `ai_instructions` | 15 | 80 KB | AI playbook (editable without deploys) |
| `cron_job_logs` | 2,058 | 584 KB | Pipeline execution history |
| `team_ats_records` | 36 | 80 KB | Against-the-spread records |

### Views

| View | Source | Purpose |
|------|--------|---------|
| `current_standings` | `standings` + `teams` | Current season W-L with win%, division rank |
| `normalized_odds_outcomes` | `odds_cache` | Materialized view, refreshed every 30min |

### Key Relationships

```
teams (id) <-- standings (team_id)
teams (id) <-- players (team_id)  
teams (id) <-- rosters (team_id)
ai_suggestions (id) <-- parlay_legs (suggestion_id)
parlays (id) <-- parlay_legs (parlay_id)
game_results (espn_event_id) -- unique constraint for upserts
game_analysis (game_key) -- unique constraint for upserts
```

---

## Cron Jobs (28 active)

### Data Ingestion

| Job | Schedule | Target | What It Does |
|-----|----------|--------|-------------|
| `refresh-odds` | Hourly (:00) | Supabase Edge Function | Pulls odds for all sports from The Odds API |
| `ingest-news-lite` | Every 2h | Supabase Edge Function | RSS feed ingestion from 50 sources |
| `fetch-espn-intelligence` | Every 3h (:20) | Railway | ESPN injuries, scores, standings |
| `enrich-articles` | Every 4h (:45) | Railway | AI-enrich raw articles with betting context |
| `sync-ncaab-data` | Every 2h (:30) | Railway | NCAAB-specific ESPN data |
| `sync-standings` | Every 6h | Railway | ESPN standings for all sports |
| `backfill-game-results` | Daily (5 AM) | Railway | ESPN final scores (last 2 days) |

### AI Analysis

| Job | Schedule | Target | What It Does |
|-----|----------|--------|-------------|
| `pre-analyze-NBA` | Every 2h (:00) | Railway | GPT-4o-mini game briefs |
| `pre-analyze-NHL` | Every 2h (:15) | Railway | GPT-4o-mini game briefs |
| `pre-analyze-NCAAB` | Every 2h (:30) | Railway | GPT-4o-mini game briefs |
| `pre-analyze-MLB` | Every 3h (:45) | Railway | GPT-4o-mini game briefs |
| `pre-analyze-EPL` | Every 3h (:20) | Railway | GPT-4o-mini game briefs |
| `pre-analyze-MLS` | Every 3h (:50) | Railway | GPT-4o-mini game briefs |
| `pre-analyze-UFC` | Every 4h (:55) | Railway | GPT-4o-mini game briefs |
| `pre-analyze-Tennis` | Every 4h (:25) | Railway | GPT-4o-mini game briefs |
| `fact-check-picks` | Every 2h (:30) | Railway | Verify AI pick claims against data |

### Settlement & Monitoring

| Job | Schedule | Target | What It Does |
|-----|----------|--------|-------------|
| `check-outcomes` | Midnight + 6 AM | Supabase Edge Function | Resolve ai_suggestions (won/lost/push) |
| `check-parlays` | Hourly + every 30min | Railway | Resolve user parlays |
| `analyze-outcomes` | Daily (8 AM) | Railway | Post-mortem on resolved picks |
| `refresh-materialized-view` | Every 30min | Direct SQL | Refresh normalized_odds_outcomes |
| `refresh-player-form` | Hourly + every 15min | Direct SQL | Refresh player_recent_form |
| `capture-odds-failures` | Hourly (:05) | Direct SQL | Log odds parsing issues |

---

## API Endpoints (42 routes)

### Public / User-Facing

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/digest` | Daily digest with games, analysis, performance stats |
| GET | `/api/deep-research` | Deep AI research on a specific game |
| POST | `/api/chat-picks` | De-Genny conversational AI (GPT-4o with tools) |
| POST | `/api/generate-parlay` | Full parlay generation pipeline |
| GET | `/api/generate-parlay-stream/:id` | SSE stream for generation progress |
| POST | `/api/suggest-picks` | Quick pick suggestions |
| GET | `/api/user/parlays` | User's parlay history |
| PATCH | `/api/user/parlays/:id` | Update parlay (lock picks, etc.) |

### Cron / Internal

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/cron/pre-analyze-games` | Pre-build game analysis (supports `?sports=nba,mlb`) |
| POST | `/cron/backfill-game-results` | ESPN score backfill (supports `?days=7&sports=NBA,MLB`) |
| POST | `/cron/sync-standings` | ESPN standings sync (supports `?sports=NBA,NHL,MLB`) |
| POST | `/cron/fetch-espn-intelligence` | ESPN injuries/scores/standings |
| POST | `/cron/enrich-articles` | AI article enrichment |
| POST | `/cron/fact-check-picks` | AI fact-checking |
| POST | `/api/sync-apisports` | API-Sports sync (being deprecated) |

### Admin / Debug

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/admin/dashboard` | Pipeline health dashboard |
| GET | `/api/dashboard-status` | Data freshness status |
| GET | `/health` | Health check |

---

## Core Feature: Parlay Generator (Multi-Agent System)

The parlay generator is the heart of the app. Users select sports, bet types, risk level, number of legs, and their sportsbook — the system runs a multi-agent pipeline that produces a fully-researched parlay with individual leg analysis.

### User Inputs
- **Sports**: NBA, NHL, MLB, NFL, NCAAB, NCAAF, EPL, MLS, UFC, Tennis (multi-select)
- **Bet Types**: Moneyline/Spread, Over/Under, Player Props, or ALL
- **Risk Level**: Low (moneyline-only favorites), Medium (mixed), High (long shots + props)
- **Number of Legs**: 2-10
- **Sportsbook**: DraftKings, FanDuel, MGM, Caesars, Bet365
- **Mode**: Standard Parlay, Easy Money (ML-only), or Suggestions (individual picks)

### Generation Pipeline (5 Phases)

```
User Request
    |
    v
Phase 1: ODDS COLLECTION (Odds Agent)
    - Queries odds_cache for selected sports + sportsbook
    - Falls back to secondary bookmaker if primary has gaps
    - Filters to selected bet types + risk constraints
    - Returns available games with H2H, spreads, totals, props
    |
    v
Phase 2: RESEARCH ENRICHMENT
    2.0 - Enhanced Research Agent: news articles, betting context
    2.1 - Pre-computed game_analysis injection (from pre-analyzer cron)
    2.25 - Sports Stats: team records, player stats from DB
    2.3 - Sports Intelligence: ESPN injuries, standings, recent results
    2.5 - Market filtering (only selected bet types)
    2.75 - Player verification (roster check for player props)
    |
    v
Phase 3: AI ANALYSIS (GPT-4o via Analyst Agent)
    - Receives all enriched game data as structured context
    - Prompt includes: odds, research, injuries, standings, records
    - Generates N-leg parlay with per-leg reasoning
    - Also generates a "Lock Parlay" (2-leg high-confidence bonus)
    - Calculates combined odds + payout
    - Retry mechanism (up to 3 attempts on parse failure)
    |
    v
Phase 4: POST-PROCESSING
    - Parses AI response into structured legs
    - Validates odds calculations (fixes math errors)
    - Extracts confidence scores per leg
    - Maps picks to actual odds_cache data
    |
    v
Phase 5: QUALITY ASSURANCE + STORAGE
    - Validates all legs have real odds backing
    - Saves parlay to parlays + parlay_legs tables
    - Saves individual picks to ai_suggestions for tracking
    - Returns full response with SSE progress events
```

### Real-Time Progress (SSE)
The generator streams progress events to the frontend via Server-Sent Events:
- `odds` → "Fetching odds data..."
- `research` → "Researching games..."
- `analysis` → "AI analyzing matchups..."
- `complete` → Full parlay response

### Suggest Picks Mode (Individual Picks)
Alternative flow that returns ranked individual picks instead of a parlay:
- Phase 0: Fetch historical lessons from past wins/losses
- Phase 1-3: Same odds + research + enrichment
- Phase 4: Extract ALL possible picks (both sides of every bet)
- Phase 5: AI ranks picks using function calling (get_team_stats, get_injuries, get_standings)
- Returns top N picks sorted by confidence, each with reasoning

### Key Files
- `api/generate-parlay.js` — API handler, request validation
- `lib/agents/coordinator.js` — Multi-agent orchestrator (1900+ lines)
- `lib/agents/odds-agent.js` — Odds collection + sportsbook fallbacks
- `lib/agents/research-agent.js` — News/article enrichment
- `lib/agents/analyst-agent.js` — GPT-4o prompt construction + parsing
- `lib/services/sports-stats.js` — Team/player stats from DB
- `lib/services/sports-intelligence.js` — ESPN injury/standings data
- `shared/oddsCalculations.js` — Parlay math (American to decimal, combined odds, payouts)

---

## AI Pipeline

### Pre-Analyzer (GPT-4o-mini)
- Runs per-sport on staggered cron schedules
- For each upcoming game: gathers odds, news, injuries, rankings, recent results, standings
- Runs Edge Calculator (statistical model) for win probability + edge vs implied odds
- Sends structured prompt to GPT-4o-mini for 3-5 sentence analysis + recommended pick
- Stores in `game_analysis` table with 6-hour expiry
- Also auto-saves to `ai_suggestions` for performance tracking

### Edge Calculator (Pure Math)
- Log5 formula for head-to-head probability
- Blended win%: 60% point differential + 40% raw record
- Adjustments: recent form (last 5), schedule strength, home advantage (sport-specific), injury impact
- Compares calculated probability vs bookmaker's implied probability (from moneyline)
- Outputs: edge %, edge side, confidence level, adjustment factors

### De-Genny Chat (GPT-4o)
- 8 database tools the AI can call: `search_odds`, `get_game_analysis`, `get_team_stats`, `get_injuries`, `get_news`, `get_recent_scores`, `get_standings`, `get_model_performance`
- Personality: sharp, opinionated sports betting degenerate
- Required research flow: game_analysis first, then odds, injuries, team stats, news
- All data must come from tool calls (no fabrication)

### Settlement Pipeline
- `check-outcomes` edge function: matches pending ai_suggestions against game_results
- Team name matching: exact + includes (bidirectional)
- Date matching: +/- 1 day for timezone edge cases
- Outcome logic: Moneyline (winner check), Spread (adjusted score), Total (combined score)
- Updates `actual_outcome` to won/lost/push with `resolved_at` timestamp

---

## Known Issues / Tech Debt

1. **API-Sports dependency** — Being replaced by ESPN. Some sync code still references it.
2. **Team name normalization** — ESPN names don't always match Odds API names (e.g., "LA Clippers" vs "Los Angeles Clippers"). `team_aliases` table helps but isn't comprehensive.
3. **Golf/Tennis** — Tournament sports have different data models than team sports. Golf is leaderboard-based, tennis is match-based but tournament-scoped.
4. **Player props settlement** — Currently skipped (marked as push). Need player stat ingestion to resolve.
5. **Empty tables** — Several tables exist but are unused: `player_stats`, `player_aliases`, `games`, `external_mappings`, `model_accuracy`, `news_embeddings`. Candidates for cleanup.
6. **Duplicate cron patterns** — Multiple variants of the same job exist from debugging iterations (check-parlay-outcomes with -fixed, -generous, -safe suffixes).

---

## Environment Variables

| Variable | Service | Purpose |
|----------|---------|---------|
| `OPENAI_API_KEY` | OpenAI | GPT-4o / GPT-4o-mini for analysis |
| `ODDS_API_KEY` | The Odds API | Betting odds (set in Supabase secrets) |
| `SUPABASE_URL` | Supabase | Database connection |
| `SUPABASE_ANON_KEY` | Supabase | Client-side auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Server-side admin |
| `CRON_SECRET` | Internal | Secures cron endpoints |
| `VITE_SUPABASE_URL` | Frontend | Client Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Client Supabase key |

---

## Performance / Current Stats

- **AI Suggestions**: 937 total (328 won, 234 lost, 46 push, 296 pending)
- **Overall Win Rate**: ~58% (won / (won + lost))
- **Game Results**: 792 final scores across NBA, NHL, MLB, NCAAB
- **Odds Cache**: Refreshed hourly, covers 187+ games across 12 sports
- **Pre-Analysis**: ~50 games analyzed per cycle across all sports
- **News Articles**: 10K+ articles from 50 RSS sources

---

*Generated April 9, 2026*
