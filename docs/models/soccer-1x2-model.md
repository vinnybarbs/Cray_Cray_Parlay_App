# Soccer 1X2 Edge Model Design

Status: design plus first working module, 2026-07-23.
Module: `lib/services/edge-models/soccer-1x2.js` (new file, not yet wired in).
Tests: `__tests__/lib/edge-models/soccer-1x2.test.js`.

## Why this exists

Soccer v1 was scrapped on 2026-07-12. It reused the two-way edge calculator,
which normalized home and away implied probabilities to 1 and never priced
the draw. Roughly 25 percent of matches end level (35 of 149 MLS finals and
20 of 71 EPL finals in `game_results` as of today), so every two-way soccer
probability was structurally wrong. Both EPL and MLS calibration multipliers
were seeded to 0 and the sport was parked in `PREVIEW_ONLY_SPORTS`. The 2026
World Cup passed with no published picks.

The fix is a three-outcome model. Home, draw, and away each get a
probability, an implied market probability, and a signed edge. The draw
becomes a pickable side with its own settlement rule.

Confirmed in prod data: `odds_cache` h2h rows for `soccer_epl` and
`soccer_usa_mls` already carry three outcomes per bookmaker, with the third
named `Draw` (checked 2026-07-23, all 47 current soccer h2h rows have a Draw
outcome). No odds ingestion change is needed.

## Model design

Two layers, blended.

### Layer 1: market consensus (shipping now)

Per bookmaker, convert the three American prices to raw implied
probabilities. The sum exceeds 1 by the overround. Remove the overround with
Shin's method per book, take the component-wise median across books, and
renormalize. This is the market-only fair probability vector. It is the
model output until the goal model has data, and the anchor after that.

### Layer 2: goal model (data plan below, math shipped)

Dixon and Coles (1997) model each team with an attack strength, a defense
strength, and a shared home advantage. Expected goals for the home side are
home attack times away defense times the league home-goal baseline, and
symmetrically for the away side. Scoreline probabilities come from two
Poisson counts with a low-score dependence correction tau applied to the
0-0, 1-0, 0-1, and 1-1 cells, controlled by a parameter rho. A negative rho
moves mass into 0-0 and 1-1, which fixes the known Poisson habit of
underpricing draws. Fitting uses maximum likelihood with an exponential
time-decay weight on older matches so team strength tracks form.

Karlis and Ntzoufras (2003) offer the main alternative: a bivariate Poisson
with an explicit covariance term, extended with diagonal inflation to
improve draw prediction. It fits draws slightly better in some leagues but
costs more parameters and a harder fit. Recommendation: start with
Dixon-Coles. It is the industry default, it has one dependence parameter,
and the module's tau plumbing already supports it. Revisit bivariate
Poisson only if backtest calibration shows persistent draw underpricing.

The shipped module implements the scoreline grid, the tau correction, and
the attack-times-defense expected goals mapping. What is missing is the
fitted parameters, which is a data ingestion and fitting job, not a math
job. Until a `soccer_team_strength` row exists for both teams, the module
returns null from the goal model layer and stays market-only. That contract
is tested.

### Blend

`model = (1 - w) * shin_consensus + w * goal_model`, renormalized, with
w defaulting to 0.35. The market stays the anchor because a market blend
protects against stale or badly fitted team strengths. w should be tuned in
the backtest by minimizing log loss, and can differ by league.

## Data ingestion plan

Primary source: football-data.org v4 API, free tier. Covers EPL, the FIFA
World Cup, the European Championship, Champions League, and seven other
leagues with fixtures, results, and standings. Limit is 10 calls per minute
on the free tier, and the maintainer states the free competitions stay free.
Cost: 0 dollars. Gap: no MLS and no xG.

MLS results: already flowing into `game_results` via the existing ESPN
results path, which is how the 149 MLS finals got there. Goals for and
against per match are sufficient to fit Dixon-Coles. xG is an upgrade, not
a requirement.

xG sources, evaluated:

- Understat: free site with xG per match for the top five European leagues
  plus RFPL. No official API and no published terms that authorize scraping.
  Community scrapers read JSON embedded in script tags. Risk: terms are
  unstated, breakage is common, MLS is absent. Verdict: do not build a
  dependency on it. Optional manual research input only.
- FBref (Sports Reference): xG for many leagues including MLS. Site terms
  prohibit commercial redistribution without a license and rate-limit bots
  aggressively. TrapHawk is a commercial product. Verdict: not without a
  paid data license from Sports Reference or their partner StatsBomb.
- Paid APIs (Opta, StatsBomb, API-Football): real licenses, real cost
  (roughly 30 to several hundred dollars per month at the entry tiers).
  Verdict: defer until the goals-only model proves an edge worth upgrading.

Recommendation: fit v1 on goals only, from `game_results` (MLS, EPL) plus
football-data.org backfill for deeper EPL history and tournament coverage.
Zero data cost. Add xG only when a licensed source is justified.

### Proposed tables (schemas only, do not create yet)

```sql
-- Raw match ingest, one row per source match. Idempotent upsert target.
CREATE TABLE soccer_matches_raw (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source           text NOT NULL,             -- 'football-data.org' | 'espn'
  source_match_id  text NOT NULL,
  league           text NOT NULL,             -- 'EPL', 'MLS', 'World Cup'
  season           text,
  utc_date         timestamptz NOT NULL,
  home_team        text NOT NULL,
  away_team        text NOT NULL,
  home_goals       int,                        -- 90-minute goals
  away_goals       int,
  went_to_extra_time boolean DEFAULT false,
  status           text NOT NULL,              -- 'scheduled' | 'final'
  ingested_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_match_id)
);

-- Fitted team strengths, refreshed by a weekly fit job.
CREATE TABLE soccer_team_strength (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league           text NOT NULL,
  team_name        text NOT NULL,              -- odds_cache display name
  attack           numeric NOT NULL,           -- multiplicative, mean 1.0
  defense          numeric NOT NULL,           -- multiplicative, mean 1.0
  matches_used     int NOT NULL,
  fit_loglik       numeric,
  as_of            date NOT NULL,
  UNIQUE (league, team_name, as_of)
);

-- League-level fit constants shared by every match in the league.
CREATE TABLE soccer_league_params (
  league             text NOT NULL,
  as_of              date NOT NULL,
  league_home_goals  numeric NOT NULL,         -- baseline lambda, home side
  league_away_goals  numeric NOT NULL,
  rho                numeric NOT NULL,         -- Dixon-Coles dependence
  time_decay_xi      numeric,                  -- fit weight half-life input
  PRIMARY KEY (league, as_of)
);
```

Team-name join risk: football-data.org names ("Wolverhampton Wanderers FC")
differ from odds_cache names. A static mapping table or reuse of
`lib/services/static-team-mapping.js` conventions is required. This burned
the pipeline before (New England Revolution vs England). Map by explicit
table, never by substring.

## Devig method comparison and recommendation

Three candidates for removing the three-way overround, all supported in the
literature and in the R `implied` package:

1. Proportional (multiplicative). Divide each raw implied probability by the
   booksum. One line, no iteration. Weakness: it spreads the margin
   proportionally, but books concentrate margin on longshots
   (favorite-longshot bias), so proportional overstates longshot
   probabilities. In a 1X2 market the draw and the underdog are usually the
   longshots, so this bias lands exactly where the model needs precision.
2. Power. Raise each probability to the power k, solve k so the sum is 1.
   Shrinks small probabilities harder, which corrects the bias direction,
   but the exponent has no economic interpretation.
3. Shin. Models a book that sets prices facing a fraction z of insider
   bettors (Shin 1992, 1993). Solving for z yields fair probabilities and a
   measurable insider fraction. Studies of bookmaker markets repeatedly find
   Shin closest to observed outcome frequencies where longshot bias exists,
   and it is the standard in the soccer modeling literature.

Recommendation: Shin for the model's fair probability consensus, per book,
median across books. Proportional stays as the displayed implied baseline
because the rest of the pipeline defines "edge" as model minus
proportionally devigged market, and changing that definition for one sport
would make published pp incomparable across sports. Power is implemented in
the module for the backtest comparison and is not used in the main path.
The backtest should score all three by log loss against settled results and
this recommendation should be confirmed or overturned by that number.

Note the useful side effect: even market-only, Shin versus proportional
produces small nonzero edges that lean toward favorites. These sit well
under the 2pp publication gate on typical two-book soccer markets, so
market-only mode publishes approximately nothing. That is the intended
behavior until the goal model or a manual calibration seed activates the
sport.

## The draw as a first-class pick side

Side keys extend the existing set: `home_ml`, `away_ml`, and new `draw`.
The module returns `edges: { home_ml, draw, away_ml }` so everything that
reads a per-side edges dict keeps working, and the draw participates in
best-side selection on equal terms.

## Bet type mapping

Recommendation: reuse `bet_type = 'Moneyline'` for all three 1X2 sides. Do
not add a new bet_type.

Reasons:

- `refresh_edge_calibration` maps bet_type Moneyline to market key `ml` and
  filters on `bet_type IN ('Moneyline','Spread','Total')`. A new bet_type
  would silently drop soccer picks from calibration until the SQL is
  amended.
- `mv_public_record`, the digest UI, and the outcome checker all branch on
  the existing three bet_type values.
- A 1X2 team pick and a two-way moneyline pick are the same product to the
  user: this side wins the match at these odds.

Pick text:

- Home: `Arsenal ML -120` (unchanged format).
- Away: `Chelsea ML +310` (unchanged format).
- Draw: `Draw +260`. The draw pick text MUST NOT contain either team name.
  Settlement and side mapping match on `pick.includes(team_name)`, so a
  text like "Draw (Arsenal vs Chelsea)" would settle as a home pick. The
  row already carries home_team and away_team columns for display context.

## Settlement rules

1X2 settles on the 90-minute result (regulation plus stoppage). Extra time
and penalties do not count. The outcome checker already encodes this for
team picks: `SOCCER_SPORTS` grades a level score or a `wentToExtraTime`
result as a loss for a home or away moneyline pick, not a push.

Required additions for the draw side (in
`lib/services/ai-suggestion-outcome-checker.js`, `checkMoneylineOutcome`):

- If the pick text is `Draw` (case-insensitive match on the leading word),
  grade BEFORE the team-name matching:
  - won when `scoreDiff === 0` or `gameResult.wentToExtraTime` is true
  - lost otherwise
  - never push
- Existing behavior stays: a draw result grades home and away picks as
  losses, because three-way markets do not push.

Bug to be aware of today: a Draw pick fed through the current code would
fall through team matching with `pickedHome = false` and settle as an away
pick. The draw branch must come first. This is the single blocking
settlement change.

Score source: `game_results` stores final scores. For knockout matches the
settlement needs the 90-minute score, not the final after extra time. The
`wentToExtraTime` flag covers grading direction, but the stored score may
be the post-ET score. Acceptable for 1X2 grading (direction is all that
matters once ET is known) but must be fixed before any soccer totals or
spread market ships.

## Calibration and backtest plan

Data reality check: `normalized_odds_outcomes` is a materialized view over
the CURRENT `odds_cache` rows only. It refreshes every 30 minutes and holds
no history, so it cannot backtest by itself. The historical store is
`closing_lines` (same outcomes jsonb shape, captured at commence time),
which currently holds 41 MLS and 8 World Cup soccer h2h snapshots and grows
daily now that the capture cron runs.

Plan:

1. Accumulate: let `closing_lines` build soccer history. Backfill odds
   history is not available from the current provider, so time is the input.
   At MLS volume (roughly 15 matches a week) plus EPL from late August,
   about 8 to 10 weeks reaches 150 settled matches.
2. Join: `closing_lines` h2h rows to `game_results` on team names and date,
   same match keying the outcome checker uses.
3. Score per devig method and per blend weight w:
   - multiclass log loss and Brier score of the probability vector
   - reliability by decile (predicted vs realized frequency, three curves)
   - flat-stake ROI of picks at or above 2pp, the publication gate
   - draw-specific calibration, since the draw is the historically broken leg
4. Calibration multiplier: once 80 or more settled soccer picks exist at
   `pipeline_version >= 6`, the existing `refresh_edge_calibration` job
   computes k for `EPL:ml` and `MLS:ml` automatically. Until then the seeds
   stay manual.

## Criteria for removing soccer from PREVIEW_ONLY_SPORTS

All of the following, checked in order:

1. Draw settlement branch shipped and unit tested, including the
   ET-and-penalties case.
2. `buildPickText`, `resolveOddsForSide`, and `sideForPick` handle the
   `draw` side, and the oddsCtx extraction carries `ml_draw`.
3. Backtest over at least 150 settled matches shows log loss for the
   blended model at or below the Shin market baseline, and realized excess
   win rate on claimed edge k greater than 0.
4. `edge_calibration` rows for EPL and MLS are manually reseeded from 0 to
   a conservative positive value (the migration comment makes this a
   deliberate manual act, keep it that way). Suggested seed: min(k, 0.75).
5. A two-week paper window where soccer picks are generated and settled
   with multiplier applied but the sport still in preview, verifying the
   whole loop end to end with zero published picks at risk.
6. Only then remove EPL and MLS (and tournament sports as their data
   arrives) from `PREVIEW_ONLY_SPORTS`.

## Integration notes (exact changes, NOT made here)

`api/cron/pre-analyze-games.js`:

- Import the module. Where `edgeCalc.calculateEdge(game)` runs, branch:
  soccer sports call `calculateSoccer1x2Edges` with books built by
  `fromOddsCacheRows(game h2h rows, home_team, away_team)`, strengths from
  `soccer_team_strength` when present, and the calibration multiplier the
  caller already fetches.
- oddsCtx extraction: add `ml_draw` from the h2h outcome named `Draw`.
- Best-side selection: `pickBest1x2Side` replaces `pickBestSide` for soccer.
- Pick persistence: `recommended_side` may now be `draw`. `bet_type` stays
  Moneyline. `model_prob` and `implied_prob` for a draw pick come from
  `drawProb` and `impliedDrawProb`.
- `game_analysis` columns: `calc_home_prob` and `calc_away_prob` no longer
  sum to 1 for soccer. Either add a `calc_draw_prob` column (preferred) or
  store the draw inside `edge_factors`. Migration owned by the coordinator.
- Remove soccer from `PREVIEW_ONLY_SPORTS` only per the criteria above.

`lib/services/edge-calculator.js`:

- No structural change. Preferred shape: pre-analyze routes soccer to the
  new module and never calls `calculateEdge` for soccer sports (today it
  returns null for them anyway via the standings bail). Optionally add a
  guard that returns null for soccer slugs with a comment pointing at the
  1X2 module, so nobody reintroduces two-way soccer math by accident.

`lib/services/pick-grader.js`:

- `buildPickText`: add `case 'draw': return price ? 'Draw ' + price : 'Draw'`.
- `resolveOddsForSide`: add `case 'draw': return oddsCtx.ml_draw`.
- `sideForPick`: for soccer Moneyline picks whose text starts with 'draw',
  return `'draw'` before team-name matching.

Settlement path (`lib/services/ai-suggestion-outcome-checker.js`):

- Draw branch in `checkMoneylineOutcome` as specified above. Mirror the
  same rule in the parlay outcome checker if users can add draw legs.

`edgeTier` and the publication gate need no change: a draw edge is a signed
pp like any other and flows through the same >= 2pp / negative-Trap logic.

## Open questions for the coordinator

1. `calc_draw_prob` column on `game_analysis`, or draw prob inside
   `edge_factors` json? Column is cleaner for the fact sheet and SQL.
2. Does the digest UI need a third probability bar for soccer tiles, and
   who owns that frontend change?
3. Do user-built parlays accept draw legs, and does the parlay outcome
   checker share the settlement fix or need its own?
4. The 90-minute score problem: `game_results` may store post-ET scores for
   knockout matches. Is there appetite to store `regulation_home_score` and
   `regulation_away_score`, which totals and spread markets will need?
5. World Cup and Euros have no club standings and no league history for
   strength fitting. Market-only mode covers them, but should national-team
   tournaments get an Elo-style prior (for example the public World Football
   Elo ratings) as their strength source?
6. football-data.org attribution: free tier asks for a credit link. Where
   does that live in the product?
7. Two-book consensus (FanDuel plus DraftKings) is thin for a median. Is
   adding a third book to the odds fetch for soccer sports cheap on the
   current Odds API plan?

## Sources

- Dixon, M.J. and Coles, S.G. (1997), Modelling Association Football Scores
  and Inefficiencies in the Football Betting Market, JRSS Series C 46(2)
  265-280. https://rss.onlinelibrary.wiley.com/doi/abs/10.1111/1467-9876.00065
- Karlis, D. and Ntzoufras, I. (2003), Analysis of Sports Data by Using
  Bivariate Poisson Models, JRSS Series D 52(3) 381-393.
  https://rss.onlinelibrary.wiley.com/doi/abs/10.1111/1467-9884.00366
- Karlis, D., Bivariate Poisson Regression slides.
  http://www2.stat-athens.aueb.gr/~karlis/Bivariate%20Poisson%20Regression.pdf
- Shin, H.S. (1992, 1993) insider trading model. Python reference
  implementation: https://github.com/mberk/shin
- Whelan, K., On Estimates of Insider Trading in Sports Betting.
  https://www.karlwhelan.com/Papers/ShinzNov24.pdf
- The `implied` R package vignette, catalog of overround removal methods
  (proportional, power, Shin, additive, and others).
  https://cran.r-project.org/web/packages/implied/vignettes/introduction.html
- Clarke et al., Adjusting Bookmaker's Odds to Allow for Overround.
  https://www.researchgate.net/publication/326510904_Adjusting_Bookmaker's_Odds_to_Allow_for_Overround
- Dixon-Coles draw underrating explainer.
  https://statsultra.com/dixon-coles-model/
- football-data.org registration and tier description.
  https://www.football-data.org/client/register
- football-data.org free tier limits summary (10 calls per minute, 12
  competitions). https://www.thestatsapi.com/blog/football-data-org-free-tier-limits-2026
