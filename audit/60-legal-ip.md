# Legal and IP Guidance

Scope. This document covers IP strategy, the regulatory position of a paid picks service, advertising compliance for the verified win-rate claim, disclaimers, payment and subscription rules, and basic business hygiene for Cray Cray for Parlays as a solo-founder, pre-revenue subscription planned at $19.99 per month.

This is research-based guidance compiled from public sources, not legal advice. The short list of items worth actual attorney hours is at the end.

## 1. IP strategy

### Recommendation in one line

Protect the algorithm as a trade secret, file the trademark before launch, skip the patent, and rely on speed and the verified ledger for competitive moat.

### Why not a patent (the Alice problem, honestly)

A patent on the prediction algorithm is a poor investment for three reasons.

First, eligibility. Under the Alice framework, claims directed to abstract ideas such as math and fundamental economic practices are ineligible under 35 U.S.C. 101 unless they add significantly more. The betting-specific precedent is directly against us. In re Smith (Fed. Cir. 2016) held that rules for conducting a wagering game are an abstract idea, reasoning that wagering is a method of exchanging and resolving financial obligations based on probabilities. A claim that amounts to "compute an edge from odds and stats" combines a mathematical concept with a fundamental economic practice, which is squarely in the kill zone. The USPTO's 2024 AI guidance did not soften this. AI claims survive only when they show an improvement to computing technology itself. "My model picks winners better" is a business outcome, not a technical improvement, so it fails that test.

Second, economics. Expect $15k to $25k plus in drafting and prosecution, a 2 to 3 year pendency that lands well after launch, and a granted patent (a few exist, such as US 11,127,250 for an AI sports betting engine) that remains a prime Alice invalidation target the moment it is asserted. A solo founder cannot fund the litigation that would make it worth anything.

Third, disclosure. Filing publishes the methodology, which destroys the trade secret alternative. The patent path and the trade secret path are mutually exclusive, and the trade secret path is better on every axis here.

### Trade secret, the actual plan

The SaaS shape of the product is ideal for trade secret protection. The model runs server-side and never ships to customers, which is the classic protectable configuration under the DTSA and state law. Protection requires reasonable secrecy measures, and courts dismiss cases where basic ones are missing. The checklist is cheap and concrete.

- Signed NDAs before any disclosure to contractors, partners, or potential acquirers, and confirm the NDA binds the entity that actually receives the information. That exact gap lost the Protege Biomedical case.
- Include the DTSA whistleblower-immunity notice in every NDA and contractor agreement. Omitting it forfeits exemplary damages and attorney fees.
- Access controls. Private repos, 2FA, revoke contractor access on rolloff, mark model files and docs Confidential.
- Keep a dated internal document that identifies the secret specifically (features, weights approach, edge formula). Courts dismiss trade secret claims described only in vague outcome terms.
- IP assignment clauses in any contractor agreement so code written for the product is owned by the entity.
- Never publish the methodology. Market the verified ledger and the Trap label as outputs. The transparency positioning must stop at inputs and results, never the model internals.

### Trademark plan, including the CRAY question

File for "Cray Cray for Parlays" plus the logo in Class 41 (entertainment and information services, where gambling and sports-information marks live, and where Betfair registered SAME GAME PARLAY). Add Class 42 for the SaaS layer if budget allows. Base fee is $350 per class under the 2025 fee structure, and using preapproved ID Manual descriptions avoids the surcharges. Expect a disclaimer requirement on "PARLAYS" as generic for the services. Timeline is roughly 10 to 18 months to registration, so there will be no registration by launch, but the filing date locks priority and TM can be used immediately.

The knockout search found no identical or near-identical live mark. The closest live filing in the space is PARPLAY (a betting-social app, filed August 2025), which differs meaningfully in sound, appearance, and meaning. SO CRAY CRAY is registered for fragrances, an unrelated field.

On the HPE Cray conflict specifically, the risk is low. HPE's CRAY marks cover supercomputers and HPC products in Class 9. Likelihood of confusion requires related goods and services, and consumer sports picks in Class 41 are commercially remote from enterprise supercomputers. The commercial impression also differs. "Cray Cray" reads as slang for crazy, while CRAY is a founder surname. A dilution claim would require CRAY to be famous to the general consuming public, a hard showing for an enterprise HPC brand. Residual risk is nonzero because large companies sometimes oppose anyway, so spend one attorney hour on a clearance review (roughly $500 to $1,500) before filing.

### Copyright and data rights (the fine print that matters)

The picks, edge percentages, and ledger entries get almost no copyright protection. Under Feist, facts are not copyrightable, and courts have specifically held sports stats unprotected. Nothing in copyright law stops a subscriber from republishing the daily picks. Control that through the terms of service, rate limiting, and per-account watermarking, not IP law. The narrow hot-news doctrine cuts both ways and also means the sportsbooks whose odds we ingest have little IP claim over odds used as model inputs.

Two data-sourcing findings from the research are load-bearing.

- The Odds API. Current use is permitted. Its terms encourage commercial use in user-facing applications provided the data is not the primary product being sold. A picks product where odds feed graded edges fits. Do not add a raw odds feed or bulk export feature, and get written confirmation before ever exposing odds through an API of our own.
- ESPN data is a real problem. ESPN has no official public API, the endpoints in use are unofficial, and the Disney Terms of Use restrict the sites to personal noncommercial use and prohibit scraping and data compilation. Using scraped ESPN data inside a paid product is a terms breach with contract exposure, plus the practical risk that the endpoints break mid-season. Migrate scores and stats to a licensed source (The Odds API scores endpoints, SportsDataIO, Sportradar, or similar) before charging money.

## 2. Regulatory position of selling picks

Selling sports picks is legal in all 50 states, and no state currently licenses or registers tout services as such. The general rule is that betting advice is protected commercial speech so long as the business never takes bets, never places bets, never holds customer funds, and never shares in winnings. The product's structure sits on the safe side of every one of those lines. The federal Wire Act applies to those in the business of betting or wagering and expressly exempts transmission of information assisting legal betting, so a picks publisher is outside it.

The licensing regimes that do exist (vendor, supplier, and affiliate licenses in states like Colorado and New York) attach only to companies doing business with licensed sportsbooks, meaning marketing affiliates paid CPA or revenue share. Because Cray Cray takes no affiliate revenue, it stays outside all of them. This is a genuine structural advantage and a boundary worth protecting. The day the product adds sportsbook affiliate links, it inherits state-by-state affiliate licensing and each state's operator advertising rulebook.

State-level edges to respect.

- Never use performance-based or outcome-contingent pricing. Flat subscription only.
- A few states have statutes about communicating betting information with intent to further unlawful gambling (Georgia) or profiting from advancing unlawful gambling (New York). Because subscribers presumably bet on legal regulated books, exposure is low, but frame everything as information about legal wagering and consider disclaiming or geoblocking hostile states (Georgia, Utah, Washington).
- The planned machine-built parlay feature moves closer to individualized wagering instruction than commentary. It is likely still lawful information, but label the combinations as illustrations of model output rather than instructions, and get a one-hour gaming-lawyer read before shipping it.

## 3. Advertising claims and the ledger as FTC substantiation

FTC Act Section 5 and matching state UDAP laws are the main federal exposure, and the 63.5% win rate is the core claim at issue. Every objective performance claim must be substantiated before it is advertised, meaning the records proving 63.5% must exist at the moment the number appears in marketing. State AGs share this authority and are the more likely enforcer against a small operator. The tout category is associated with fraud (the BBB flagged guaranteed-win handicapper schemes in 2025), so a clean operator should over-document.

For the published ledger to actually function as substantiation, it needs all of the following.

- Completeness. Every graded pick, no deletions, no retroactive edits. Treat the ledger as immutable and auditable.
- Defined population. State exactly which picks, which tier, which timeframe, and which odds produce the 63.5% figure. No cherry-picked windows.
- Timestamps proving each pick was published before the game started.
- Stated grading methodology and settlement source, published where subscribers can read it.
- Odds context. A win rate without odds can itself mislead, since 63.5% on heavy favorites can lose money. Pair the win rate with units or ROI at stated odds. That is the honest presentation and it reduces deception risk.

Language rules. Never use "guaranteed," "lock," "can't lose," or any implication that subscribers will profit. That vocabulary is the fact pattern in every tout fraud action. Under the 2023 revision of the FTC Endorsement Guides, testimonials carry the same substantiation duty as direct claims. If we ever post a subscriber's "I hit a 10-leg parlay" screenshot, we must disclose what consumers can generally expect, and the old "results not typical" disclaimer alone no longer suffices. Any material connection with an endorser must be disclosed.

## 4. Disclaimers and responsible gambling

Required versus best practice. State responsible-gambling advertising mandates (helpline numbers, RG statements, age minimums in operator ads) bind licensed operators and their marketing affiliates. An independent picks publisher with no affiliate ties is not captured, so for Cray Cray these items are best practice rather than legal requirements. Adopt them anyway, nearly verbatim, for three reasons. They cut deception exposure, payment processors and ad platforms expect RG signals on gambling-adjacent content, and the compliant-by-choice posture matters if a regulator or AG ever looks at the category.

Launch package.

- 21+ age attestation at signup, with user responsibility for legal jurisdiction stated in the terms.
- 1-800-GAMBLER and NCPG resources in the site footer and in marketing emails.
- A standing disclaimer that the service is for informational and entertainment purposes only, provides no guarantee of profit, and that past performance (including the published ledger) does not guarantee future results.
- An explicit statement that the service does not accept, place, facilitate, or broker bets and never holds customer funds.
- No marketing targeted at minors or on youth-skewing channels, and nothing that targets problem gamblers.

## 5. Payment and subscription compliance

### Processor category

A picks subscription with no prizes is outside Stripe's prohibited list as written. Stripe bans sports forecasting or odds-making with a monetary or material prize, and the prize qualifier is the load-bearing phrase. A flat informational subscription with no wagering, no prizes, and no funds held is not prohibited. In practice, though, the business will be scored as gambling-adjacent and high-risk, and platform processors terminate such accounts preemptively, sometimes irreversibly. Plan for it.

- Describe the business explicitly in the Stripe account as informational sports analysis subscriptions with no wagering, no prizes, and no funds held.
- Keep chargebacks under 1% and use a clear billing descriptor.
- Identify a high-risk backup processor (dedicated merchant account providers underwrite this category) before launch rather than after a freeze.

### Auto-renewal and click-to-cancel

The FTC's Click-to-Cancel rule was vacated by the Eighth Circuit in July 2025 on procedural grounds, but ROSCA plus state auto-renewal laws impose nearly the same obligations today, the FTC restarted rulemaking in March 2026, and enforcement under ROSCA continues. Build to the vacated rule's standard anyway, using California's amended ARL as the national floor since it is the strictest and covers any online seller with California customers.

Concrete checkout requirements for the $19.99 plan.

- Show price, renewal frequency, and cancellation method adjacent to the pay button.
- Use a separate, unchecked consent element specifically for the auto-renewal terms, and keep consent records for at least 3 years.
- Send a confirmation email with cancellation instructions.
- Provide one-click online cancellation, as easy as signup, with no obstruction. Stripe's customer portal handles most of this.
- Send annual renewal reminders stating cost and frequency, and notify on material changes.
- If a free trial converts to paid, all of the above applies to the conversion.

## 6. Business hygiene

### Entity

Form a single-member LLC now for liability separation and pass-through simplicity. S-corp is a tax election on top of the LLC, not a separate structure, and it only pays for itself once net profit consistently clears roughly $60k to $80k per year (about 250 to 335 subscribers of pure profit at this price). Do not elect early, since it adds payroll and reasonable-salary overhead. Keep a dedicated bank account and zero commingling so the veil holds against the most likely claim, an angry subscriber who lost money. The LLC does not shield against personal criminal exposure if a state ever characterized the product as promoting gambling, which is another reason to hold the no-bets, no-funds line strictly.

### Terms of service clause checklist

This list matches what Action Network and SportsPicks.ai (the closest analog) actually carry, plus one clause SportsPicks.ai lacks that we should include anyway.

- Entertainment and informational purposes only, not betting, financial, or personalized wagering advice.
- No guarantee of results, and past performance including the published ledger does not guarantee future results.
- Not a gambling operator. The service never accepts, places, facilitates, or brokers wagers and never holds funds.
- Broad limitation of liability that expressly excludes wagering losses and lost profits, capped at fees paid in the prior 12 months.
- Binding individual arbitration with a class-action waiver (the clause SportsPicks.ai omits).
- 21+ requirement and user responsibility for legality in their jurisdiction.
- Responsible gambling language with 1-800-GAMBLER.
- Clear refund policy and auto-renewal terms consistent with section 5.
- Prohibition on republishing or redistributing picks, since copyright will not do this job.

### Insurance

Two lines, often bundled for content businesses. E&O for claims that picks or grading were negligent (roughly $700 to $1,050 per year at $1M limits for a small business) and media liability for defamation and content claims, relevant because the product publishes labels like Trap and a public ledger (roughly $930 to $4,000 per year at small-publisher limits). Carriers surcharge or exclude gambling-adjacent businesses, so disclose the product accurately and budget $1,500 to $4,000 per year combined. Price a cyber rider later, noting Stripe holds the card data, which shrinks that exposure.

### Sales tax

Register in the home state at launch (nexus there is automatic) and turn on Stripe Tax from day one so nexus thresholds elsewhere are monitored. Digital subscriptions are taxable in 20+ states and the classification question (SaaS versus digital information service) changes the answer in states like New York and Texas, so confirm classification with a CPA before launch. Stripe Tax calculates and collects but does not file returns by itself.

## 7. Ranked risks and where to spend attorney hours

### Top risks, ranked

1. Advertising substantiation on the 63.5% claim. The core marketing asset is also the core legal exposure. Mitigate with the complete, timestamped, odds-contextualized, immutable ledger and zero guarantee language.
2. Payment processor shutdown. The most likely operational disruption. Mitigate with an accurate account description, clean descriptors, low chargebacks, and a pre-arranged high-risk backup.
3. Auto-renewal noncompliance, California ARL above all. Cheap to fix at checkout design time, expensive after the fact.
4. ESPN data in the production path. A terms breach inside a paid product and a single point of failure. Replace with a licensed feed before revenue.
5. Scope creep into affiliate revenue or bet facilitation, which would trigger the state licensing and advertising regimes that currently do not apply. Treat the no-affiliate, no-bets structure as a compliance boundary, not just a business choice.
6. Consumer suits from losing subscribers. Individually small, and the ToS clause set is the whole defense.

The legality of the core business is the lowest-risk item on the board. No state licenses tout services, and the structure keeps the product outside gambling and affiliate regulation entirely.

### The short list worth real attorney hours

1. Trademark clearance review before filing, including a quick read on the HPE Cray question. Roughly one hour, $500 to $1,500.
2. Lawyer-adapted ToS from a template, covering the clause checklist above. Low cost against the risk it retires.
3. Contractor NDA template with the DTSA whistleblower notice and IP assignment.
4. A one-hour gaming-lawyer opinion on the machine-built parlay feature before it ships.
5. A one-time pre-launch consult with a gaming or advertising attorney to sanity-check the marketing copy against the substantiation standard.

Everything else in this document is execution, not counsel.