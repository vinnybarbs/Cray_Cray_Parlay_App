# Trap Detector

2026-07-24. Replaces the old rule where the Trap was simply the most negative side of a game, which made every trap the mirror image of the board's math and carried no information of its own.

## Definition

A Trap is a side that a casual bettor is drawn to on surface signals while the model prices it at least 2 percentage points below fair. Both conditions are required.

1. Lure score of 25 or higher, from the signal table below.
2. Side edge at -2pp or worse, the unified Trap boundary from commit 04895b1.

A side that is overpriced but that nobody would be tempted by is a Skip, not a Trap. It gets no callout and no tile. The mirror of a published pick is not a trap unless the fade side independently clears the lure bar, which it rarely does.

## Lure signals

We have no public betting percentages (the column exists but nothing writes it), so the lure is a proxy for square attention built from data we do have. Weights live in `lib/services/trap-detector.js` in one table so they can be recalibrated once settled trap outcomes accumulate.

Team sides (moneyline and spread):

| Signal | Condition | Points |
| --- | --- | --- |
| Chalk | implied ML prob 60 percent or higher | 15 to 30, scales with prob |
| Streak | won 3, 4, or 5 or more straight | 10, 15, 20 |
| Hot form | 7-3 or 8-2 last ten (fallback: last-5 win pct .700 or better) | 15, 20 (10) |
| Home side | always | 8 |
| Juicy dog | winning team at +100 to +200 | 15 |

Totals:

| Signal | Condition | Points |
| --- | --- | --- |
| Over | the Over side of any total | 15 |
| High total | total above the sport's median line | 10 |

Unders carry no lure. The draw and exotic sides have no lure model yet.

## Where it runs

- `lib/services/trap-detector.js` computes traps per game in `api/cron/pre-analyze-games.js`, independent of pick selection.
- All qualified traps are stored on `game_analysis.trap_calls` (jsonb, strongest first) and served by `/api/digest`.
- The graded record: when no side clears the +2pp pick bar, the strongest detected trap becomes the published read (`ai_suggestions` row, tier Trap) with `lure_score` and `trap_signals` stamped for later by-signal analysis. A negative side with no lure is never published.
- The board renders traps as their own tiles in a Traps section (`src/pages/GeneratorPage.jsx`), leading with the bait and closing with the price. Pick tiles no longer carry a trap footnote.

## Calibration path

Once 100 or more settled trap rows exist under this regime, compare fade win rate by lure signal and by lure score band. Signals that do not separate from the base rate get their weight cut. Candidate v2 signals: line movement toward the trap side from `closing_lines`, cross-book dispersion, and real public betting splits if we ever get a source.
