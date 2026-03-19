# 🧠 AI Learning Loop System

## Overview

The learning loop system analyzes settled picks (especially losses) to extract insights and improve future predictions. The AI learns from its mistakes and successes, creating a continuously improving prediction engine.

---

## How It Works

```
1. Picks Generated → Users Lock Parlays
2. Games Complete → Settlement Runs
3. Outcomes Recorded (Won/Lost/Push)
4. AI Analyzes Each Outcome ← LEARNING HAPPENS HERE
5. Insights Stored in Database
6. Future Picks Reference Historical Lessons
```

---

## Setup Instructions

### Step 1: Add Database Columns

Run in Supabase SQL Editor:
```bash
# File: database/add-learning-columns.sql
```

This adds:
- `post_analysis` TEXT - AI's analysis of why pick won/lost
- `lessons_learned` JSONB - Structured insights
- `analyzed_at` TIMESTAMPTZ - When analysis was done
- Indexes for performance
- `learning_insights` view for easy querying

### Step 2: Deploy Backend

The learning system is already integrated into your backend:
- ✅ `/api/analyze-outcomes` - Analyzes recent settled picks
- ✅ `/api/lessons` - Fetches relevant lessons
- ✅ `/api/performance-summary` - Performance by category

### Step 3: Run Initial Analysis

After picks have settled:
```bash
curl -X POST https://craycrayparlayapp-production.up.railway.app/api/analyze-outcomes
```

Response:
```json
{
  "success": true,
  "message": "Analyzed 7 picks",
  "analyzed": 7
}
```

---

## Usage

### Automatic Learning (Recommended)

Add to your settlement cron or call after `/api/check-parlays`:

```javascript
// After settlement runs
await fetch('https://your-backend.com/api/analyze-outcomes', {
  method: 'POST'
});
```

### Manual Trigger

```bash
# Analyze all unanalyzed outcomes
curl -X POST https://your-backend.com/api/analyze-outcomes

# Get lessons for NFL spreads
curl "https://your-backend.com/api/lessons?sport=NFL&betType=Spread"

# Get performance summary
curl https://your-backend.com/api/performance-summary
```

---

## What Gets Analyzed

For each settled pick, AI examines:

1. **Original Reasoning** - What factors did we consider?
2. **Actual Outcome** - Did it win or lose?
3. **Why It Happened** - Root cause analysis
4. **Patterns** - Recurring themes
5. **Lessons** - What to do differently

### Example Analysis:

**Pick**: Ravens -6.5 vs Browns  
**Reasoning**: "Ravens strong defense, Browns struggling"  
**Outcome**: LOST (Ravens won by 3)

**AI Analysis**:
```
Division rivalry games consistently beat the spread by smaller 
margins than regular matchups. Ravens defense was strong BUT 
Browns rivalry intensity closed the gap.

LESSON: Reduce confidence on division games. Avoid large spreads 
in rivalry matchups. Pattern detected: 3 similar division favorites 
failed to cover this season.
```

**Stored Insights**:
```json
{
  "outcome": "lost",
  "sport": "NFL",
  "bet_type": "Spread",
  "confidence_was": 8,
  "patterns": ["Division rivalry games beat spread by less"],
  "recommendations": ["Reduce confidence on division matchups by 2 points"]
}
```

---

## How AI Uses Lessons

When generating new picks, the system:

1. **Fetches Relevant Lessons** - Gets 10 most recent lessons for the sport
2. **Injects into AI Prompt** - Adds "HISTORICAL LESSONS" section
3. **AI Adjusts** - Modifies confidence, avoids similar mistakes
4. **Learns Patterns** - Recognizes situations that led to losses

### Example Prompt Addition:

```
**=== HISTORICAL LESSONS ===**

Lesson 1: NFL Spread
- Pick: Ravens -6.5
- Outcome: LOST
- Analysis: Division games consistently beat spread by smaller margins...
- Key Insight: Avoid large spreads in rivalry matchups

**LEARNING DIRECTIVE**:
- Use these past outcomes to inform your current analysis
- Avoid similar mistakes that led to losses
- Replicate patterns that led to wins
```

---

## Database Queries

### View All Lessons
```sql
SELECT * FROM learning_insights;
```

### Check Analyzed Picks
```sql
SELECT 
  sport,
  bet_type,
  pick,
  actual_outcome,
  post_analysis,
  analyzed_at
FROM ai_suggestions
WHERE analyzed_at IS NOT NULL
ORDER BY analyzed_at DESC
LIMIT 20;
```

### Performance by Category
```sql
SELECT 
  sport,
  bet_type,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losses,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
    COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')),
    1
  ) as win_rate
FROM ai_suggestions
WHERE analyzed_at IS NOT NULL
GROUP BY sport, bet_type
ORDER BY win_rate DESC;
```

---

## API Reference

### POST /api/analyze-outcomes
Analyzes all unanalyzed settled picks.

**Request**: None  
**Response**:
```json
{
  "success": true,
  "analyzed": 7
}
```

### GET /api/lessons
Get relevant lessons for specific criteria.

**Query Params**:
- `sport` (optional): Filter by sport (e.g., NFL, NBA)
- `betType` (optional): Filter by bet type (e.g., Spread, Moneyline)
- `limit` (optional): Number of lessons (default: 10)

**Response**:
```json
{
  "success": true,
  "lessons": [...],
  "count": 10
}
```

### GET /api/performance-summary
Get win/loss stats by category.

**Response**:
```json
{
  "success": true,
  "summary": {
    "NFL-Spread": {
      "wins": 4,
      "losses": 3,
      "winRate": 0.571,
      "avgConfidence": 7.2
    }
  }
}
```

---

## Benefits

✅ **Continuous Improvement** - AI learns from every outcome  
✅ **Pattern Recognition** - Identifies systematic issues  
✅ **Confidence Calibration** - Adjusts based on historical accuracy  
✅ **Mistake Avoidance** - Remembers what didn't work  
✅ **Success Replication** - Doubles down on winning patterns  

---

## Future Enhancements

- Dashboard UI to view insights
- Confidence adjustment algorithms
- Pattern detection automation
- Team-specific learning
- User vs model comparison
- A/B testing of strategies

---

## Troubleshooting

**No analysis happening?**
- Check that picks have `actual_outcome` set (not 'pending')
- Verify `OPENAI_API_KEY` is set in environment
- Check Railway logs for errors

**Lessons not showing in picks?**
- Verify lessons are being fetched (check coordinator logs)
- Ensure `analyzed_at` is not null in database
- Check that sport/betType filters are correct

**Want to re-analyze?**
```sql
-- Clear analysis to re-run
UPDATE ai_suggestions 
SET post_analysis = NULL, 
    lessons_learned = NULL, 
    analyzed_at = NULL
WHERE id IN (SELECT id FROM ai_suggestions LIMIT 10);
```

Then run `/api/analyze-outcomes` again.
