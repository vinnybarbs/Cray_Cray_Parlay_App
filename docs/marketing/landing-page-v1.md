# Marketing Landing Page v1 Copy Spec

**Status:** draft for review
**Locked decisions:**
- **Hero frame:** villain-forward ("Your book won't tell you which side is the trap")
- **Voice:** degen-self-aware on marketing, sharp-quant on numbers (per `.agents/product-marketing-context.md` §4)
- **Free top-of-funnel mechanic:** Live Pick of the Day visible without signup
- **Route:** new `Landing.jsx` mounted at `/` for unauthenticated users; current MainApp form moves behind sign-in

**Out of scope for v1 (handled in A2):**
- +21 age gate (first-visit modal)
- Footer with 1-800-GAMBLER + disclaimers
- Pricing page (separate route, Stage A3)
- ToS / Privacy pages

---

## Page outline

```
┌─────────────────────────────────────┐
│  HERO       villain frame + CTAs    │
├─────────────────────────────────────┤
│  WEDGE      comparison table        │
├─────────────────────────────────────┤
│  HOW        3-step explainer        │
├─────────────────────────────────────┤
│  LIVE POD   today's free pick       │
├─────────────────────────────────────┤
│  PROOF      hit-rate by tier        │
├─────────────────────────────────────┤
│  CREDIBLE   no-affiliate frame      │
├─────────────────────────────────────┤
│  PRICING    teaser + start trial    │
├─────────────────────────────────────┤
│  FAQ        6 questions             │
├─────────────────────────────────────┤
│  FOOTER     [v2 - Stage A2]         │
└─────────────────────────────────────┘
```

---

## 1. Hero

**Headline (h1):**
> Your book won't tell you which side is the trap. We will.

**Sub:**
> Math-graded picks for every game. Per-side edges in plus/minus points. Including the negative ones.

**CTAs:**
- Primary: `[ Start free trial ]`: amber button, links to `/signup`
- Secondary: `[ See today's free pick → ]` : ghost button, smooth-scrolls to LIVE POD section

**Trust strip (below CTAs, mono):**
> 1,000+ picks graded this week · 30-day hit rate: [LIVE FROM mv_model_accuracy]% · Sportsbook-agnostic

**Layout:**
- Full-height hero (~85vh)
- Headline: Inter Tight, 5xl on desktop / 3xl mobile, ink-100, tracking-tight
- Sub: text-lg, ink-300
- Trust strip: font-mono, text-[11px], uppercase, tracking-[0.14em], ink-400 with signal-pos accent on the hit-rate number
- Background: ink-950 with a faint amber radial-gradient behind headline

---

## 2. The wedge (comparison)

**Eyebrow:**
> What every picks app gets wrong

**Headline:**
> They show you what to bet. We show you what NOT to.

**Body:**
> Every other picks app (Action Network, OddsJam, Pikkit) has a structural reason it can't warn you off a bad bet.
>
> Action Network is owned by a sportsbook affiliate. OddsJam ideologically only shows positive EV. Pikkit only grades you after the bet. Your sportsbook is the bet.
>
> We have no parent company sending you to a book. We grade every side, including the one you shouldn't take. The label is **Trap.**

**Comparison table (4 rows):**

| | Cray Cray | Action Network | OddsJam | Pikkit |
|--|--|--|--|--|
| Shows the trap (−pp edges) | ✓ | ✗ | ✗ | ✗ |
| Sportsbook-agnostic, no affiliate parent | ✓ | ✗ | ✓ | ✓ |
| Pre-bet edge grade | ✓ | partial | ✓ | ✗ |
| Built for $50-500/mo bankrolls | ✓ | ✗ | ✗ | ✓ |

**Voice note:** keep the prose under the table tight. The table does the work; the words frame it.

---

## 3. How it works

**Eyebrow:**
> Three steps. No vibes.

**Step 1: Math grades every game**
> Our edge calculator runs against every market: moneyline, spread, total. Per-side. We compute the model's probability and compare it to the implied probability from the book's line. The gap, in percentage points, is the edge.
> *Source: `lib/services/edge-calculator.js`. Yes, the math is publishable, and yes, we publish it.*

**Step 2: De-Genny narrates**
> Once the math picks a side, our in-house LLM writes the rationale in plain English. The AI doesn't pick the bet. The math does. De-Genny just explains why.
> *Counter to the "hallucinated stats" objection from §6 of the marketing context.*

**Step 3: You lock and build**
> Pick the sides you like, hit "Build Parlay," and we hand you a one-tap deep link to your sportsbook. We never hold your money. We never see your account.

**Layout:**
- 3-column on desktop, stacked on mobile
- Each step has a JetBrains Mono number badge (01 / 02 / 03)
- Step icons or small SVG illustrations TBD; default to clean type-only

---

## 4. Live Pick of the Day

**Eyebrow:**
> Today's free Sharp Take

**Headline:**
> No signup. No paywall. Here's the highest-edge pick on the board right now.

**Body:**
- Render the live `PickOfTheDay` component (reused from DailyDigest) with the highest-tier pick from today's data
- If no Sharp Take today, fall back to highest Strong Play
- If quiet board, show: *"Quiet day. Math says skip. We refuse to force a pick. Come back tomorrow."*

**CTA below the tile:**
> `[ See all of today's picks → ]` (links to `/signup` since digest is gated)

**Layout:**
- Centered, max-width-2xl
- Tile uses the existing Sharp-Quant tokens
- Below the tile: small mono note: *"Updated daily at 8AM ET. Currently graded across [N] games and [M] sports."*

---

## 5. Proof

**Eyebrow:**
> The numbers, not the vibes

**Headline:**
> Every pick gets graded. Every grade gets published.

**Body:**
> Most picks apps cherry-pick their wins. We publish hit-rate by tier and sport, refreshed after every settlement run. You can see exactly how the math performed before you trust it with your bankroll.

**Embed:**
- Live table from `mv_model_accuracy`, filtered to last 30 days
- Columns: Tier | Picks | Hit Rate
- Rows: Sharp Take, Strong Play, Play, Lean, Skip (skip likely shown for transparency)
- Color-coded: positive tiers in signal-pos amber, Skip in ink-400, anything that drifts below 50% in signal-neg

**CTA below table:**
> `[ See the full track record → ]` (links to `/results` or `/signup` depending on auth)

---

## 6. No-conflict credibility

**Eyebrow:**
> Why you can actually trust the picks

**Headline:**
> Sportsbook-agnostic. No affiliate kickbacks. Same edge no matter where you bet.

**Body:**
> We don't make money sending you to a sportsbook. We don't have a parent company that does either. Our entire business is grading the game honestly, including telling you when the line says skip.
>
> That's why the picks include negative edges. We have no incentive to hide them.

**Layout:**
- Single-column, centered, narrower max-width
- Optional: small graphic of the three sportsbook logos (DK/FD/MGM) with arrows pointing equally outward from the Cray logo

---

## 7. Pricing teaser

**Eyebrow:**
> One tier. Trial first.

**Headline:**
> Try the full product. Pay nothing until you've seen a Sharp Take hit.

**Body (pricing card):**

```
FREE 7-DAY TRIAL
↓
[Plan name TBD] · $[X]/month
- Full daily digest
- Every per-side edge (+ and −)
- Build & deep-link parlays
- De-Genny chat
- Settlement tracking
```

**Microcopy:**
> No credit card to start. Cancel anytime. We send one email when the trial ends. That's it.

**CTA:**
> `[ Start free trial ]` (same primary button as hero)

**TODO:** lock the actual price in Stage A3 (`/pricing-strategy` skill). Placeholder for now.

---

## 8. FAQ

Accordion-style. Six questions:

**1. What's a "Trap"?**
> A pick with a negative per-side edge, meaning the model thinks the side wins less often than the book's line implies. Every other picks app hides these. We label them. *"Trap"* is the only honest reaction to a bad bet that looks tempting.

**2. Why publish negative edges? Doesn't that scare people off?**
> Negative edges are most of the betting universe. If we only published positive ones, we'd be lying about the shape of the market. The Trap label is the differentiator. It's the one thing every other picks app structurally can't show you.

**3. How is this different from Action Network or OddsJam?**
> Action Network is owned by a sportsbook affiliate, so they can't credibly warn you off a book. OddsJam targets +$2K-monthly bankroll arb bettors at $99-199/month. We're built for the $50-500/month bankroll that wants the math without the price tag, and we're the only one that shows you what NOT to bet.

**4. Is this gambling advice?**
> No. It's information. We grade games using public data and publish the math. What you do with the picks is on you. We're not licensed as advice; we're not a sportsbook; we don't hold money. *"For entertainment and informational purposes only."*

**5. Do I need to be 21?**
> Yes. We're an info site about sports betting, which is a +21 activity in every US jurisdiction we know of. We don't sell anything that would change that.

**6. Where does my data go?**
> Email + (optionally) Google sign-in is all we collect to start. We don't share or sell. Locked picks live on your account so we can grade them later. Payment goes through Stripe directly. We never see your card.

---

## Component reuse

| Section | Reuses |
|---|---|
| Hero CTAs | New `<HeroCTA primary />` and `<HeroCTA secondary />` |
| Live POD | `PickOfTheDay` component from `src/pages/DailyDigest.jsx` (extract into shared) |
| Proof table | Pull from `mv_model_accuracy` directly via existing supabase client |
| Comparison table | New `<ComparisonTable />`, a simple grid using existing tokens |
| FAQ | New `<FAQ />`, a simple accordion using existing `ink-700` borders |

---

## Implementation notes

1. Create `src/pages/Landing.jsx` with the sections above
2. Update `src/components/MainApp.jsx` routing: unauthenticated users + root hash see `Landing.jsx`; authenticated users redirect to current form
3. Move existing form view to `'#/app'` hash for authenticated users
4. Smooth-scroll behavior on secondary CTA (uses `scrollIntoView({ behavior: 'smooth' })`)
5. All copy uses existing tokens. No new ones needed
6. Responsive breakpoints: design mobile-first, scale up at `md:` (768px)
7. Hit-rate data: fetch once on mount, cache in component state, fallback to "-" if empty

---

## Decisions still pending (will ask before building)

1. **Pricing placeholder.** Do I leave it as `$[X]/month` or pick a number now (e.g. $19.99)?
2. **Trust strip data.** Show real numbers from `mv_model_accuracy` or hardcode "30-day hit rate: 58%" for v1?
3. **Comparison table competitors.** Keep the 3 I listed (Action, OddsJam, Pikkit) or add ESPN BET to anchor against sportsbook UX?

---

## Open questions for v2 (don't block A1)

- Should the landing be a *single page* or split (homepage + `/how-it-works` + `/pricing`)? Single-page for v1 is right; expand once we have traffic data.
- A/B test the hero (villain-frame vs. quantitative-frame) after launch (Stage E / `ab-test-setup`).
- Add a "compared to Action Network" page (`/vs/action-network`) as the first pSEO surface in Stage E.
