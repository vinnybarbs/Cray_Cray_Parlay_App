# Instagram Marketing Playbook: Cray Cray for Parlays

Scope: a compliance-first Instagram plan for a $19.99/mo parlay picks subscription with a public, verifiable settlement ledger, run by a solo founder, launching for the NFL season. Everything below is built around the one asset competitors cannot fake, which is the receipts.

## 1. Compliance guardrails first

These rules are the boundary of everything else in this document. Get these wrong and the account or ad account gets actioned before the funnel ever matters.

### Where we sit in Meta policy

- Meta's Online Gambling and Games ad standard restricts "any product or service where anything of monetary value is included as part of a method of entry and prize" (transparency.meta.com, Restricted Goods and Services, Gambling and Games). A picks subscription has no entry-and-prize mechanic, so we fall outside the literal definition. Important nuance: the often-quoted rule covering "tips or picks" services is X's policy, not Meta's. Do not plan against the wrong platform's rulebook.
- Two adjacent Meta rules still pull us toward the restricted category. First, ads with landing pages that promote gambling, bonuses, or promo codes, or that redirect to operators, are treated as gambling ads. Second, the July 2025 update created operator, aggregator, and affiliate roles that all require authorization with licensing proof per targeted territory. We take no affiliate money and link to no sportsbook, so we do not clearly fit any of those roles, but Meta's automated classifiers key on betting vocabulary (parlay, picks, odds, win rate) and routinely flag picks-service ads into the gambling bucket anyway.
- Practical posture: treat paid ads as gated until we either obtain authorization through the Business Suite Authorizations and Verifications tab under the "otherwise established as lawful" clause, or accept a cycle of rejections and manual appeals. Organic content is not subject to this authorization requirement.

### Organic rules we must follow

- No guaranteed-win or get-rich framing anywhere. Meta rejects "guaranteed money from winning" language even for authorized gambling advertisers, and its general misleading-claims standards apply to organic content too.
- No selling or payment solicitation inside DMs. DM funnels deliver information and a link, never a pitch sequence that closes payment in the thread. This behavior pattern is what gets picks accounts removed, not the picks themselves.
- No paid-partnership posts with creators promoting us unless the creator completes Meta's affiliate registration and approval process with a documented commercial relationship. If we publish the post ourselves and merely tag the creator, no creator authorization is needed. Prefer the second structure.
- Expect reduced non-follower distribution. Instagram applies a higher standard to content recommended to non-followers, and regulated-product-adjacent content is plausibly excluded from recommendations. Plan reach around shares and saves from real followers, not the explore page.
- All DM automation must be user-initiated (comment, story reply, or inbound DM), stay inside the 24-hour messaging window, and respect the roughly 200 automated DMs per hour cap.

### FTC rules on our performance claims

- The 63.5% top-tier win rate is publishable only when the claim exactly matches the ledger's scope: which tier, which period, how graded. The ledger is the written substantiation the FTC requires to exist before the claim runs. Freeze a dated snapshot of the ledger every time a stat appears in content.
- Never imply subscriber profit. "You would have made $X following our picks" is an earnings claim, the FTC presumes consumers read it as typical, and a "results not typical" disclaimer does not cure it. The WealthPress settlement ($1.7M, a trading picks subscription) is the direct precedent for our product shape.
- Standing disclaimer on every post and in the bio: for entertainment and informational purposes, 21+, no guarantee of results, gamble responsibly, 1-800-GAMBLER.

### Self-imposed standards

- 21 and over positioning everywhere, even though Meta's floor is 18. It matches the product's stated standard and mirrors industry practice for operators.
- Never link to a sportsbook, never publish promo codes, never take affiliate money. This is what keeps us out of the affiliate role under Meta's July 2025 framework and it is also the brand position.

## 2. The organic engine: receipts culture

### Account concept

The niche's defining trust problem is fake records. The most-followed capper on Instagram claims a mathematically impossible 71.5% win rate and is a convicted fraudster. The audience is pre-burned. The account concept is the anti-capper: every pick graded in public, losses posted with the same energy as wins, and a Trap label that tells followers when a popular bet is bad. The bio says it plainly: every pick graded, wins and losses, full ledger at the link.

The proof this works at small scale is PropBetGuy, who built a media career on posting and grading every bet and reached about 25K followers in 16 months. We do not need B/R Betting's million followers. Micro accounts in sports niches average 3.8% engagement versus 1.2% for macro accounts, and a few thousand engaged followers is a viable subscription business at standard conversion rates.

### Content pillars

1. Receipts (signature pillar, daily). Nightly graded-results card straight from the settlement ledger. Wins, losses, running record, units. Losses get posted on time, every time. This is the moat.
2. Today's card (daily). Morning free pick card with the edge math visible. One genuinely good free pick per day so the public record is real, with the full slate behind the paywall.
3. Trap of the day (3 to 5 per week, the meme-able pillar). Call out a popular public parlay leg with negative edge and show the math. This is entertainment plus proof of rigor, and it is the format most likely to earn DM shares, which now outweigh likes in ranking.
4. How the math works (2 per week). Carousels and short Reels on expected value, why parlays are priced against you, how we grade. Educational saves drive ranking and build the trust that converts.
5. Founder voice (2 to 3 per week, human-made). Talking-head Reels, reactions to NFL news, week recaps. Fully templated feeds stagnate, and this is the pillar automation cannot produce.

### Format mix and cadence

- Roughly 60% Reels, 25% carousels, 15% static. Reels reach about 30.8% of audience on average, more than double other formats, and about 55% of Reels views come from non-followers.
- Daily rhythm: pick card in the morning, graded receipt at night, 1 to 2 Stories through the day (poll, countdown to kickoff, ledger screenshot). That is 10 to 14 feed posts per week, comfortably above the 3 to 5 posts per week threshold that Buffer's data associates with doubled follower growth.
- Test Reel length in both the 15 to 30 second and 60 to 90 second bands, since sources conflict on which wins.
- No engagement pods ever. Tested reach is worse than organic and Instagram's late-2025 inauthentic-engagement update collapsed pod-reliant accounts.
- Giveaways only as a launch-week spike, routed through a landing page to capture email, and understood as low-intent followers.

## 3. The automation pipeline: ledger to graphic to post

The app already exposes structured picks and settlement data. The pipeline turns that into the two daily anchor posts with zero manual work.

### Architecture

1. Railway cron fires twice daily, after morning grading and after nightly settlement.
2. Fetch pick and results data from the existing app APIs (today's card and the settlement ledger endpoints).
3. Render branded cards programmatically. Recommended: Satori (the vercel/og engine) rendering JSX templates to PNG, free, versioned in git, deterministic layouts fed by JSON fields such as matchup, edge, Trap label, and running record. Fallback for maximum CSS fidelity: a Puppeteer screenshot route on Railway. Managed alternative if design iteration in code is unwanted: Placid at $19 to $39/mo or Bannerbear at $49/mo.
4. Upload PNGs to public storage (R2 or S3), since the Instagram API requires a publicly hosted media URL.
5. Generate the caption from structured data: record, edges, Trap callout, the standing 21+ and responsible-gambling disclaimer, and the comment-keyword call to action. Captions come from vetted templates, not freeform generation, so every published sentence has been compliance-reviewed once.
6. Publish through the Instagram Graph API two-step flow (create media container, then publish). Requires a professional account and a Meta developer app. Posting to our own account runs in Development mode without App Review. Limits are generous: 100 API posts per 24 hours, and a carousel counts as one.
7. Log published media IDs back to the database and pull insights (reach, saves, sends) the next day for a growth dashboard.

### DM automation

ManyChat (Meta-approved) runs comment-to-DM funnels. Every free pick post carries "comment PICKS and I'll DM you today's card." The comment triggers an automated DM with the pick graphic and the link-in-bio checkout. DM open rates run 70 to 90%, and the comment volume itself boosts the post's ranking. Start on ManyChat Pro at $29/mo, budgeting up toward $69 to $139/mo as active contacts grow.

### Stack and cost

| Component | Tool | Monthly cost |
|---|---|---|
| Publisher and cron | Own code on existing Railway app | $0 |
| Card rendering | Satori or Puppeteer route | $0 (or Placid $19 to $39 if managed) |
| Media hosting | R2 or S3 | ~$1 |
| DM funnels | ManyChat Pro | $29, scaling with contacts |
| Scheduler | None needed | $0 |
| Total | | roughly $30 to $50 |

### Operational safeguards

Alert on failed publishes (expired tokens, container errors, image URL 404s), since Meta tokens and API versions rotate. Budget one founder hour per week for monitoring.

## 4. Paid strategy, if and when permitted

Paid is phase two, not launch. Sequence:

1. Before any spend, apply for authorization through the Business Suite Authorizations and Verifications tab, presenting the product as an informational subscription under the "otherwise established as lawful" clause. Expect a manual, slow, English-language review. Document that we hold no bets, move no money, and link to no operator.
2. If authorized, targeting rules: 21+ only (self-imposed above Meta's 18 floor), US territories only, exclude Meta's prohibited-market blacklist automatically, and mirror licensed-operator state exclusions as the conservative play even though they do not legally bind an informational service.
3. Creative rules: no money imagery, no "win," "guaranteed," "lock," or income framing. The compliant angle is the transparency claim itself: "Every pick we have ever made is graded in public. Here is the ledger." Any statistic in an ad must match a frozen ledger snapshot, and the landing page must contain zero sportsbook links, bonuses, or promo codes so the landing-page rule cannot reclassify the ad.
4. If not authorized, do not run workaround creative with sanitized vocabulary. Repeated rejections accumulate ad-account risk. Organic remains the growth lane, which is how the entire capper economy already operates.

## 5. Conversion funnel: follower to trial

1. Discovery: Trap Reels and receipts posts earn sends and saves, the two signals Instagram now weights most.
2. Capture: comment keyword on the free pick triggers the ManyChat DM with today's card and one link. The DM is informational only, no selling in-thread.
3. Bridge: link in bio goes to a page with the live public ledger front and center, the free daily pick by email or a free community tier, and the $19.99 checkout. The free tier must deliver real value (the one daily graded pick), because free tiers with no substance produce inactive members who never convert.
4. Convert: the ledger page is the closer. The pitch is one sentence: you have watched us grade every pick in public, the full slate is $19.99.
5. Benchmarks to plan against: 5 to 15% of free-tier members convert to paid in comparable picks communities (single-source operator data, treat as directional). At $19.99 we sit at the bottom of the standard $20 to $50 pricing band, which supports volume positioning and an eventual premium tier.
6. Retention content: monthly "state of the ledger" post showing the full record, good or bad. Subscribers who watched losses get posted honestly churn less than subscribers sold a fantasy.

## 6. 30-day launch calendar sketch

Timed so day 1 lands about two weeks before NFL Week 1.

- Days 1 to 5, foundation. Professional account, bio with disclaimer and ledger link, developer app and API permissions, card templates designed, ManyChat funnel built, 9-post seed grid published (3 how-the-math-works carousels, 3 sample receipt cards from the preseason ledger, 3 founder-intro Reels).
- Days 6 to 12, rhythm. Automated daily cadence goes live: pick card AM, receipt PM, Stories daily. First Trap of the day Reels. Comment keyword active on every pick post. One launch giveaway routed through the email landing page.
- Days 13 to 19, proof week (NFL Week 1). Full slate energy. Nightly receipts including every loss. First weekly ledger recap Reel with the running record. Founder reaction Reels to opening-week results. Push saves with "save this card for Sunday" framing.
- Days 20 to 26, conversion week. Introduce the free-tier bridge explicitly in captions and DMs. Publish the "how we grade" carousel and a "why we post our losses" founder Reel. First monthly state-of-the-ledger post.
- Days 27 to 30, review. Pull API insights: sends, saves, comment-to-DM conversion, link clicks, trials. Kill the weakest format, double the strongest. File the Meta paid-ads authorization request now that the account has a body of clean content behind it.

Throughout: 2 to 3 human-made posts per week on top of the automated cards, per the pillar plan.

## 7. What needs a human

- One-time setup: professional account, developer app and permissions, template design, ManyChat flows, and the App Review screencast if we ever publish for accounts beyond our own.
- Voice and reactive content: trend commentary, memes, NFL news reactions, talking-head Reels, collabs. Roughly 2 to 3 posts per week that a template cannot produce.
- Community management beyond keyword funnels: nuanced comments, complaints, and above all any user hinting at problem gambling, who must receive a human response with responsible-gambling resources and never an automated upsell.
- Compliance review: periodic audit of every caption template and any new stat framing against the FTC substantiation standard, plus a frozen ledger snapshot filed whenever a performance number ships in content or ads.
- Policy escalation: if Meta flags content or the ad authorization stalls, appeals are manual and founder-owned.
- Weekly monitoring hour: failed publishes, token expiry, API version changes, and the insights review that steers the content mix.