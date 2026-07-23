# Product Marketing Context: Cray Cray for Parlays

> **v2, Vince-confirmed 2026-05-11.** Read by every marketing/CRO/copy skill.
> All 7 open questions from v1 have been resolved (see §11). Remaining `[?]`
> markers are minor inferences, not blockers.

---

## 1. Product Overview

**One-liner:** Cray Cray for Parlays is a sportsbook-agnostic AI handicapping app that grades every game with deterministic math, then writes you a parlay you can actually trust.

**What it does (2-3 sentences):**
The app pulls live odds, scores, injuries, and team form from The Odds API + ESPN, runs a per-side edge calculator against every market (ML / Spread / Total), and surfaces only the games where the model genuinely disagrees with the bookmaker. A second layer, Degenny, the in-house LLM chatbot, turns the math into picks you can read in voice and build into parlays in one tap.

**Product category (what shelf you sit on):** AI sports betting tool / handicapping assistant. Competitors include Action Network, BettorEdge, Pikkit, PropSwap insights, and the "model-driven picks" Twitter cottage industry.

**Product type:** Web app (React + Vite frontend, Node/Express backend on Railway, Supabase Postgres). No app store yet. `[?]` Roadmap suggests mobile app is planned.

---

## 2. Ideal Customer Profile (ICP)

**Decision (2026-05-11):** Both personas weighted equally. Design two surfaces:
degen voice on marketing/onboarding/copy, sharp voice on dashboards/edge
detail/hit-rate pages. Both audiences are first-class.

**Primary persona: "Recreational degen who reads"**
- 22-40, mostly US, mostly male
- Bets weekly, mostly parlays + props, $20-200/wager
- Already pays for The Odds API equivalents (some kind of pick service) OR pirates picks from Twitter
- Hates "guaranteed lock" services that obviously aren't
- Wants the *numbers* but lacks the math chops to compute edges themselves
- Brand-receptive: irreverent humor, in-jokes, "we know we're degens" framing

**Secondary persona: "Sharp-curious bettor"**
- 28-50, treats this as a side income, not entertainment
- Already understands EV, Kelly criterion, vig
- Wants the per-side edges directly (the new EdgeChip), doesn't need narrative
- Less brand-receptive to degen humor; more conversion-receptive to "63% hit rate on ML"

**Anti-persona (NOT for):** First-time sports bettors, anyone looking for "lock of the day" content, social bettors who care more about commenting than betting.

---

## 3. Core Value Proposition

**The promise:**
*"We computed the edge before we wrote the pick. If the math doesn't disagree with the book, we don't force a play. We'll tell you to skip."*

**Why this beats alternatives:**
- **vs. Action Network / Pikkit:** They aggregate sharp action and public picks; we compute our own edges from first principles, market-by-market.
- **vs. capper Twitter:** Their picks are vibe; ours are math, with the +X.Xpp number on every single side. We publish hit rates.
- **vs. building it yourself:** You'd need The Odds API + ESPN + a scoring model + an LLM for narrative + a settlement pipeline. We did all that.

**Key differentiator (the one thing someone remembers):**
The tile that says **"−12.4pp · Trap"** when the model disagrees with a recommendation it could have made. Most apps never show negative edges. We do.

---

## 4. Voice & Brand Personality

**Current voice signals from the codebase:**
- Hero: "Cray Cray for Parlays" + gradient yellow→red
- Tagline (footer): *"Five AI agents working harder than your therapist to justify your gambling addiction"*
- Loading copy: *"Sacrificing a prop bet to the degen gods..."* / *"Channeling my inner degenerate..."*
- Chatbot name: De-Genny ("a sharp, opinionated sports betting degenerate who ALWAYS has a take")
- Asset folder: `/images/degenerate-gambler.png`

**Voice principle:** Degen-self-aware. We talk like the user does ("degen", "lock", "trap", "lean", "hammer") but the *math* is dead serious. Two registers, one product.

**Tone rules:**
- ✅ Self-deprecating about the act of betting ("we know we're degens")
- ✅ Reverent about the math ("the model disagreed by 12pp, and we don't ignore that")
- ❌ Never say "guaranteed", "lock" without irony, or imply certainty. We explicitly built UI to avoid this
- ❌ Never preachy about responsible gambling (one disclaimer is enough)

**Tier label format (decided 2026-05-11):** Hybrid, with an analytical primary label
with brand-voice subtitle.

```
Strong Play       Skip            Sharp Take
  hammer it         pass on it      sharp take
```

Analytical reads as the trust signal; subtitle keeps the degen register alive.
Both audiences served without picking one.

---

## 5. Customer Language (Verbatim)

`[?]` Vince should fill these in from real reviews/comments/DMs. For now, my best inference from the app's audience:

**How they talk about the problem:**
- "I keep losing parlays even though I do my research"
- "Every capper says lock and I'm 0-4 on locks"
- "I don't have time to actually compute edges"
- "I just want to know which side has actual value"

**How they talk about wins/losses:**
- "Hit the lock" / "got smoked" / "took a bad beat"
- "Squared up" / "ran it back" / "hammered it"
- "Bag secured" / "down bad"

**What they'd brag about with a friend:**
- A pick with +18pp edge that hit at 65% implied
- A "Trap" tile that correctly predicted a heavy fave failing to cover
- A 4-leg parlay where every leg was a Sharp Take

---

## 6. Objections & Hesitations

| Objection | Why they feel it | Counter |
|---|---|---|
| "Another picks service that says lock and goes 0-fer" | Every sportsbook tipster + Twitter capper does this | Show hit rate per tier, never use "lock", always show negative edges |
| "I can compute this myself with The Odds API" | Sharp-curious persona | True for the 5% who will; we save the rest 6+ hrs of math per week |
| "AI = hallucinated stats" | Justified after years of LLM slop | Surface that picks are **math-derived**, LLM only narrates; show the +X.Xpp number on every tile |
| "Sportsbooks know what they're doing, so there's no edge" | Conventional wisdom | True for ML on heavy favorites; we openly show those as Skip. Edge exists on spreads/dogs/props where we deliberately specialize |
| "Will my data be safe?" | Sportsbooks have huge data brokerage issues | Public-facing app, no betslip integration yet, so this is easy to address transparently |

---

## 7. Proof Points (current + needed)

**What we can claim today:**
- 1000+ picks settled in the last week with proper W-L-Push tracking (Phase 1-7 settlement work)
- Per-tier hit rate available in `mv_model_accuracy` once enough data accumulates
- Live counts: ML hits ~63%, Spread ~51%, Tennis ML ~60%, UFC ML ~63% (early sample)
- The math source code is in the repo. `lib/services/edge-calculator.js` is publishable

**What we'd need to claim more:**
- 30+ day rolling hit rate per tier (Sharp Take = X%, Strong Play = X%, ...)
- ROI tracking (we deliberately don't track ROI right now per the codebase. Flat-bet hit rate is the north star)
- Customer testimonials
- A "proof page" comparing our recommended_pick to Action Network or similar for the same game

---

## 8. Pricing & Monetization

**Decision (2026-05-11):** Teaser trial → paid. Not a permanent free tier.

**Model shape (to be flesh out in pricing-strategy pass):**
- **Trial:** Time- or quota-bounded teaser of the full product (e.g. 7 days
  of digest + Sharp Take + Degenny, or N picks viewed). Long enough to hit
  the "First Sharp Take seen" aha and ideally a settled W.
- **Paid:** Single tier to start (avoid Pro/Premium ladder complexity).
  Pricing target TBD in dedicated pricing-strategy work.
- **Affiliate revenue:** Optional layer on top (sportsbook deeplinks from
  tiles). Doesn't change the consumer pitch and doesn't gate features.

**CRO implications:**
- Need a paywall-upgrade moment (`paywall-upgrade-cro` skill, Phase 2+).
- Trial expiration screen is one of the highest-leverage CRO surfaces.
- Onboarding (Phase 4) must surface the aha moment **before** the paywall.

---

## 9. Distribution / Acquisition Channels

`[?]` Best-guesses for a degen-target app:
- **Organic:** /r/sportsbook, /r/sportsbetting, sports gambling Twitter
- **Paid:** Sharp betting podcasts (Action Network Podcast, Bet The Process)
- **Referral:** Built-in share-pick image card (the viral hook discussed)
- **Content:** Public hit-rate dashboards as a backlink magnet

---

## 10. Things We DON'T Say (Compliance / Brand)

**Legal posture (decided 2026-05-11):** Info-only / handicapping product. We
don't take bets, hold money, or facilitate wagers. No special licensing
pursued at launch. No geographic restriction at launch. Open globally as an
info site. Standard disclaimers + +21 age gate are sufficient.

**Hard nos (still apply):**
- ❌ "Guaranteed", "lock", "free money", "can't lose" (legal + brand)
- ❌ Anything that promises individual-pick certainty
- ❌ Anything that targets minors (this is an adult product, +21 minimum)
- ❌ Recovery / gambling-addiction-recovery angles (out of scope, but always include a hotline)

**Required surface elements:**
- +21 age gate on first visit
- Responsible-gambling disclaimer + 1-800-GAMBLER hotline in footer
- "For entertainment / informational purposes only, not gambling advice" near pick tiles or in ToS

---

## 11. Resolved Decisions (2026-05-11)

| # | Question | Decision |
|---|---|---|
| 1 | Primary ICP | **Both equal weight.** Degen voice on marketing/onboarding, sharp voice on dashboards/edge detail. |
| 2 | Pricing model | **Teaser trial → paid.** Time/quota-bounded trial of the full product, then single paid tier. Affiliate revenue optional on top. |
| 3 | Activation aha moment | **First Sharp Take seen.** Onboarding must get a new user to a +X.Xpp Sharp Take tile fast. |
| 4 | Tier labels | **Hybrid.** Analytical primary (Skip / Lean / Play / Strong Play / Sharp Take) + brand subtitle (pass on it / lean / play / hammer it / sharp take). |
| 5 | Compliance partner | **Not needed at launch.** Info-only stance (handicapping content, no bet placement). Disclaimers + +21 gate sufficient. |
| 6 | Geographic targeting | **No geo limits.** Open globally as an info site. |
| 7 | "Trap" red label | **Keep as-is.** "Trap" is the differentiator; softening it loses the hook. |

These decisions unblock Phase 1 (aesthetic direction) and feed every downstream marketing/CRO/copy task.
