# Competitor Landscape — Synthesis

**Generated:** 2026-05-12
**Depth:** quick scan across 5 competitors
**Methodology caveat:** WebFetch was sandboxed-denied during this pass; profiles built from WebSearch indexing of competitor pages plus third-party reviews (RotoWire, Trustpilot, Sportsbook Scout, OddsAssist, BettingUSA, SportsBettingDime, GamblingSite, EGR, Sportico). Verbatim hero copy should be verified against live sites before shipping landing-page text. Pricing, tiers, feature lists, and review themes are corroborated across multiple sources.

---

## Landscape overview

The "tools for bettors" market splits into 5 functional shelves, only one of which is a direct competitor to Cray Cray. **Action Network** is the only true picks + sharp-data app in the set — and the most strategically important to position against. **OddsJam** is a sharp-tier data terminal aimed at +EV traders, structurally too expensive for Cray's target user. **Pikkit** is post-bet (CLV / tracking) and complementary, not competitive. **BettorEdge** is a P2P marketplace — adjacent. **ESPN BET** is a sportsbook (likely being rebranded to theScore Bet) — Cray potentially deep-links *to* it.

The shared blind spot across all 5: **none publishes negative edges.** Each has a structural reason it can't:

- **Action Network** → owned by Better Collective (publicly traded sportsbook affiliate); revenue depends on sending users to books, not warning them off
- **OddsJam** → +EV ideology only surfaces opportunities, not traps
- **Pikkit** → measures the past (CLV), not the future
- **BettorEdge** → matches everything; can't publish "fade this side" without contradicting its own marketplace
- **ESPN BET** → it's the book

That structural gap is Cray Cray's wedge.

---

## Comparison table

| | Action Network | Pikkit | BettorEdge | OddsJam | ESPN BET | **Cray Cray** |
|--|--|--|--|--|--|--|
| **Type** | Picks + sharp data | Bet tracker + CLV | P2P marketplace | +EV scanner + arb | Sportsbook | Picks + math layer |
| **Pricing (paid)** | $29.99–69.99/mo | $39.99/mo | $19.99/mo | $99–199/mo | n/a (book) | TBD (trial → single tier) |
| **Free tier?** | No (paid trial $49/4d) | Yes (basic tracker) | Yes (limited) | No | n/a | Decision pending |
| **Sportsbook-agnostic?** | Yes, but parent = affiliate | Yes | No (is a book) | Yes | No (is a book) | **Yes — no affiliate parent** |
| **Publishes negative edges?** | No | No | No | No | No | **YES (Trap label)** |
| **Pre- or post-bet** | Both | Post | Bet placement | Pre | Bet placement | **Pre** |
| **Target bankroll** | $200+/mo | Any | $50–500/mo | $2K+/mo | Any | **$50–500/mo** |
| **AI narrative layer** | No | No | No | No | No | **Yes (De-Genny)** |

---

## Positioning map

```
                              Quantitative
                                   │
                  OddsJam ●        │
                  (data terminal)  │  ★ Cray Cray
                                   │  (math + negative edges + narrative)
                                   │
   ─── PRE-BET ──────────────────  ┼  ──────────────── POST-BET ───
                                   │
                Action Network ●   │  ● Pikkit
                (vibes + experts)  │  (tracker + CLV)
                                   │
                            Directional
```

**BettorEdge** sits off-axis (it's a venue, not a tool).
**ESPN BET** sits off-axis (it's the book itself).

Cray Cray's unique position: top-right quadrant (pre-bet × quantitative) **with a second axis no one else is on — "publishes negative edges."**

---

## Key strategic takeaways

### 1. The "Trap" label is genuinely defensible
This came back from every single profile. Every competitor has a structural business reason they can't publish negative edges. This isn't just a feature — it's a position no one else can adopt without breaking their model. It deserves hero-line real estate, not a feature-list bullet.

### 2. "Sportsbook-agnostic with no affiliate kickbacks" is a real wedge against Action Network
Action's parent company makes money sending bettors to sportsbooks. Cray's incentive is to grade the game honestly regardless of where the user places the bet. A credibility line — *"No affiliate kickbacks. Same edge no matter where you bet."* — is something Action literally cannot put on its own homepage without dismantling its parent's revenue model.

### 3. The price ceiling is OddsJam ($199), the floor is BettorEdge ($19.99)
Pikkit and Action both sit at $29.99–39.99. A Cray price in the $19.99–29.99 range hits the sweet spot for the $50–500/mo bankroll user that OddsJam structurally locks out. A free top-of-funnel (e.g. one sport's full edge board per day) wins every comparison page against Action's paywalled-with-paid-trial model.

### 4. The audience expects a sportsbook-sized welcome moment
ESPN BET (and every sportsbook) conditions bettors to expect a dollar figure above the fold (*"Bet $10, Get $100"*). Cray can't match that without lying — but the question is in users' heads on arrival. Answer it with a *concrete free value moment* (today's top 3 edges visible without signup, or a free Pick of the Day) so the page doesn't feel empty by sportsbook standards.

### 5. A free public Edge Calculator is a low-cost SEO wedge
BettorEdge's `/novig-calculator`, `/hold-calculator`, and `/fee-calculator` pages are clearly ranking workhorses. A Cray **Per-Side Edge Calculator** (paste any line, return signed pp edge + Trap/Strong-Play tier label) would (a) rank against their tools, (b) demo Cray's differentiator in 60 seconds, and (c) be a natural cold-traffic-to-signup funnel.

---

## Gaps and opportunities

| Gap in the market | What Cray Cray ships against it |
|---|---|
| Nobody warns you which side is a trap | The `−12.4pp · Trap` label, hero-grade |
| Bettors with $50–500 monthly bankroll have no analytical product they can afford | Sub-$30 tier with free top-of-funnel |
| Picks apps are owned by affiliates — recommendations are conflicted | "No affiliate kickbacks" credibility line |
| Data terminals overwhelm; sportsbook apps over-simplify | De-Genny narrates math in plain language |
| Post-bet tools tell you what already happened | Pre-bet edge grades the decision, not the outcome |

---

## Recommended landing-page narrative arc

**Hero (frame):** Math-graded picks. Including the ones you should fade.
**Sub (the proof):** Per-side edges in plus/minus points — for every market, every game. The model picks the side. De-Genny narrates.
**Section 2 (the wedge):** "Your book won't tell you which side is the trap. We will."
**Section 3 (how):** 30-second explainer of the per-side edge math + tier ladder.
**Section 4 (no conflict):** "Sportsbook-agnostic. No affiliate kickbacks."
**Section 5 (proof):** Live hit-rate (from `mv_model_accuracy`) by tier and sport.
**Section 6 (cold-to-warm):** Free public Edge Calculator OR "Today's free Pick of the Day".
**Section 7 (FAQ):** What's a Trap? Why do you show negative edges? Is this gambling advice? +21? etc.
**Footer:** 1-800-GAMBLER · "For entertainment / informational purposes only" · ToS · Privacy

---

## Per-competitor pages worth building (Stage E follow-up, not now)

- `/vs/action-network` — counter the directional-signals weakness with our quantitative per-side edges
- `/oddsjam-alternative` — counter the $199 floor with sub-$30 + free tier
- `/pikkit-vs-cray-cray` — frame it correctly: complementary (pre-bet + post-bet), not competitive

These are pSEO surfaces — they wait until Stages A–D are shipped.

---

## Raw profiles

- [action-network.md](action-network.md) — the primary head-to-head competitor
- [pikkit.md](pikkit.md) — complementary post-bet tracker
- [bettoredge.md](bettoredge.md) — adjacent P2P marketplace
- [oddsjam.md](oddsjam.md) — sharp-tier data terminal
- [espn-bet.md](espn-bet.md) — sportsbook (possibly rebranding to theScore Bet)
