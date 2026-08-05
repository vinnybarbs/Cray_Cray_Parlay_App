# TODO

Working backlog, rewritten 2026-08-05 against the live pipeline and the
audit ROADMAP. Target for the business items is NFL season readiness
(September). Shipped since the 7/25 version: tennis data plumbing
(rankings, results, workload, H2H feeding prompts and Deep Research),
full-depth analysis on every graded game, independent trap publication
(the record had been frozen since 7/11), per-domain record dedup (mv v3,
recovered 7 hidden trap grades), the last_3d record bucket with the
clickable hero period toggle, the centralized WRITING_STYLE prompt rule,
and the ledger parlay declutter.

## Watching

- Trap record now grading live again (independent publication shipped
  8/2). All-time fade record 18-12 after the dedup repair. Calibrate lure
  weights once ~100 settled trap rows exist under the new regime
  (docs/models/trap-detector.md).
- Tennis shadow model at 132/150 settled reads as of 8/5. Crosses the
  promotion threshold within days: run the calibration slope, and if k is
  0.5 or better, seed Tennis:ml and pull Tennis from SHADOW_SPORTS
  (docs/models/tennis-edge-model.md phase 2).
- First CLV read (8/5, 383 picks): avg +0.26pp, 47% beat the close.
  Neutral-to-slightly-positive. NOT a marketing stat yet; check again at
  600+ picks.
- data_integrity_sweep logging warning rows daily. Review the warnings
  before NFL season; the sweep's intel feeds the narration prompt.
- Machine parlays: record line now collapsed on the ledger. High-variance
  builds still young; watch, not a bug yet.

## Build queue (ranked)

1. De-Genny grading-language rewire. api/chat-picks.js and the lib/agents
   chain still speak confidence-out-of-10 and EASY MONEY/medium/high risk
   vocab. Rewire suggestions to graded edge data (game_analysis edges) and
   tier vocabulary. Decide whether the multi-agent coordinator chain
   survives now that machine parlays are the product.
2. UFC settlement path. UFC picks never grade, and the shadow model sits
   at 54 reads that can never settle without it. Must exist before the UFC
   model can be promoted. UFC Spread markets should never generate at all.
3. Tennis shadow promotion (see Watching). First model likely to graduate.
4. Soccer 1X2 sample is tiny (31). Leave in shadow; revisit when European
   seasons restart in late August.
5. Polish queue: mobile nav hamburger, accessibility pass (aria-expanded,
   prefers-reduced-motion, AA contrast), real 1200x630 og:image, promote
   Sharp Take ROI on the landing hero, delete leftover vercel.json, golf
   notes reframed as this-week's-form.

## NFL season deadline (September)

- Late August: update seasonal_context in ai_instructions so NFL pick
  generation turns on in September.
- Week one: confirm settlement grades NFL correctly and watch the Monday
  refresh_edge_calibration runs as NFL builds its own sample (0.75 global
  multiplier until 80 settled picks per market).
- Player prop pick engine. Prop odds already flow into odds_cache via
  refresh-odds; no pick engine exists post-decom. The big pre-season build.
- Billing go/no-go. Deferred by decision until the product is loved, but
  the page sells $19.99/month with a 7-day trial and nothing collects it.
  Needs a decision before NFL launch. The ROADMAP's click-to-cancel
  compliance list applies when it turns on.

## Founder tasks (Vince only)

- Domain categorization submissions for traphawk.io: Palo Alto
  (urlfiltering.paloaltonetworks.com, request Sports), Zscaler, Fortinet,
  Cisco Talos, McAfee/Skyhigh. Do well before September so corporate
  networks can reach the site. Also allowlist traphawk.io in your own
  network's DNS filter.
- TRAPHAWK trademark: one-hour clearance review, then Class 41 ITU filing.
  Register "The House Ledger" mark alongside.
- Click "Run now" once on each scheduled task (daily check, Monday weekly
  review) to pre-approve tools so runs go hands-free. Same for the
  claude.ai Routine listing approval so status reviews can read them.
- Google OAuth consent-screen rebrand (cosmetic), @traphawk social handles.
- Answer: what is the untracked "Colorado Rockies/" folder in the repo?

## Parked by explicit decision

- ESPN data migration: accepted ToS/contract risk (Vince, 7/11). Revisit
  only if an endpoint breaks, a C&D arrives, or revenue justifies a licensed
  source (The Odds API scores, SportsDataIO). Tennis sync (8/2) extends
  this accepted risk, same host as settlement.
- Instagram pipeline: playbook in audit/50-marketing-instagram.md, sequenced
  after product work.
- Trade-secret hygiene checklist from audit/60: NDAs with DTSA notice,
  access controls, dated internal description of the secret, IP assignment
  in contractor agreements. Never publish model internals.
