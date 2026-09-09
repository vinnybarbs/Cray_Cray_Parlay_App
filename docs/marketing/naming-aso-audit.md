# Naming ASO Audit — Phase 4b (v2 redo)

**Generated:** 2026-05-12
**Scope:** App Store Optimization viability for the sole v2 survivor: **Fadeline**
**Inputs:** [`naming-seo-audit.md`](./naming-seo-audit.md), [`naming-ai-seo.md`](./naming-ai-seo.md), `/aso-audit` skill framework

---

## App Store search behavior for "Fadeline"

### Apple App Store

Search for `"Fadeline"` returns **zero exact matches**. Closest results are auditorily similar but categorically distinct:
- **FineLine Catalog** — tableware catalog ([apps.apple.com](https://apps.apple.com/us/app/fineline-catalog/id963800108))
- **FlightLine** — aviation
- **Fastline** / **FastLines** — sports schedules (not betting)
- **Fade It** — photo editor

No direct or near-direct competitor named Fadeline. The keyword is **open**.

### Google Play

Search for `"Fadeline"` returns **zero exact matches**. Closest:
- **FateLines: Hand Reader** — palm reading ([play.google.com](https://play.google.com/store/apps/details?id=com.fatelines.app))
- **Fade In Mobile** — screenwriting companion
- **FedPhoneLine** — corrections facility calling

Same conclusion: **open keyword**, no competitor.

### Auditory near-match flag (note, not block)

**Fine Line** ([getfineline.app](https://www.getfineline.app/)) is a soccer-only value-betting app — same broad category, different spelling, different sport vertical. Risk: a user hearing "Fadeline" might mis-spell to "Fine Line." Mitigation: solid SEO + brand consistency. Not a blocker.

---

## Apple App Store metadata fit

App name (30 chars), subtitle (30 chars), and keyword field (100 bytes) all easily accommodate Fadeline:

| Field | Limit | Proposed | Char count | Headroom |
|---|---|---|---|---|
| Title | 30 | `Fadeline: Math-Graded Picks` | 27 | 3 |
| Subtitle | 30 | `Sports edges. Including traps.` | 30 | 0 |
| Keyword field | 100 bytes | `sports,betting,picks,edge,parlay,line,sharp,handicapping,+EV,value,calculator` | ~92 | ~8 |

Apple's rule: no word can repeat across title/subtitle/keyword. None of "Fadeline" appears in subtitle or keyword field — clean.

Plenty of room to stack high-value category keywords ("sports betting picks," "edge calculator," "+EV," "value," "handicapping," "parlay," "sharp"). Strong ASO foundation.

### Google Play metadata fit

- Title (30 chars): same as Apple — `Fadeline: Math-Graded Picks` works.
- Short description (80 chars): `Per-side edges for every game. Math-graded picks including the traps.` (70 chars)
- Long description (4,000 chars): Google indexes this heavily — keyword density 2-3% target is easy with sports-betting vocabulary.

Title is 8 chars (Fadeline) — leaves substantial room for descriptive keywords in the brand-first slot.

---

## Apple content policy review risk

This is the meaningful risk, and it's **category-level, not name-level.**

Per [Apple Developer Guidelines 5.3 (Gaming, Gambling, Lotteries)](https://developer.apple.com/app-store/review/guidelines/):

> *"Apps that offer real money gaming (sports betting, poker, casino games) must have necessary licensing and permissions, must be geo-restricted, and must be free on the App Store."*

**Cray Cray is NOT a real-money betting app.** It's an info-only handicapping/analytics product. We:
- Never hold user funds
- Never place wagers on the user's behalf
- Hand users deep-link betslips to their own DraftKings/FanDuel sessions
- Are functionally a "Sports" or "Reference" category app

**Comparable apps that live cleanly in Apple's Sports category** as info-only:
- OddsJam, Action Network, Pikkit, Unabated, Sharp App — all info products, no real-money handling

**Risks that ARE elevated for our category (any name):**
- Age rating questionnaire: "frequent or intense gambling-related references" toggle = 17+ minimum
- Apple's review team has historically been hawkish on sports-betting-adjacent apps even when info-only
- Brazil-specific rule (May 2026): apps with fixed-odds betting features need a Brazilian SPA license — we should geo-block Brazil at launch to sidestep this entirely
- May 8, 2026 policy update flagged "any app for which the developer selects 'Yes' to the gambling question in the age rating questionnaire"

**Name-specific Apple risk for Fadeline:** Negligible. "Fade" is sports-betting jargon but not a regulated term. The name doesn't trigger any additional review friction beyond what any sports-betting-analytics app faces.

---

## ASO viability score: **5/5**

- Title/subtitle/keyword field fit cleanly with substantial keyword headroom
- Zero App Store or Google Play name collisions
- One auditory near-match (Fine Line — different sport vertical, different spelling) is not a real conflict
- Apple content-policy review risk is category-level (real for ANY sports-betting-analytics app) and not amplified by this specific name
- "Fade" as part of the brand is contextually pre-loaded for the App Store algorithm to surface Fadeline in "fade the public," "value betting," "sharp picks" searches

---

## Recommended App Store launch posture

1. **Category:** Sports (primary), Reference (secondary)
2. **Age rating:** 17+ via gambling-references toggle (unavoidable for the category)
3. **Geo-restriction:** US-only at launch — avoids Brazil license requirement + simplifies state-by-state compliance handling
4. **Required disclosures:** "For entertainment and informational purposes only · not gambling advice · +21" (already in product footer; bake into App Store description)
5. **Review-risk mitigation:** never reference "guaranteed wins" / "lock" / "free money" / any certainty language in metadata. Already aligned with `.agents/product-marketing-context.md` §10.

---

## Composite scoring across all four naming dimensions (Fadeline)

| Dimension | Score | Notes |
|---|---|---|
| SEO viability | 5/5 | Only Obsidian plugin and a font; can rank #1 within 6 months |
| AI-search viability | 5/5 | Clean; zero notable brand contamination |
| ASO viability | 5/5 | Open keyword on both stores; metadata fits cleanly |
| **Composite (subjective)** | **5/5** | Best-in-class across every objective filter |

Final remaining check: **Phase 5 — real WHOIS verification + social handle availability + USPTO TESS scan** before the rebrand sweep gets ordered.

---

## Sources

- [Apple App Review Guidelines (5.3)](https://developer.apple.com/app-store/review/guidelines/)
- [Apple Brazil betting license requirement (May 2026)](https://ppc.land/apple-now-requires-brazilian-betting-license-for-app-store-gambling-apps/)
- [Fix Apple Gambling App Rejection (5.3)](https://shopapper.com/fix-apple-gambling-app-rejection-guideline-5-3/)
- [Fine Line value-betting app (auditory near-match)](https://www.getfineline.app/)
- App Store search results: zero direct collisions on "Fadeline"
- Google Play search results: zero direct collisions on "Fadeline"
