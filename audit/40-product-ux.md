# 40. Product and UX audit

Scope: the public landing page as deployed (Vite SPA, `src/pages/Landing.jsx`, live JSON from `/api/public-stats`, `/api/public-ticker`, `/api/public-pod`) and the authenticated app as read from source in `/Users/vincentmorello/GHRepositories/Cray_Cray_Parlay_App/src`. This section covers page inventory, the first-run funnel, the product's center of gravity, prioritized findings, and the minimum bar before charging money.

## 1. Page inventory

There is no react-router. `src/main.jsx` mounts `components/MainApp.jsx`, which is simultaneously the router, the app shell, and the pick generator page. Navigation is a mix of boolean state flags, full-screen overlay divs, and a hand-rolled hash listener for `#/admin`, `#/digest`, `#/chat`, and `#/betslip`.

| Surface | File | How reached | Job |
|---|---|---|---|
| Landing | `src/pages/Landing.jsx` (1,064 lines) | Unauthenticated root | Marketing page. Live stats, ticker, track record, competitor scorecard, free pick, pricing, FAQ. |
| Auth modal | `src/components/Auth.jsx` | Overlay | Email/password plus Google OAuth via Supabase. |
| Generator shell | `src/components/MainApp.jsx` (1,373 lines) | Authenticated root | Interactive pick generator. Sport and bet-type filters, calls `/api/suggest-picks`, builds a parlay, "Lock Build" writes to Supabase. Also hosts the menu, header stats, and all overlays. |
| Daily Digest | `src/pages/DailyDigest.jsx` (1,956 lines) | `#/digest`, menu, auto-route after sign-in | Morning briefing from precomputed `/api/digest`. Pick of the Day, six-tier board, injuries, recap, model performance, sticky "Build Parlay" bar. |
| Betslip Builder | `src/pages/BetslipBuilder.jsx` | `#/betslip`, menu | Natural-language pick parser producing DraftKings and FanDuel deep links. Receives digest picks via localStorage. |
| Chat Picks | `src/pages/ChatPicks.jsx` | `#/chat`, menu | Chat with the model for personalized picks. |
| Results | `src/pages/ResultsPage.jsx` | Menu | Model and user results by period and dimension. |
| User Dashboard | `src/components/Dashboard.jsx` | Menu, modal overlay | Personal parlay history and outcome stats. |
| Admin Dashboard | `src/pages/AdminDashboard.jsx` | `#/admin` | Data freshness and pipeline health. Gated by a hardcoded client-side secret (`ADMIN_SECRET = 'admin123'`, line 4). |
| Suggestions This Week | inline in MainApp | Menu | A "Coming soon" placeholder modal shipping in production nav. |

Dead code, imported by nothing: `App.jsx` and `AppLegacy.jsx` (two full former app entry points, both still referencing the retired `/api/generate-parlay` endpoint), `Dashboard-broken.jsx`, `Dashboard-simple.jsx`, `ParlayBuilder.jsx`, `ParlayOutcomeManager.jsx`, `ProgressSteps.jsx/.css`. Roughly 2,300 stale lines, all in the old design system.

## 2. First-run funnel

The intended path is sound: Landing, Start trial, signup, then an effect in MainApp detects the sign-in transition and routes the new user to `#/digest`. The digest is the right first screen. The funnel leaks at five points.

1. **Google OAuth skips the digest.** OAuth does a full redirect round trip, so the session is already valid when the app hydrates and the sign-in transition never fires. Google signups land on the legacy-feeling generator form, the exact experience the auto-route was written to prevent. Email signups get the good path, Google signups do not.
2. **Email confirmation is a dead end.** `Auth.jsx` closes the modal on signup success with no "check your email" message. If Supabase confirmation is on, the user is returned to the landing page with no explanation.
3. **No trial or onboarding state exists.** The landing promises "7 days, no card" but nothing in the client tracks a trial, marks day one, or distinguishes a first visit from a hundredth. There is also no billing code at all.
4. **Back from the digest lands on the generator.** The digest's Back button drops the user on the config-heavy MainApp form with empty sport selection and two competing CTAs. To a day-one user it reads as a different, older product.
5. **The aha moment depends on the board.** Pick of the Day hides below a 7pp edge, which is honest, but on a quiet day a trial user's first digest may have no featured pick and no guidance on what to do instead.

On the public side, the funnel has parallel problems before signup. The served HTML is an empty root div titled "craycrayapp" with a stock Vite favicon and no meta or Open Graph tags, so shared links have no preview and search engines index nothing. The strongest friction-killer, "no card required," appears only in the pricing section rather than under the hero CTA. And the live ticker currently opens with six consecutive Traps in red, so the first thing a visitor scans looks like a wall of losses.

## 3. Generator versus digest: where is the center of gravity

The digest, clearly, and the code says so itself. Sign-ins auto-route to it, the landing page sells "Sharp Takes" and the edge-tier vocabulary that only the digest speaks, the digest carries the trust anchors (30-day hit rate, tier track record), and it is the most actively maintained file. MainApp's own comments call the generator form "jarring after the new Sharp-Quant Landing." The generator is a lift of the legacy `App.jsx` with class names renamed. It still ships the retired Low/Medium/High risk vocabulary and 1-to-10 confidence scores that the digest team deliberately replaced with signed edges and the six-tier Trap-to-Sharp-Take scheme.

The two surfaces also produce different-quality data for the same user action. Generator locks carry real odds. Digest locks hardcode odds at -110 and default confidence from edge score. MainApp additionally stamps every lock with `ai_model: 'gpt-4o-mini'` regardless of what generated the picks. Two builder UIs, two odds calculators, two duplicate accuracy queries, and two fake-progress loading screens round out the split.

**Recommendation.** Keep the capability, retire the implementation. Users still need "give me picks for the sports I choose," but that should be a filtered view of the same edge-tier pick data the digest uses, speaking one grading language and writing one lock payload with real odds. This is blocked on one prerequisite: MainApp is router, shell, and page in a single file, and the page cannot be retired until the router and shell are extracted. Extract routing first, make `/digest` the authenticated default, then rebuild the generator as the filter view and delete the old form.

## 4. Prioritized findings

### High

1. **Google OAuth first-run lands on the wrong screen.** Route any user with zero locked parlays to the digest, or persist a just-signed-up marker. Small change, highest leverage for trial retention.
2. **The public page is invisible before JavaScript.** Empty served HTML, default title and favicon, no meta description or OG tags. For a product selling credibility, this reads as a side project. Add real metadata and prerender or SSR the landing route.
3. **The public tier data undercuts the pitch unexplained.** Play (42.2 percent) and Strong Play (45.7 percent) render as red losing tiers next to a $19.99 ask, and Trap at 40.7 percent, which is actually the model working, gets the same red failure styling. Add framing copy, distinguish Trap visually, and decide whether Play and Strong Play need recalibration or an honest annotation.
4. **Routing is hand-rolled and broken.** The hash listener only ever sets flags true, browser Back does not close surfaces, and overlays can stack by accident. Adopt real routing with `/digest` as the authenticated default. This unblocks the generator rebuild.
5. **Admin is gated by a hardcoded secret in the client bundle** (`AdminDashboard.jsx` line 4). Move admin auth server-side.
6. **Lock-time data integrity.** Hardcoded -110 odds and a hardcoded model label corrupt the settlement record that the entire transparency pitch depends on. Unify to one lock payload with real odds.

### Medium

7. **Two grading languages in production.** The generator's Risk Level and 1-to-10 confidence contradict the edge-tier system the brand is built on. Retire the old vocabulary with the generator rebuild.
8. **Email signup confirmation dead end** in `Auth.jsx`. Add a confirmation state.
9. **Ticker ordering.** Interleave positive and negative edges or lead with the top positive edge so the first impression is not six red Traps.
10. **"No card required" is buried.** Add it as a caption under the hero CTA.
11. **Invented competitor numbers styled as data.** The "-8.2pp" scorecard values are admitted as illustrative in 10px text. A skeptical bettor who catches this discounts the real numbers. Drop the fake values or clearly mark them editorial.
12. **Mobile nav loses all anchors.** No hamburger, so mobile visitors cannot jump to pricing or proof, and the track record table's fixed columns crush tier names at 375px.
13. **The best proof point is undersold.** Sharp Take all-time at 63.5 percent with +23.1 percent ROI on 1,153 graded picks appears once as a small row. Verify the "last 30d" label on the hero number is accurate and promote the ROI line.
14. **Dead code and placeholder UI.** Delete the seven unreferenced files and the "Coming soon" menu item. Zero risk, removes the old design system's gravity.
15. **Accessibility.** Accordions lack `aria-expanded`, infinite animations have no `prefers-reduced-motion` guard, and annotation text at `ink-500` and `ink-400` fails AA contrast on the dark background.

### Low

16. **Duplicated logic.** Two odds calculators, duplicate accuracy queries, an API base URL string repeated across at least five files despite `src/config.js` existing for that purpose.
17. **Fake loading theater.** MainApp's scripted progress log is time-based fiction while the digest loads real data instantly. Kill it with the rebuild.
18. **Copy tics.** "[ Execute trial ]" at the highest-intent click, a circular tier subtitle for Sharp Take, and a 15pp free-pick edge with no methodology link.
19. **OAuth redirect hack.** `Auth.jsx` hardcodes a localhost redirect with leftover debug logging.
20. **Blocked TODO.** `bet_amount` is commented out pending a database migration (MainApp line 743).

## 5. What to fix before charging money

Money changes the standard. Before a paid tier goes live, these must be done, roughly in order.

1. Fix the Google OAuth first-run route so every new user's first screen is the digest.
2. Add the email-confirmation state so paying signups are never silently dropped on the landing page.
3. Fix lock-time data integrity (real odds, correct model label). The settlement ledger is the product's proof and it is currently recording fiction on one of two paths.
4. Add framing for the losing public tiers and restyle Trap. Do not sell a subscription next to unexplained red numbers.
5. Move admin auth server-side.
6. Ship real HTML metadata and a favicon so paid acquisition links unfurl properly.
7. Build actual trial state and billing. Nothing in the client tracks or enforces the trial the landing page promises, which today makes "7 days, no card" a claim without a mechanism.
8. Add a quiet-day fallback in the digest so a trial user's first session always has a next step.

The generator rebuild and routing extraction are the biggest structural items but can land immediately after launch. The eight items above are the ones a paying customer would hit in week one.