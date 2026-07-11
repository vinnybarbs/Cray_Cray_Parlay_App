# TODO

Working backlog. Added 2026-07-11 after the calibration and closing-line work
landed. Target for the business items is NFL season readiness (September).

## To revisit (Vince, 2026-07-11)

### 1. Site name
"Cray Cray for Parlays" carries the degen voice, but the product has moved
toward math-graded edges, calibration, and published receipts, which is the
sharp side of the two personas in `.agents/product-marketing-context.md`.
Decide whether the name still fits the product being sold, and check domain
and trademark availability for any candidate before attaching to one.

### 2. Front end of the initial selection generator
The interactive pick generator flow (mode selection, suggest-picks output,
BetslipBuilder handoff) predates the digest-first design and the Sharp-Quant
look of the Landing and DailyDigest. Review the whole first-run flow for look,
feel, and speed, and bring it up to the same visual standard. The generator is
the first thing a trial user touches after signup, so it carries conversion
weight.

### 3. Deep link reverse engineering risk
The one-tap betslip deep links into DraftKings and FanDuel are built on
undocumented URL formats. Assess how likely they are to break or be blocked,
what the failure looks like to a paying user, and whether the books' terms
create exposure. Decide on a fallback behavior when a deep link stops working
(at minimum, copy-the-pick with a plain link to the book).

### 4. Sports that silently fail
Inventory and fix every sport that quietly produces nothing today:
- Tennis and UFC: analyzed but never get edges because the foundational-data
  guard needs team records/standings that individual sports lack. Wimbledon
  ran dark in July. Either build an individual-sport data path (rankings,
  recent match form) or formally drop them from coverage claims.
- Soccer (EPL and MLS): suspended on purpose via edge_calibration multiplier 0
  until the model handles three-way (draw) markets. Reactivation is a manual
  seed change plus a draw-aware edge model.
- UFC also has no settlement path (its picks never grade), and "UFC Spread"
  markets should never generate at all.
The product rule should be that a sport is either on the board with working
edges and settlement, or it is not claimed as covered. No silent middle.

## Standing pre-season items

- ~~RLS pass on the exposed public tables~~ DONE 2026-07-11
  (migration 20260711110000_rls_lockdown.sql: 34 tables locked, ai_suggestions
  insert/update policies fixed, analytics grants tightened).
- ~~Enable leaked-password protection in Supabase Auth~~ DONE 2026-07-11
  (Vince enabled it in the dashboard).
- Update `seasonal_context` in ai_instructions in late August so NFL pick
  generation turns on in September.
- Billing. The page sells $19.99/month with a 7-day trial and nothing
  collects it yet.
- Week-one NFL check: confirm settlement grades NFL correctly and watch the
  first Monday `refresh_edge_calibration` runs as NFL builds its own sample
  (starts at the 0.75 global multiplier until 80 settled picks per market).
- First CLV report once a week of closing-line data accumulates
  (`v_pick_clv`, positive clv_pp means the pick beat the close).
