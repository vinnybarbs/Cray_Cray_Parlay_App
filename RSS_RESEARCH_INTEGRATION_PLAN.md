# RSS Research Integration Plan
## Replacing Serper with RSS Article Data

## Current Problem

Your `research-agent.js` currently uses **Serper API** (costs money) to fetch "research" which is really just:
- Meta descriptions from Google search results
- SEO headlines like "See latest injuries..."
- Generic snippets with no real analysis

**Example of current "research":**
```
"See an updated list of injuries for the Boston Celtics. Injury news and expected return dates for all players..."
```

This tells the AI **nothing useful** - just that an injury list exists somewhere.

---

## The Solution: RSS-First Research Architecture

### Phase 1: Create RSS Research Service
### Phase 2: Wire Into Research Agent
### Phase 3: Deploy Sharp Bettor Prompt

---

# Phase 1: RSS Research Service

## New Service: `lib/services/rss-research.js`

This service queries your `news_articles` table and extracts **real facts** from article content.

### Core Functions

```javascript
class RSSResearchService {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // Main research function
  async getMatchupResearch(homeTeam, awayTeam, sport) {
    // 1. Query news_articles for team mentions (last 48 hours)
    // 2. Extract factual bullets from article content
    // 3. Return citable research with source links
  }

  // Player-specific research
  async getPlayerResearch(playerName, team, sport) {
    // 1. Query articles mentioning player name
    // 2. Extract stats, injury news, trends
    // 3. Return with article citations
  }

  // Extract facts from article content
  extractFactBullets(articleContent, teams, players) {
    // Use regex/LLM to extract:
    // - Injury updates with player names
    // - Performance stats (e.g., "scored 30+ in last 3 games")
    // - Coaching changes, lineup changes
    // - Weather/venue factors
    // - Betting line movement mentions
  }
}
```

---

## How It Works (Data Flow)

### Step 1: Query `news_articles` Table

```sql
-- For matchup research
SELECT 
  na.id,
  na.title,
  na.content,
  na.summary,
  na.link,
  na.published_at,
  ns.name as source_name
FROM news_articles na
JOIN news_sources ns ON ns.id = na.source_id
WHERE 
  (na.title ILIKE '%Lakers%' OR na.content ILIKE '%Lakers%'
   OR na.title ILIKE '%Celtics%' OR na.content ILIKE '%Celtics%')
  AND na.published_at > NOW() - INTERVAL '48 hours'
ORDER BY na.published_at DESC
LIMIT 20;
```

### Step 2: Extract Facts from Article Content

**Before (Serper):**
```
"See latest Lakers injuries and roster updates..."
```

**After (RSS):**
```
Research:
- Anthony Davis listed as questionable (ankle), missed last game (ESPN, 2h ago)
- LeBron James averaging 28.5 PPG over last 5 games, shooting 52% (CBS Sports, 4h ago)
- Lakers are 2-7 ATS as road favorites this season (Yahoo Sports, 6h ago)
- Celtics have won 8 straight at home, +12.3 point differential (Bleacher Report, 8h ago)

Sources:
- ESPN: "Lakers injury report: Davis ankle still concern" (link)
- CBS Sports: "LeBron leads Lakers surge" (link)
```

### Step 3: Pass to AI with Citations

The AI now gets **real, citable facts** instead of "see latest..."

---

# Phase 2: Wire Into Research Agent

## Modify `research-agent.js`

### Current Flow (Lines 286-291)

```javascript
// Non-NFL or no stats service: use Serper
gameResearch = await this.performSerperFallback(game, currentYear, gameDate);
const { summary: gameSummary, sources: gameSources } = this.synthesizeResearch(gameResearch, game);
combinedResearch = gameSummary;
sources.push(...gameSources);
```

### New Flow (RSS-first)

```javascript
// Try RSS research first
let rssResearch = null;
if (this.rssService) {
  console.log(`    📰 Checking RSS articles for ${game.away_team} vs ${game.home_team}`);
  try {
    rssResearch = await this.rssService.getMatchupResearch(
      game.home_team, 
      game.away_team, 
      sportKey
    );
    
    if (rssResearch && rssResearch.facts.length > 0) {
      combinedResearch = this.formatRSSForResearch(rssResearch);
      sources.push(...rssResearch.sources);
      console.log(`    ✅ RSS research: ${rssResearch.facts.length} facts from ${rssResearch.sources.length} articles`);
    }
  } catch (rssError) {
    console.log(`    ⚠️ RSS research error: ${rssError.message}`);
  }
}

// Fallback to Serper only if RSS has insufficient data
if (!rssResearch || rssResearch.facts.length < 3) {
  console.log(`    🔍 Insufficient RSS data, using Serper fallback`);
  gameResearch = await this.performSerperFallback(game, currentYear, gameDate);
  const { summary: gameSummary, sources: gameSources } = this.synthesizeResearch(gameResearch, game);
  combinedResearch = combinedResearch ? combinedResearch + ' | ' + gameSummary : gameSummary;
  sources.push(...gameSources);
}
```

---

## Expected Outcomes

### Cost Savings
- **Before**: ~$50-100/month on Serper
- **After**: ~$5/month (only fallback cases)
- **Savings**: 90-95% reduction

### Quality Improvement
- **Before**: "See latest injuries..." (useless)
- **After**: "Anthony Davis questionable (ankle), missed last game" (actionable)

### AI Analysis Improvement
- Can cite specific facts
- Can identify contradictions across sources
- Can skip games with no relevant news

---

# Phase 3: Deploy Sharp Bettor Prompt

Once RSS data is flowing, update `selectBestPicks` prompt to:

## System Prompt (Sharp Bettor)

```
You are a Sharp Sports Betting Consultant. Your goal is to identify Market Inefficiencies where Research contradicts Odds.

CORE DIRECTIVES:
1. RUTHLESS SPECIFICITY: Forbidden phrases: "solid value", "poised to", "bounce back", "momentum"
2. CITE YOUR SOURCE: Every claim must reference specific text from Research
3. IGNORE MISSING DATA: If Research is "see latest injuries", SKIP THE GAME
4. RISK/REWARD: Compare implied probability vs qualitative data

OUTPUT: JSON with picks, each with <30 word reasoning citing Research text
```

## Example Output (With RSS Data)

```json
{
  "picks": [
    {
      "id": "...",
      "pick": "Lakers +3.5",
      "odds": "110",
      "confidence": 7,
      "edge_type": "News Reaction",
      "reasoning": "Davis out (ankle per ESPN 2h ago), but LeBron 28.5 PPG last 5 (CBS). Market hasn't adjusted spread for Davis absence.",
      "sources": ["ESPN: Lakers injury report", "CBS Sports: LeBron surge"]
    }
  ]
}
```

---

# Implementation Steps

## Step 1: Create RSS Research Service

1. Create `/lib/services/rss-research.js`
2. Implement team/player article querying
3. Implement fact extraction (regex + simple patterns)
4. Test with sample queries

## Step 2: Wire Into Research Agent

1. Import RSSResearchService in `research-agent.js`
2. Initialize in constructor (pass supabase client)
3. Add RSS-first logic before Serper fallback
4. Format RSS results for AI consumption
5. Test with real games

## Step 3: Deploy & Monitor

1. Deploy updated research-agent
2. Monitor API cost savings (should drop 90%+)
3. Check AI reasoning quality (should cite real facts)
4. Adjust fact extraction patterns as needed

## Step 4: Deploy Sharp Prompt

1. Update `selectBestPicks` in analyst-agent.js
2. Add negative constraints (no filler words)
3. Add citation requirements
4. Test with RSS-powered research

---

# Technical Details

## Article Matching Strategy

### Team Name Variations
```javascript
const teamVariations = {
  'Los Angeles Lakers': ['Lakers', 'LA Lakers', 'L.A. Lakers', 'LAL'],
  'Boston Celtics': ['Celtics', 'Boston', 'BOS'],
  // ... etc
};
```

### Query Strategy
```javascript
// Build flexible search query
const teamMentions = [
  `title ILIKE '%${team}%'`,
  `content ILIKE '%${team}%'`,
  ...teamVariations[team].map(v => `title ILIKE '%${v}%' OR content ILIKE '%${v}%'`)
].join(' OR ');
```

## Fact Extraction Patterns

### Injury Updates
```javascript
// Pattern: "Player [status] ([injury])"
const injuryPattern = /([A-Z][a-z]+ [A-Z][a-z]+) (?:listed as |is |remains )(questionable|doubtful|out|probable)(?: \((.*?)\))?/gi;

// Extract: "Anthony Davis listed as questionable (ankle)"
```

### Performance Stats
```javascript
// Pattern: "Player [stat] in last [N] games"
const perfPattern = /([A-Z][a-z]+ [A-Z][a-z]+) (?:averaging|scored|has) ([\d.]+) (?:points|PPG|rebounds) (?:in|over) last (\d+) games?/gi;

// Extract: "LeBron James averaging 28.5 points over last 5 games"
```

### Trend Lines
```javascript
// Pattern: "Team [record] ATS"
const atsPattern = /([A-Z][a-z]+(?: [A-Z][a-z]+)*) (?:are|is) (\d+-\d+) ATS/gi;

// Extract: "Lakers are 2-7 ATS as road favorites"
```

---

# Fallback Strategy

RSS research will fail gracefully:

1. **No articles found** → Use Serper
2. **Articles too old (>48h)** → Use Serper
3. **No extractable facts** → Use Serper
4. **Supabase error** → Use Serper

Serper becomes **last resort**, not primary source.

---

# Monitoring & Iteration

## Metrics to Track

1. **RSS hit rate**: % of games with sufficient RSS data
2. **Serper fallback rate**: % of games needing Serper
3. **Fact extraction quality**: Manual review of extracted facts
4. **AI reasoning quality**: Does it cite specific facts?
5. **Cost savings**: Serper API usage drop

## Success Criteria

- ✅ 70%+ of games use RSS (not Serper)
- ✅ AI cites specific facts in 80%+ of picks
- ✅ Serper costs drop 90%+
- ✅ No "see latest..." style research in AI input

---

# Next Action

**Which phase do you want to start with?**

1. **Create RSSResearchService** (I'll code it now)
2. **Wire into research-agent** (after service is built)
3. **Test with real games** (verify it works)
4. **Deploy Sharp Prompt** (final polish)

I recommend we start with **#1 - Create RSSResearchService** and test it standalone before wiring it in.

Ready to build it?
