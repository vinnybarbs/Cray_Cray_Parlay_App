# TODO

Working backlog, rewritten 2026-07-25 to match shipped reality. Target for
the business items is NFL season readiness (September). History: the 7/11
version of this file listed the site name (resolved: TrapHawk), the
generator front end (rebuilt as The Board), and deep-link risk (deep links
decommissioned with the betslip apparatus). Those are done and gone.

## Watching

- UTC day-boundary sweep running in a cloud session (2026-07-25). Follow-up
  when it lands: one-time repair of historical game_results dates written
  +1 day for 00:00Z+ starts.
- Trap detector first live pass (shipped 2026-07-25, commit 1c93553): next
  pre-analyze writes game_analysis.trap_calls. Review trap volume and lure
  weights on the Board after a full slate. Calibrate lure weights once ~100
  settled trap rows exist under the new regime (docs/models/trap-detector.md).
- Machine parlays 3-8 as of 7/20. Within variance for high-variance builds.
  Watch, not a bug yet.

## Build queue (ranked)

1. De-Genny grading-language rewire. api/chat-picks.js and the lib/agents
   chain still speak confidence-out-of-10 and EASY MONEY/medium/high risk
   vocab. Rewire suggestions to graded edge data (game_analysis edges) and
   tier vocabulary. Decide whether the multi-agent coordinator chain
   survives now that machine parlays are the product.
2. First CLV report. v_pick_clv has been accumulating since 7/11 and has
   never been read. Positive clv_pp means the pick beat the close.
3. UFC settlement path. UFC picks never grade. Must exist before the UFC
   shadow model can ever be promoted. UFC Spread markets should never
   generate at all.
4. Shadow model promotion decisions (UFC, tennis, soccer 1X2) once the
   daily 150-read checks accumulate enough settled sample.
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
  Needs a decision before NFL launch.

## Founder tasks (Vince only)

- Domain categorization submissions for traphawk.io: Palo Alto
  (urlfiltering.paloaltonetworks.com, request Sports), Zscaler, Fortinet,
  Cisco Talos, McAfee/Skyhigh. Do well before September so corporate
  networks can reach the site. Also allowlist traphawk.io in your own
  network's DNS filter.
- TRAPHAWK trademark: one-hour clearance review, then Class 41 ITU filing.
  Register "The House Ledger" mark alongside.
- Click "Run now" once on each scheduled task (daily check, Monday weekly
  review) to pre-approve tools so runs go hands-free.
- Google OAuth consent-screen rebrand (cosmetic), @traphawk social handles.
- Answer: what is the untracked "Colorado Rockies/" folder in the repo?

## Parked by explicit decision

- ESPN data migration: accepted ToS/contract risk (Vince, 7/11). Revisit
  only if an endpoint breaks, a C&D arrives, or revenue justifies a licensed
  source (The Odds API scores, SportsDataIO).
- Instagram pipeline: playbook in audit/50-marketing-instagram.md, sequenced
  after product work.
- Trade-secret hygiene checklist from audit/60: NDAs with DTSA notice,
  access controls, dated internal description of the secret, IP assignment
  in contractor agreements. Never publish model internals.
