# AI Model Accuracy Tracking

## Overview

Your app now tracks **TWO separate metrics**:

1. **User Parlay Success** - Did the user's custom parlay win?
2. **AI Model Accuracy** - Of ALL suggestions AI made, what % were correct?

## Why Track Both?

**Example:**
- AI suggests **20 picks** per request
- User selects **5 picks** to build a parlay
- User's parlay loses (1 leg failed)

**Questions we answer:**
- ❓ Did user's parlay win? → **No** (tracked in `parlay_legs`)
- ❓ Were AI's suggestions accurate? → Check all **20 suggestions** (tracked in `ai_suggestions`)

**Result:** User parlay lost, but AI was 85% accurate on all suggestions!

---

## Two Tables, Two Purposes

### 1. `parlay_legs` - User Parlay Tracking
**What:** Legs the user actually selected and locked
**Purpose:** Track user's win rate and profit/loss
**Updated by:** `ParlayOutcomeChecker`

```sql
SELECT outcome FROM parlay_legs WHERE parlay_id = 'user-parlay-123';
-- Returns: won/lost/push for each leg user picked
```

### 2. `ai_suggestions` - AI Model Performance
**What:** ALL suggestions AI generated (not just user-selected)
**Purpose:** Track AI's accuracy to improve over time
**Updated by:** `AISuggestionOutcomeChecker`

```sql
SELECT actual_outcome FROM ai_suggestions 
WHERE session_id = 'session_123';
-- Returns: won/lost/push for ALL 20 suggestions
```

---

## How It Works

### Daily Cron Job (3 AM PT)

```
POST /api/cron/check-parlays
↓
1. Check User Parlays (parlay_legs)
   - Update outcome for each leg
   - Calculate parlay result (won/lost)
   - Update user dashboard

2. Check AI Suggestions (ai_suggestions)
   - Update actual_outcome for ALL suggestions
   - Calculate model accuracy %
   - Log results

Output:
{
  "parlays": { "checked": 13, "updated": 7 },
  "suggestions": { "checked": 260, "updated": 180 }
}
```

### Logs Show Model Performance

```
📊 MODEL ACCURACY: 67.3% (101W-49L out of 150 resolved suggestions)
📊 Accuracy by bet type:
   Spread: 71.2% (42W-17L)
   Moneyline: 63.8% (30W-17L)
   Total: 65.7% (23W-12L)
   Player Props: 60.0% (6W-4L)
```

---

## Frontend Display

**MainApp.jsx** shows both metrics:

```jsx
┌────────────────────────────────┐
│  Model Success Rate: 67.3%     │  ← AI accuracy (all suggestions)
│  Your Win Rate: 45.0%          │  ← User's parlay win rate
└────────────────────────────────┘
```

**Why different?**
- AI suggests safe picks (high accuracy)
- User builds risky parlays (lower win rate)

---

## Data Flow

### When User Requests Picks:

```
1. User clicks "Get Suggestions"
   ↓
2. AI generates 20 suggestions
   ↓
3. ALL 20 saved to ai_suggestions
   - actual_outcome: 'pending'
   - session_id: 'session_123'
   ↓
4. User sees suggestions on screen
```

### When User Locks Parlay:

```
1. User selects 5 picks
   ↓
2. Clicks "Lock Build"
   ↓
3. Creates parlay record
   ↓
4. Saves 5 legs to parlay_legs
   - outcome: 'pending'
   - parlay_id: 'parlay-456'
```

### Daily at 3 AM:

```
1. Cron job runs
   ↓
2. Check parlay_legs
   - Update 5 user-selected legs
   ↓
3. Check ai_suggestions
   - Update ALL 20 suggestions
   ↓
4. Calculate metrics
   - User win rate: 45% (parlays won)
   - Model accuracy: 67.3% (suggestions correct)
```

---

## Model Improvement Over Time

### What We Track:
- ✅ Which bet types AI is best at
- ✅ Confidence calibration (8/10 suggestions actually win 80%?)
- ✅ Sport-specific accuracy (NFL vs NBA)
- ✅ Time-based trends (getting better?)

### Future Enhancements:
- **Weighted Suggestions:** Show suggestions with higher historical accuracy first
- **Confidence Calibration:** Adjust confidence scores based on past performance
- **Learning Loop:** Feed outcomes back into AI prompt for better picks
- **Bet Type Specialization:** Focus on bet types AI is most accurate at

---

## Queries

### Check Model Accuracy:

```sql
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN actual_outcome = 'won' THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN actual_outcome = 'lost' THEN 1 ELSE 0 END) as losses,
  ROUND(100.0 * SUM(CASE WHEN actual_outcome = 'won' THEN 1 ELSE 0 END) / 
    NULLIF(SUM(CASE WHEN actual_outcome IN ('won', 'lost') THEN 1 ELSE 0 END), 0), 1) as accuracy
FROM ai_suggestions
WHERE actual_outcome IN ('won', 'lost');
```

### Check User Win Rate:

```sql
SELECT 
  COUNT(*) as total_parlays,
  SUM(CASE WHEN final_outcome = 'won' THEN 1 ELSE 0 END) as wins,
  ROUND(100.0 * SUM(CASE WHEN final_outcome = 'won' THEN 1 ELSE 0 END) / 
    NULLIF(COUNT(*), 0), 1) as win_rate
FROM parlays
WHERE final_outcome IN ('won', 'lost');
```

### Compare Accuracy by Bet Type:

```sql
SELECT 
  bet_type,
  COUNT(*) as total,
  SUM(CASE WHEN actual_outcome = 'won' THEN 1 ELSE 0 END) as wins,
  ROUND(100.0 * SUM(CASE WHEN actual_outcome = 'won' THEN 1 ELSE 0 END) / 
    NULLIF(COUNT(*), 0), 1) as accuracy
FROM ai_suggestions
WHERE actual_outcome IN ('won', 'lost')
GROUP BY bet_type
ORDER BY accuracy DESC;
```

---

## Testing

### Manual Trigger:

```bash
# Check outcomes now
./check_outcomes_now.sh

# Expected output:
{
  "parlays": {
    "checked": 13,
    "updated": 7
  },
  "suggestions": {
    "checked": 260,
    "updated": 180
  }
}

# Logs show:
📊 MODEL ACCURACY: 67.3% (101W-49L)
```

### Verify Data:

```bash
# Check ai_suggestions outcomes
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
supabase.from('ai_suggestions')
  .select('actual_outcome')
  .then(({data}) => {
    const outcomes = data.reduce((acc, s) => {
      acc[s.actual_outcome] = (acc[s.actual_outcome] || 0) + 1;
      return acc;
    }, {});
    console.log('AI Suggestions:', outcomes);
  });
"
```

---

## Status

✅ **Implemented and Deployed**
- AI suggestions saved on every request
- Daily cron checks both tables
- Model accuracy displayed in dashboard
- Logs show breakdown by bet type

**Next:** Wait for outcomes to accumulate over next week to see real accuracy metrics!

---

**Last Updated:** Nov 30, 2025
