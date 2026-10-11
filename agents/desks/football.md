# The football desk book

This is the market by market knowledge of the TrapHawk football desk
(NFL first, NCAAF second). The desk brief (agents/football-desk.md)
tells the desk to read this book before every run. Drafted by the code
session on 2026-10-11 from the code, the dial board and the lookbacks,
for the owner to edit (workforce plan decision 6). Facts here may be
corrected by anyone with evidence. The judgment lines (what the market
prices, what the model misses, what counts as unseen information) are
the owner's and change only by his commit.

## How this book is used

The desk is not a second model. The pipeline prices every game from the
market anchor and the dial board, picks the side, and narrates it. The
desk reads the published pick and answers one question per market: is
there information the model could not see that argues against this
side, and how much. Its answer is a verdict row in desk_verdicts: agree,
hold, or shade down by at most 2pp, with one category from the fixed
list below and an evidence array where every fact names its source. The
desk never writes a probability, never names a different side, never
touches a dial, a pick or the narration. desk_scorecard grades every
verdict against the settled pick and its closing line value. A category
earns its way into the pipeline only through the promotion bar at the
end of this book, and the owner flips it.

The book is used in three places. The desk reads it before every run.
The narrator will load the section for the pick's market in place of
the retired ai_instructions playbook (plan decision 4, not yet shipped).
The Monday calibration review reads the promotion bar when it files the
desk verdict list.

## NFL moneyline

Live since 2026-09-10 (directive 12). The record on 30 days to
2026-10-11: 90 published NFL rows across Lean, Leg, Play and Trap.

What the market prices. The NFL moneyline is the most efficient number
TrapHawk touches. By Friday the consensus price carries the public
injury report, the quarterback situation, rest, travel, weather at the
dome or stadium level, and every public power rating. A -200 favorite
is a 66 percent team by the close almost every week. The model starts
from that number (the market anchor) and only moves off it for the
factors below, capped by max_net_adjustment at 15pp and by the thin
sample leash in September.

What the model does. It anchors on the implied probability, then
adjusts for injuries (the position ladder in football-injuries.js:
starting quarterback, WR1 through WR4 tapering, one starter per line
slot, with a depth chart gate that halves the cost of a player the
chart does not list), rest days (rest_per_day 0.004 to a cap of
0.025), strength of schedule, and nothing else that matters at this
sample. Home advantage is zero on anchored reads because the book
already priced it (found 2026-09-12). Recent form and the seed prior are
zero for football. The read then has to clear the 2pp raw claim gate to
publish as a Lean.

What the model misses. The model knows an injured player's position and
depth rank, not his replacement. A backup quarterback who has started
before is not the same as a rookie. It knows rest days, not the body
clock of a west coast team at 11:00 MT in the east. It knows the
injury report, not the Friday practice report trend (a player who
missed Wednesday and Thursday and was limited Friday). It cannot see
coaching changes, a suspended player, a trade, a new offensive line
combination, a kicker change, or a team resting starters in week 18.
Those are the desk's categories.

Home side. The lookback on 2026-10-07 read NFL anchor right 52.9 percent
and close right 73.3 percent on 15 reads, with 8 upsets in 8 days. The
model's home favorites are the market's home favorites. A hold on a
home favorite needs a named reason (a starting quarterback out after
the Friday report, a short week after a Monday road game, a 10 mph plus
wind at an outdoor stadium when the favorite is pass heavy). A shade
needs the reason and a number.

Away side. Road dogs at +150 and longer are where the moneyline edge
has been found in the shadow ledger across sports, and where the model
publishes the fewest NFL rows. The desk's agree on a road dog is worth
as much as its hold on a favorite, because an agree with a category of
none and a line of evidence is the baseline the scorecard measures
holds against.

## NFL spread

Live since 2026-09-10. spread_claim_damp 0.5 for NFL: the model's margin
claim against the book spread is halved before it prices a side,
because a 0-0 September point differential is not a margin model.

What the market prices. The spread carries everything the moneyline
carries plus the key numbers. Three and seven are where half of NFL
margins land, and the price on each side of a key number moves faster
than the number itself. A line of -2.5 versus -3 is a different bet at
the same price.

What the model does. It converts its anchored win probability into a
margin with the per sport sigma (13.5 points), compares it to the book
spread, damps the disagreement by spread_claim_damp, and prices the
side. It does not know key numbers. It does not read the spread price
(the stored price defaults to -110 when the row stored none).

What the model misses. Key numbers, the spread price, the difference
between a line that moved through 3 and one that moved to 3, and
garbage time (a team that scores late against prevent defenses covers
spreads it should not). The categories line_move and key_number exist
for this market.

Favorite side. A favorite at -3 that was -2.5 Tuesday moved against the
public money or on news. A favorite at -3.5 that was -3 is the market
saying the number is wrong by a half point that matters. The desk
notes which.

Underdog side. Dogs of +3 to +7 cover at a higher rate than their
moneyline implies because of key numbers. The model prices the
moneyline first, so its spread dogs are moneyline dogs with a damped
margin. A desk agree on a +3.5 dog is the baseline. A hold on a dog
needs a reason the dog cannot keep it close (a backup quarterback, a
pass defense missing two starters against a top passing offense).

## NFL totals

Shadow (publish_total 0 for NFL, directive 12: totals stay in shadow).
The model prices totals from the book total as the anchor, its own
scoring model damped by total_claim_damp 0.5, and weather after the
anchor at weather_total_weight 1 (wind 15 mph plus drags the modeled
total 2 points, 25 plus drags 4, heavy precipitation adds 1.5). No NFL
total publishes, so the desk writes no total verdicts for the NFL. The
desk may register a totals hypothesis for the lookback to grade in the
shadow ledger (shadow_reads_graded), which is how a market earns its
go live under directive 20.

## NCAAF

NCAAF moneyline went live automatically on 2026-10-11 07:00 MT
(promote-ready-markets, directive 20 rule: 58-28 on 86 publishable
shadow reads, 2.72 units, 62.4 percent beat the close). NCAAF totals
have been live (publish_total 1). NCAAF spread stays in shadow
(publish_spread 0).

What the market prices. College lines are softer than the NFL, with
more teams, fewer books, and a bigger gap between the opening number and
the close. Top 25 games are priced like the NFL. Group of five games
and Tuesday night games are where numbers move 3 points on news.

What the model does. The same anchor and ladder. Sigma 16 points. The
injury ladder depends on nflverse depth charts for the NFL and on the
ESPN intelligence sweep for college, so college injury data is thinner
(the sweep filters Active noise but does not know depth).

What the model misses. Quarterback changes mid week (a benching
announced Thursday), transfer portal and opt out news late in the
season, bowl motivation, and conference championship rest. The
categories quarterback and situation cover most of it.

Desk scope for NCAAF. Friday run only, for Saturday games with a
published Play or higher (edge 4pp and up) on the moneyline, and for
published totals Plays. No Lean verdicts in college, the slate is too
large for the budget. A college hypothesis a month is enough.

## The verdict categories

Every hold or shade carries exactly one category. Agree carries a
category when the desk found supporting information the model could
not see, else none. The list is fixed. A reason that fits none of these
goes under note, the verdict stays agree, and the desk proposes a new
category in its blackboard row for the owner to add here.

- injury_depth. The replacement matters more or less than the ladder
  costed: who the backup is, a second injury at the same position, a
  player listed on the report but likely to play, a late scratch after
  the Sunday inactives.
- quarterback. Any change at starting quarterback, a quarterback on the
  report with a throwing arm or ribs issue, a rookie first start, a
  benching.
- weather. Wind above 15 mph, rain or snow at an outdoor stadium, heat
  for a cold weather team in September, when the model's weather read
  (edge_factors.weather) is missing or stale.
- rest_travel. Short week (Thursday after Sunday), a road team on its
  third straight away game, west coast team in an early eastern window,
  a team coming off London or Germany, bye week advantages.
- matchup. Trench mismatch, a pass rush against a backup left tackle,
  tempo against a thin defense, a run heavy team in bad weather, a
  kicker change on a spread.
- situation. Lookahead to a bigger game, a letdown after a rivalry win,
  a team eliminated or clinched, a coach on the hot seat, a divisional
  game late in the season, week 18 resting.
- line_move. The consensus moved 1 point or more against the model's
  side since the pick published, or the price moved 15 cents or more.
  Spread and moneyline. The evidence names the open, the current number
  and the source.
- key_number. The spread pick sits on the wrong side of 3 or 7 (a
  favorite at -3.5 that opened -3, a dog at +2.5 that opened +3) or the
  total sits on 41, 44 or 47 against the pick.

## Dials and rules in force

NFL dial board as of 2026-10-11 (sport_dials, sport NFL unless noted).
The exec assistant corrects this table from the board when it drifts.

| Dial | NFL | Note |
|---|---|---|
| publish_ml, publish_spread | 1 (from __all__) | live since 2026-09-10 |
| publish_total | 0 | totals in shadow, directive 12 |
| home_advantage | 0.030 | zero on anchored reads, so unused in season |
| injury_weight | 1 | position ladder in football-injuries.js |
| injury_depth_unknown_weight | 0.5 | depth chart gate, 2026-09-15 |
| rest_per_day, rest_cap | 0.004, 0.025 | |
| form_weight, seed_weight | 0, 0 | off for football since 2026-09-15 |
| sos_sensitivity | 0.15 | |
| spread_claim_damp, total_claim_damp | 0.5, 0.5 | |
| weather_total_weight | 1 | after the total anchor |
| max_net_adjustment | 0.15 | 15pp cap on stacked adjustments |
| leg_prob_floor | 0.80 | legs need 80 percent, books post -900 |
| chalk_penalty_pp, longshot_penalty_pp | 3, 6 (from __all__) | price penalties on the claim |
| venue_weight | 0.25 (from __all__) | |

NCAAF differs: publish_spread 0, publish_ml 1 (from 2026-10-11),
publish_total 1, leg_prob_floor 0.75 (from __all__), the rest the same.

Rules in force that touch football. Directive 12 (totals in shadow, the
NFL go live is a model go live not a marketing launch). Directive 20
(a shadow market goes live by the readiness rule, promote-ready-markets
writes the blackboard row). Directive 23 (a whole sport shadow read is
never narrated). Directive 24 (never Wikipedia, records verified only
against ESPN, CBS Sports, Yahoo Sports, Fox Sports or the league site).
The football lookback (football-lookback-weekly, Tuesdays 09:00 MT)
grades every football read in lookback_reads: anchor right, net move
right, close right, upsets. The desk's Tuesday run reads that row.
There are no football rule gates yet (rule_gates holds MLB only).

## Narration vocabulary

The tiers, by calibrated edge in percentage points against the implied
probability: Lean 2 to 4, Play 4 to 7, Strong Play 7 to 10, Sharp Take
10 and up, Trap at -2 and below, Skip in between. A Leg is a no pick
side above the leg floor for the parlay pool. The narrator justifies
the model's pick with the matchup data and never changes the side (the
pick block in pre-analyze-games.js). The desk's verdict does not reach
the narration today.

Words the desk uses in its evidence and notes, so the scorecard reads
the same across weeks: starter, backup, out, doubtful, questionable,
limited, full (the NFL report words, never "banged up"), short week,
long week, bye, road trip, early window, late window, prime time, key
number, through the number, on the number, consensus, open, current,
dome, outdoor, wind, precipitation.

Words for the narration when it loads this book (plan decision 4): the
narration cites the record, the point differential, the recent results
with scores, the injury report with the report word, and the number
with its price. It says what the market prices and what the model
disagrees with. It never says lock, guarantee, easy money, free money,
or sharp money without a number behind it.

## Banned claims

- Never a win probability from the desk. The model has one. The desk
  has a verdict.
- Never "the public is on" without a named source and a number. The
  pipeline does not ingest ticket or handle splits.
- Never "sharp money" unless the evidence row cites a consensus move
  against the public side with open and current numbers from a named
  source.
- Never a record or ranking from memory. Every record in an evidence
  row cites ESPN, CBS Sports, Yahoo Sports, Fox Sports, NFL.com or the
  nflverse tables already in the database (nfl_injury_reports,
  nfl_depth_charts, current_standings). Never Wikipedia (directive 24).
- Never a claim about a player's status beyond the official report
  word plus a named beat report with a date.
- Never "trend" from fewer than 20 games, and never a situational trend
  (teams off a bye are X and Y) as evidence, those are the model's job
  to price and the hypothesis table's job to test.
- Never an injury the model already costed as a hold on its own. The
  evidence must say what the model missed (the replacement, the second
  injury, the late scratch), not repeat the report.
- Never a different side. If the desk believes the other side is the
  bet, the verdict is hold, the category explains why this side is
  wrong, and the note may say what the desk would do.
- Never a shade above 2pp. Never an upward shade.

## The promotion bar

A category is a candidate when desk_scorecard shows, for one sport,
market and category, at least 100 graded verdicts of hold or shade,
desk_right_pct above the model's own win rate on the same cell, and the
held picks' avg_clv_pp below zero (the market later moved against the
picks the desk held). The Monday calibration review files the verdict.
The owner flips the category with a model_weight_changes row, and the
code session ships it as a dial in the bounded pre publish reviewer
(hold or shade down by at most 2pp, never create, never shade up).
Six weeks after promotion the category must pass the same bar again or
it drops back to shadow. A desk whose categories all fail keeps writing
shadow rows and loses its paragraph in the owner's message until
something passes.

## Owner's edits

Add dated lines here when a judgment line above changes.

- 2026-10-11. First draft from the code session, for the owner to edit.
