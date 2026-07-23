# Tennis Edge Model

Status: design plus first-cut module. Nothing here changes existing files. The module lives at `lib/services/edge-models/tennis-model.js` with tests at `__tests__/lib/edge-models/tennis-model.test.js`.

## Why tennis never graded

`EdgeCalculator.calculateEdge` bails when a side has neither a `game_results` record nor a `current_standings` row (the section 1b hard bail). Tennis players have neither, so every one of the 395 tennis rows in `game_analysis` over the last 30 days carries null edges, no `recommended_side`, and no pick. The bail is correct. The old fallback produced fake +45pp edges on longshots like Pellegrino against Sinner. The fix is a tennis-native model, not a softer bail.

## Model summary

The model blends two signals into a home win probability, then scores per-side moneyline edges against the book we would actually bet.

1. Market consensus prior. Devig each book's two-way moneyline, take the median fair home probability across books. This works today with zero new data.
2. Surface Elo. When a ratings provider returns Elo for both players, blend it in at a starting weight of 0.30. Missing ratings degrade cleanly to the market-only baseline.

The edge for a side is model probability minus the devigged probability at the bet book, times the calibration multiplier, capped at plus or minus 15pp. Positive means value, negative means trap, identical to the team-sport convention. Output shape matches `edge-calculator` exactly, so `pickBestSide`, `edgeScoreFromCalc`, `pick-grader.edgeTier`, and the 2pp publication gate in `pre-analyze-games.js` need no tennis-specific logic.

Phase 1 is moneyline only. The `edges` dict still carries `home_spread`, `away_spread`, `over`, `under` keys as null so downstream consumers see the familiar shape.

## Research grounding

- Closing odds carry most of the predictive information in tennis. Adding player features to an odds baseline barely moves accuracy. This is why the market is the prior and Elo is a 0.30 tilt, not the other way around. Sources: [Kovalchik-style model comparison at Tennis Abstract](https://www.tennisabstract.com/blog/2017/01/15/measuring-the-performance-of-tennis-prediction-models/), [comparative Elo and ML study, 2024](https://journals.sagepub.com/doi/10.1177/17543371231212235), [NTU study on Elo-based tennis prediction](https://irep.ntu.ac.uk/id/eprint/42038/1/1400774_Vaughan_Williams.pdf).
- Surface-specific Elo beats overall Elo, and a 50/50 blend of overall and surface rating is the standard Tennis Abstract construction. Sources: [Tennis Abstract on Elo](https://www.tennisabstract.com/blog/2022/02/07/the-purpose-of-elo-ratings/), [Berkeley SAG overview](https://sportsanalytics.studentorg.berkeley.edu/articles/elo-system-tennis.html).
- Best-of-5 favorites are more reliable. Slam favorites win about 78 percent of matches against roughly 68 percent at best-of-3 events. The module converts a best-of-3 Elo probability to best-of-5 by inverting the set probability, which reproduces that compression without a fitted constant. Sources: [Five sets for favourites](https://evidently.substack.com/p/five-sets-for-favourites), [Bet Angel on format variance](https://www.betangel.com/best-of-three-or-five-sets-tennis/).
- Favorite-longshot bias is strong at tennis prices, which routinely hit -500 and beyond. Proportional devig overstates the longshot, so the default devig is the power method. Same sources as above plus standard devig literature.

## Data sources and cost

| Source | What | Cost | Cadence | URL |
| --- | --- | --- | --- | --- |
| The Odds API (already in use) | ATP and WTA h2h prices per tournament key | current plan, no new cost | each odds sync cron run | https://the-odds-api.com/sports/tennis-odds.html |
| Jeff Sackmann tennis_atp | ATP match results, rankings, player file, 1968 to present | free, CC BY-NC-SA 4.0 | irregular, roughly weekly to monthly pushes | https://github.com/JeffSackmann/tennis_atp |
| Jeff Sackmann tennis_wta | WTA equivalent | free, same license | same | https://github.com/JeffSackmann/tennis_wta |
| Tennis Abstract weekly Elo reports | ready-made overall and surface Elo tables | free to view | weekly | https://tennisabstract.com/reports/atp_elo_ratings.html |
| Our own odds_cache history | line movement, closing prices | free | already stored | internal |

License warning. The Sackmann datasets and Tennis Abstract pages are CC BY-NC-SA, non-commercial. TrapHawk is a commercial product. Two ways through, and the coordinator should pick one. Option A, use Sackmann only to backtest and validate, then maintain our own Elo computed from results we ingest ourselves (an Elo number we compute from public match results is our own derived work, seeding methodology is the question). Option B, license or buy a results feed (Goalserve tennis is about $50 per month, Sportradar is enterprise priced) and compute Elo from that. Either way the module does not care where ratings come from, that is the point of the provider interface.

Match results for settlement and Elo maintenance can also come from the existing `odds_api_scores` path if The Odds API scores endpoint covers the tennis keys we fetch. Verify during phase 0.

## Proposed schema (do not create yet)

```sql
-- Canonical player registry. Odds API names are the join key we control.
CREATE TABLE tennis_players (
  id            bigserial PRIMARY KEY,
  canonical_name text NOT NULL,          -- "Jannik Sinner"
  tour          text NOT NULL,           -- 'atp' | 'wta'
  aliases       text[] DEFAULT '{}',     -- Odds API and Sackmann spellings
  sackmann_id   integer,                 -- players file id when matched
  created_at    timestamptz DEFAULT now(),
  UNIQUE (canonical_name, tour)
);

-- One row per player per surface bucket, refreshed after each result batch.
CREATE TABLE tennis_elo_ratings (
  player_id     bigint REFERENCES tennis_players(id),
  surface       text NOT NULL,           -- 'all' | 'hard' | 'clay' | 'grass'
  elo           numeric NOT NULL,
  matches       integer NOT NULL DEFAULT 0,
  last_match_at date,
  updated_at    timestamptz DEFAULT now(),
  PRIMARY KEY (player_id, surface)
);

-- Results log. Feeds Elo updates, fatigue windows, and settlement.
CREATE TABLE tennis_match_results (
  id            bigserial PRIMARY KEY,
  tour          text NOT NULL,
  tournament    text,
  surface       text,
  best_of       smallint,
  match_date    date NOT NULL,
  winner_id     bigint REFERENCES tennis_players(id),
  loser_id      bigint REFERENCES tennis_players(id),
  score         text,
  finish_type   text NOT NULL DEFAULT 'completed',  -- 'completed' | 'retired' | 'walkover' | 'defaulted'
  source        text,
  UNIQUE (tour, match_date, winner_id, loser_id)
);
```

Ratings provider implementation is then a thin class with `getRating({ name, tour, surface })` that resolves the alias, reads `tennis_elo_ratings` for `all` plus the match surface, and counts `tennis_match_results` rows in the trailing 14 days for the fatigue input. The module already consumes exactly that contract.

Elo maintenance rules for the ingest job. K factor 32 with the usual divisor decay by match count (Tennis Abstract uses K = 250 / (matches + 5)^0.4, adopt that). Walkovers never update Elo. Retirements update Elo only for the overall rating, at half K, since the loser was on court but the result is noisy. New players start at 1500.

## Probability model detail

1. Per book, raw implied probabilities from American prices.
2. Devig per book with the power method. Solve `pHome^k + pAway^k = 1` for k by bisection, then normalize. Symmetric markets give 50/50, lopsided markets give the longshot less than proportional devig would, which is the direction the favorite-longshot bias demands. Multiplicative devig stays available behind an option for calibration comparisons.
3. Consensus is the median of per-book fair home probabilities. Median, not mean, so one stale book cannot drag the prior. The spring tennis rows in odds_cache carried only DraftKings and FanDuel, where median equals mean. The odds sync requests six books and other sports show five, so tennis coverage should widen as the new tournament keys return data. See open questions.
4. Elo probability when ratings exist for both players. Effective rating is a 50/50 blend of overall and surface Elo. Win expectancy is the standard logistic with a 400 divisor. Treat that as a best-of-3 probability. For best-of-5 matches, invert to a per-set probability through `m = s^2(3 - 2s)` and recompute with the best-of-5 polynomial `s^3(10 - 15s + 6s^2)`.
5. Fatigue. If both players carry a matches-in-last-14-days count, each match past 4 costs 0.5pp of the Elo probability, capped at 2pp per player, applied as a differential. The market usually prices schedules, so this touches the Elo term only.
6. Blend. `model = 0.70 * consensus + 0.30 * elo`. Weight is an option so calibration can tune it.
7. Edges. `home_ml = model - fairAtBetBook(home)`, away is the mirror. Multiply by the calibration multiplier, cap at 15pp. `edgesRaw` keeps the uncalibrated values for the weekly refresh, matching the team-sport pipeline.

Head-to-head records are deliberately out of the first cut. Samples are tiny, surface-confounded, and largely priced in. Revisit only if shadow-mode calibration shows a residual the market misses.

## Devig method choice

Power devig is the default because tennis routinely prices favorites past -500, where proportional devig hands the longshot several points of probability it does not deserve. The two methods agree at even prices and diverge exactly where tennis needs the correction. Shadow mode should log both (the factors payload records which method ran) and calibration decides if the default holds.

## Settlement rules for retirements and walkovers

Books disagree, so our graded record needs one house rule applied consistently.

- DraftKings voids a match bet when the match does not reach its natural end unless the outcome was already unconditionally determined, with a one-set rule for ATP and majors. See [DraftKings tennis rules](https://sportsbook.draftkings.com/help/sport-rules/tennis).
- FanDuel grades the advancing player as the winner on any retirement after the match starts. See [Action Network summary](https://www.actionnetwork.com/tennis/tennis-betting-rules-player-retires-rain-weather-delay) and [The Wager Theorem comparison](https://thewagertheorem.com/tennis-betting-retirement-rules/).

Recommendation for TrapHawk's record:

1. Walkover before the first point: void. Do not grade, do not count either way. Remove the pick from the record with a `void` outcome.
2. Retirement after at least one completed set: grade the advancing player as the winner. This matches FanDuel and the majority of offshore books, keeps our record mostly gradeable, and avoids the DraftKings ambiguity around "unconditionally determined".
3. Retirement before one completed set: void.
4. Defaults and disqualifications: same as retirement rules by sets completed.

Store `finish_type` on the result row so the settlement job can re-grade if the house rule ever changes. The outcome checker must also handle `void` as a terminal state distinct from `won` and `lost` so calibration excludes those rows.

## Calibration plan

Reuse the existing `edge_calibration` machinery unchanged.

- Keys: `Tennis:ml` and `Tennis`. Seed `Tennis:ml` at 0.75 with source `seed-tennis-phase2` only when publication turns on. Do not seed 0. A 0 multiplier zeroes edges and would blind the measurement, the soccer suspension comments in the migration explain the trap.
- During shadow mode the calibration multiplier passed to the module stays 1 so `edges` and `edges_raw` reflect the raw model. Calibration has nothing to multiply until real settled picks exist.
- The weekly `refresh_edge_calibration` function already computes k as the regression-through-origin slope of realized excess win rate on claimed edge, needing 80 settled picks per market key. Tennis flows in automatically once picks publish with `pipeline_version >= 6`, `bet_type = 'Moneyline'`, and `edge_pp_raw` set.
- Shadow-mode measurement happens before that. Because shadow picks never enter `ai_suggestions`, run the same slope query against `game_analysis` rows joined to `tennis_match_results` (or `odds_api_scores`) on player names and date. A read-only SQL notebook is enough, no new infrastructure.

## Phased rollout

Phase 0, data plumbing (blocked on the coordinator's slug fix for year-round coverage).

- Extend the odds sync to store more bookmakers for tennis keys. The Odds API returns all books in one request, so this costs zero extra credits and turns the consensus from 2 books into 6 plus.
- Stand up the three tables above, backfill Sackmann histories for validation, and start the results ingest.

Phase 1, shadow mode.

- Wire the module into the analysis cron (integration notes below) so tennis rows in `game_analysis` get `edges`, `edges_raw`, `calc_home_prob`, `edge_factors` populated.
- Gate publication off for tennis with an explicit check, not a calibration zero. Suggested: a `SHADOW_SPORTS` set (`new Set(['Tennis'])`) next to the existing `PREVIEW_ONLY_SPORTS` in `pre-analyze-games.js`. Shadow computes and stores everything but skips the `ai_suggestions` insert.
- Run through at least one slam plus the following swing, target 150 plus settled shadow edges with absolute value of 1pp or more, then measure k.

Phase 2, publish.

- If measured k is meaningfully positive (k of 0.5 or better on 150 plus matches), seed `Tennis:ml` at `min(k, 0.75)`, remove Tennis from `SHADOW_SPORTS`, and let the normal 2pp gate and tier ladder take over. Trap reads (negative edge) publish under the same rules as other sports.
- The weekly refresh takes ownership of the multiplier from there.

## Integration notes (changes NOT made here, for the coordinator)

`api/cron/pre-analyze-games.js`

1. `getUpcomingGames` currently collapses to one book per market (DraftKings preferred). Keep that for team sports, but also collect per-book h2h rows per game, for example `games[key].bookRows.push({ bookmaker: row.bookmaker, market_type: row.market_type, outcomes: row.outcomes })`. The tennis module ships `booksFromOddsRows(rows, homeTeam, awayTeam)` to consume exactly that.
2. Where `edgeCalc.calculateEdge(game)` is called (around line 894), branch on tennis first. Pseudocode, do not paste blindly:

```js
const tennisModel = require('../../lib/services/edge-models/tennis-model');
if (slugToSport(game.sport) === 'Tennis') {
  edgeData = await tennisModel.calculateTennisEdge({
    home_player: game.home_team,
    away_player: game.away_team,
    books: tennisModel.booksFromOddsRows(game.bookRows, game.home_team, game.away_team),
    best_of: isSlam(game.sport) && game.sport.includes('atp') ? 5 : 3,
    surface: surfaceForSlug(game.sport),
    tour: game.sport.includes('wta') ? 'wta' : 'atp',
  }, { ratings: tennisRatingsProvider, calibrationMultiplier: tennisCalMult });
} else {
  edgeData = await edgeCalc.calculateEdge(game);
}
```

   `isSlam` and `surfaceForSlug` are small lookup maps on the tournament slug (french_open is clay, wimbledon is grass, everything else in the current list is hard, best-of-5 applies to ATP slams only). `tennisCalMult` reads the same `edge_calibration` cache under key `Tennis:ml`, default 1.
3. Publication gate: add the shadow check. `if (SHADOW_SPORTS.has(sportDisplay)) skip the ai_suggestions block`, everything else (record building, `edges` storage, tile display) stays.
4. `mathPick` and `buildPickText` already handle `home_ml` and `away_ml`, no change.

`lib/services/edge-calculator.js`

- No change required. The tennis branch lives in the cron, which keeps the team-sport class untouched. Optional cleanup later: move the tennis slugs out of `SLUG_TO_SPORT` comments that imply the class handles them.

`lib/services/pick-grader.js`

- No change. `edgeTier` and `buildPickText` are market-agnostic.

Migrations, when phase 0 starts

- The three tennis tables above.
- Phase 2 only: `INSERT INTO edge_calibration (key, multiplier, source) VALUES ('Tennis:ml', <seeded k>, 'seed-tennis-phase2')`.

## Open questions for the coordinator

1. `normalized_odds_outcomes` exists but refreshes every 30 minutes over current odds only, so it cannot backtest by itself. The historical join is `closing_lines` against `game_results`. Shadow measurement joins `game_analysis` to results directly as described above.
2. Tennis rows in odds_cache have carried only DraftKings and FanDuel so far, even though the sync requests six books and other sports show five. Confirm tennis coverage widens once the new tournament keys land. The consensus signal is weak with two books, and the market-only baseline mostly measures DraftKings against FanDuel until it does.
3. Sackmann data license is non-commercial. Decide option A (validate with it, run our own Elo from an ingested results feed) or option B (paid feed from day one). My recommendation is A for phase 0 and 1, with a feed decision before phase 2.
4. Player name normalization. Odds API uses display names ("Jannik Sinner"), Sackmann uses separate first and last fields, and diacritics differ (Muchova vs Muchová). The aliases column handles it, but someone needs to own the initial mapping for the top 300 or so of each tour.
5. Does The Odds API scores endpoint return tennis results for our keys? If yes, settlement and Elo maintenance ride the existing `odds_api_scores` path and the results table just normalizes it. Needs a one-day probe when tennis odds flow again.
6. Doubles and team events (Davis Cup, United Cup, Laver Cup) should be excluded by slug until the model is proven on singles. Confirm the coordinator's slug list separates them.
7. WTA best-of-3 applies everywhere including slams. The integration snippet assumes that. Confirm no WTA best-of-5 exhibition keys sneak in.
8. game_analysis stores tennis under `home_team` and `away_team` with an arbitrary home assignment from the odds feed. Tennis has no home side. Fine for storage, but the UI should say "Player A vs Player B", not imply venue advantage. Frontend owner should know.
