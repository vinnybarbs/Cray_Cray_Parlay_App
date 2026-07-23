# UFC Fight Edge Model

Status: design + first working module (shadow ready, not wired in).
Owner: UFC model agent. Coordinator wires integration.
Module: `lib/services/edge-models/ufc-model.js`
Tests: `__tests__/lib/edge-models/ufc-model.test.js`

## 1. The problem

UFC odds flow into `odds_cache` under sport key `mma_mixed_martial_arts` (83 fights analyzed in the last 30 days). The edge calculator never grades them. `EdgeCalculator.calculateEdge` bails at step 1b when neither side has a team record or standings row, and fighters have neither. Result: 295 UFC rows in `game_analysis`, and zero UFC picks since 2026-05-09 (the 166 old `ai_suggestions` rows predate the data bail).

Verified against production (read only, 2026-07-23):

- `odds_cache` UFC rows are one row per bookmaker per market. Fighters are named in `home_team` and `away_team` (Odds API puts the favorite-side fighter in `home_team` by convention, but treat it as arbitrary). Only two books today: `draftkings` and `fanduel`. `h2h` is always present. `spreads` (round handicap) and `totals` (round total) appear sporadically and only on DraftKings.
- `game_results` has zero UFC or MMA rows. UFC settlement does not go through `game_results` at all. It goes through `lib/services/odds-api-scores.js` (Odds API `/scores`, exact name match, synthetic 1-0 score) and `ai-suggestion-outcome-checker.js`, which grades UFC as Moneyline only and returns null for any other bet type.
- `ai_suggestions.actual_outcome` already supports `won`, `lost`, `push`, `void`, `pending`. The calibration refresh only counts `won` and `lost`, so pushes and voids drop out of calibration automatically.

## 2. Data sources and cost

### Tier 0, already paid, works today

| Source | What | Cost | Cadence |
|---|---|---|---|
| The Odds API (`mma_mixed_martial_arts`) | h2h prices across books, `/scores` for results | Already in budget | Existing cron cadence, current through yesterday |

The market-only baseline in the module needs nothing else. One integration improvement: the pipeline currently collapses odds to one book (prefer DraftKings). The UFC model wants every book's h2h pair for consensus. See section 8.

### Tier 1, free, needed for the ratings blend

| Source | What | Cost | Cadence | URL |
|---|---|---|---|---|
| UFCStats.com | Official per-fight stats (FightMetric), full bout history, fighter physicals | Free (scrape) | Updated within hours of each event | http://ufcstats.com |
| Greco1899/scrape_ufc_stats | Maintained Python scraper for UFCStats, CSV output | Free | Run post event | https://github.com/Greco1899/scrape_ufc_stats |
| komaksym/UFC-DataLab | Complete UFC fight dataset including OCR-parsed judge scorecards | Free | Snapshot, refresh via scraper | https://github.com/komaksym/UFC-DataLab |
| jansen88/ufc-data | Match history, fighter stats, plus historical betting odds back to Nov 2014 | Free | Snapshot | https://github.com/jansen88/ufc-match-predictor |
| Kaggle: asaniczka UFC fighters statistics | Fighter physicals, records, stances, DOB | Free | Periodic refresh | https://www.kaggle.com/datasets/asaniczka/ufc-fighters-statistics |
| Kaggle: fatismajli UFC data | Bout-level history for backtesting | Free | Snapshot | https://www.kaggle.com/datasets/fatismajli/ufc-data |

Bootstrap plan: seed history from a Kaggle or GitHub snapshot, then keep current with the UFCStats scraper run as a weekly cron plus a post-event run. Elo needs the full chronological fight list, which any of these provide.

### Tier 2, free, nice to have

| Source | What | Notes |
|---|---|---|
| Tapology (https://www.tapology.com) | Bout announcements and changes. Best public signal for short-notice replacements (announcement date vs event date) | Scraping is brittle and ToS-sensitive. Defer |
| Sherdog (https://www.sherdog.com) | Pre-UFC fight history for debut fighters | Improves cold-start ratings |
| mmadecisions.com (https://mmadecisions.com) | Judge-by-judge scorecards | Useful for a decision-variance feature later |
| Elo reference implementations | NBAtrev/UFC-Elo-Engine, nkshv/ELO, infinitely0/mma-elo on GitHub | Design references, not dependencies |

No paid source is required for phase 1 or phase 2.

## 3. What public research says (inputs for the ratings layer)

- Elo on UFC bout history is the standard public approach (UFC-Elo-Engine and similar). Base 1500, K around 32, logistic scale 400. Public backtests generally land near or slightly below market accuracy, which is why the blend keeps the market as the prior.
- Small samples dominate. A UFC fighter has a handful of bouts a year. Ratings must carry an uncertainty term (fight count at minimum, Glicko-2 RD if we upgrade) and the blend weight must shrink toward zero on low counts.
- Decisions are noisy. About 45 to 50 percent of modern UFC fights reach the judges, and split decisions are roughly 20 percent of all decisions (818 of 4,016 decisions in one full-history sample). Bayesian work shows judges have measurable individual preferences. Practical takeaway: cap confidence on fights likely to go the distance, never publish an extreme edge that depends on winning a decision. Sources: Grappler HQ finish-rate tables (https://www.grapplerhq.com/mma/ufc-statistics/), "The Way of the Fight: An Analysis of MMA Judging" (https://trace.tennessee.edu/cgi/viewcontent.cgi?article=1432&context=jasm), Bayesian judge-preference study (https://www.sciencedirect.com/science/article/pii/S0377221723005428), bout-level statistical survey (https://arxiv.org/pdf/2401.03280).
- Age curve. Fighters peak roughly 27 to 32 and decline measurably after about 33, faster in lighter classes. Encode as a small per-year penalty past the peak band.
- Layoff. Returns after 12 or more months out underperform their pre-layoff level regardless of reason. Encode as a rating haircut that decays over the first fight back.
- Short notice. Replacements on under 30 days notice historically win well under half their fights. Needs Tapology-style announcement data, so this ships as a later adjustment, not phase 1.
- Reach and stance. Reach advantage and southpaw stance carry small positive effects, low single digits in win probability. Priors only, never the headline signal.
- Market signals. Cross-book consensus devig plus closing line movement is the strongest cheap predictor in every public MMA study. That is why the market-only baseline ships first and stays the prior forever. General references: FightTracker, real-time MMA analytics (https://arxiv.org/pdf/2312.11067) and public model repos above.

## 4. Proposed storage (schemas only, do not create yet)

```sql
-- Fighter registry. name_normalized joins Odds API names to UFCStats names.
CREATE TABLE ufc_fighters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  name_normalized text NOT NULL UNIQUE,     -- lower, diacritics stripped
  ufcstats_id     text UNIQUE,
  dob             date,
  height_in       numeric,
  reach_in        numeric,
  stance          text,                     -- Orthodox, Southpaw, Switch
  weight_class    text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Bout history, the Elo input. One row per fight, fighter order arbitrary.
CREATE TABLE ufc_fights (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ufcstats_fight_id text UNIQUE,
  event_name       text,
  event_date       date NOT NULL,
  fighter_a        uuid NOT NULL REFERENCES ufc_fighters(id),
  fighter_b        uuid NOT NULL REFERENCES ufc_fighters(id),
  winner           uuid REFERENCES ufc_fighters(id),  -- NULL for draw or NC
  method           text,   -- 'KO/TKO','SUB','DEC-U','DEC-S','DEC-M','DRAW','NC','DQ'
  round            int,
  weight_class     text,
  scheduled_rounds int,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Rating snapshots, recomputed after each event. Keep history for backtests.
CREATE TABLE ufc_ratings (
  fighter_id      uuid REFERENCES ufc_fighters(id),
  as_of           date NOT NULL,
  rating          numeric NOT NULL,          -- Elo, base 1500
  rating_deviation numeric,                  -- reserved for Glicko-2
  fights_count    int NOT NULL,
  last_fight_date date,
  weight_class    text,
  PRIMARY KEY (fighter_id, as_of)
);
```

Shadow-mode edges need no new table. `game_analysis` already stores `edges`, `edges_raw`, `calc_home_prob`, `implied_home_prob`, and `edge_factors`, and the module fills the same shape.

## 5. Probability model

Layered, market first.

1. Per book devig. Convert both American prices to implied probabilities and normalize the pair to sum to 1 (multiplicative devig, identical to the existing calculator). Overround per book is logged in factors.
2. Consensus. Median of per-book fair home probabilities across books. Median, not mean, so one stale book cannot drag the consensus. Today there are only two books, so median equals mean, but the code is written for N.
3. Ratings probability (optional). Elo logistic: `P(home) = 1 / (1 + 10^((ratingAway - ratingHome) / 400))`. Ratings come from a provider interface with one method, `getFighter(name)`, returning `{ rating, fights, lastFightDate }` or null. The provider owns weight-class handling, layoff haircuts, and age adjustments internally so the edge module stays pure. When the provider is missing, throws, or returns null for either fighter, the blend weight is zero and the market baseline stands alone.
4. Blend. `model = w * ratings + (1 - w) * consensus`, with `w = min(0.35, 0.05 * min(fightsHome, fightsAway))` and `w = 0` under 3 rated fights on either side. The market stays the majority prior at any sample size. 0.35 cap is a starting point for calibration to confirm or shrink.
5. Edges. `edges.home_ml = model_home - implied_home`, where implied comes from the devigged reference book pair (DraftKings preferred, matching what the pipeline actually bets into). `away_ml` is the exact negation. Spread, total keys are always null: UFC grades ML only (see section 6). Raw edges are stored uncapped in `edgesRaw`, published edges are multiplied by the calibration multiplier and clamped to plus or minus 15pp, same constants as the core calculator.

Output shape is byte-compatible with `EdgeCalculator.calculateEdge`, so `pickBestSide`, `edgeScoreFromCalc`, `buildPickText`, and the `game_analysis` upsert work without modification.

Devig method note: multiplicative devig is kept for v1 for consistency with the rest of the system. It slightly shades heavy favorites low (favorite-longshot bias). A power or Shin devig is a candidate upgrade once shadow data shows the bias matters at UFC price ranges (favorites out to -520 are routine).

## 6. Settlement rules

Recommendation, exact:

- Win or loss by any method (KO/TKO, submission, any decision, DQ) settles the ML pick as `won` or `lost`. Already works via `odds-api-scores` synthetic 1-0 plus `checkMoneylineOutcome`.
- Draw: settle as `push`. The current checker already returns `push` on `scoreDiff === 0` for non-soccer sports, which covers a draw if Odds API reports equal scores. Draws are under 1 percent of UFC fights.
- No contest: settle as `void`. An NC is not a push in books' grading (most books void), and `void` already exists as an outcome value.
- Fight cancelled or fighter replaced after the pick was published: settle as `void`. Replacement detection is name-based: if the completed event's fight list no longer contains both picked fighters, void.
- Calibration and W-L record: `push` and `void` are excluded automatically because the refresh only counts `won` and `lost`. No change needed there.

What the settlement pipeline needs to handle this (changes for the coordinator, not made here):

1. Verify what Odds API `/scores` returns for a UFC draw and an NC (equal scores, missing scores, or the event absent). If NC comes back as equal scores it will settle as `push` when it should be `void`. Needs one live observation or a support question to Odds API.
2. Add a staleness rule: a UFC ML pick still `pending` N days (suggest 3) after `commence_time` with no `/scores` match becomes `void`, which covers scratched fights and replacements without a Tapology feed.
3. Keep UFC restricted to Moneyline. The checker already returns null for UFC spreads and totals. The model never emits them, so nothing new can leak through.

## 7. Calibration plan

- New picks carry `pipeline_version` 6 or above like everything else, plus tier via `pickGrader.edgeTier`.
- Seed `edge_calibration` with a manual conservative row before any publish: `('UFC:ml', 0.50, NULL, NULL, 'seed-shadow-phase')`. Without a row, UFC falls to `__global__` 0.75, which is too generous for an unproven model.
- The weekly `refresh_edge_calibration` needs 80 settled picks per sport-market over 120 days. UFC volume is roughly 10 to 14 fights a week but only a fraction clear 2pp, so expect the by-market threshold to take months. That is fine: shadow mode (below) measures k offline from `game_analysis.edges_raw` against results before a single pick publishes, using every fight rather than only published picks.
- Shadow measurement: regression through origin of realized excess win rate on raw claimed edge, exactly the k the refresh computes, run manually (SQL over `game_analysis` joined to settled results) after 60 or more settled shadow fights.

## 8. Phased rollout

Phase 0, wiring (coordinator): integrate module in shadow configuration. No user-visible change.

Phase 1, shadow mode: compute and store edges on every UFC fight in `game_analysis` (`edges`, `edges_raw`, probabilities, factors) but publish nothing to `ai_suggestions`. Mechanism: add `'UFC'` to a new `SHADOW_SPORTS` set in `pre-analyze-games.js` that allows edge computation and storage but skips the auto-save block, mirroring how `PREVIEW_ONLY_SPORTS` gates soccer today (soccer skips even the math pick, shadow should keep the math pick for display honesty but skip the record insert). Exit criteria: 60+ settled shadow fights, measured k greater than 0 with the market-only baseline or the blend, and settlement verified for at least one draw or NC or scratch case.

Phase 2, publish: remove UFC from `SHADOW_SPORTS`, set the `UFC:ml` calibration multiplier from measured k (clamped 0 to 1.2 like the refresh does), publication gate unchanged: 2pp or better publishes actionable, negative publishes as Trap, 0 to 2pp stays Skip and display-only.

Phase 3 (later): ratings ingestion cron, layoff and age adjustments inside the provider, short-notice via Tapology, method-of-victory and round-total markets only if per-round settlement data lands.

## 9. Integration notes (exact changes, NOT made in this task)

`api/cron/pre-analyze-games.js`:

1. `getUpcomingGames` keeps one book per market (prefers DraftKings). For MMA, also collect every `h2h` row per fight into `game.booksH2h = [{ bookmaker, outcomes }]` during the same grouping pass. One added array, no behavior change for other sports.
2. In the per-game loop where `edgeCalc.calculateEdge(game)` runs (around line 894), branch first: `if (game.sport === 'mma_mixed_martial_arts') { edgeData = await computeUfcEdge({ ...game, books: game.booksH2h }, { ratings: null, calibrationMultiplier: ufcCalMult }); }`. `ufcCalMult` comes from the same `edge_calibration` table (key `UFC:ml`, fallback `__global__`), fetched once per run.
3. Add `SHADOW_SPORTS = new Set(['UFC'])` and guard the auto-save block (around line 1032) with `!SHADOW_SPORTS.has(sportDisplay)`. Everything upstream (edge storage, math pick, tier, display) proceeds so the digest can show what the math sees.
4. `buildPickText` and `resolveOddsForSide` already handle `home_ml` and `away_ml` generically. No change.

`lib/services/edge-calculator.js`:

- Option A (preferred): no change at all. The cron branches before calling it.
- Option B: inside `calculateEdge`, when `sportName === 'UFC'`, delegate to the UFC module and return its result. Cleaner call sites, but it puts a require of the new module inside the old one. Coordinator's call.
- Either way, expose or duplicate the calibration lookup. The module takes a plain `calibrationMultiplier` number precisely so it does not need Supabase.

`lib/services/ai-suggestion-outcome-checker.js` and `odds-api-scores.js`: section 6 items 1 and 2 (NC verification, pending-to-void staleness rule).

## 10. Open questions for the coordinator

1. Odds API representation of draws, NCs, and scratched fights in `/scores`. Blocks correct void handling. One observed event or a support ticket resolves it.
2. Shadow mechanism preference: `SHADOW_SPORTS` skip-the-insert (recommended, simplest) vs writing `ai_suggestions` rows with a `shadow_` session prefix excluded from the record. The second gives settled shadow picks for free through the existing checker, which is a real point in its favor. If chosen, the record queries must exclude the prefix everywhere.
3. Ratings ingestion ownership: which cron host runs the UFCStats scraper (Python) or do we port a minimal scraper to Node. Phase 3 decision.
4. Fighter name normalization: Odds API vs UFCStats spelling drift (diacritics, "Jr.", transliterations of Dagestani names). Propose a `name_normalized` join plus a manual alias table when the ratings layer lands.
5. Only two books currently cached. Consensus over two books is weak. Is adding more bookmakers to the Odds API pull (regions parameter) in budget? More books directly strengthens the market-only baseline.
6. The 0.35 ratings weight cap and 0.05 per-fight ramp are priors, not measurements. Confirm or refit from shadow data.
