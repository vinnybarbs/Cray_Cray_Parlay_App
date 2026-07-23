# Legal and IP Guidance: Cray Cray for Parlays

**Scope.** Solo founder, pre-revenue sports picks subscription, verified win-rate marketing, planned price of $19.99 per month, target launch September 2026. This document is research-based guidance compiled from public sources. It is not legal advice. Section 7 lists the small number of items worth paying an attorney for.

---

## 1. IP strategy

**Recommendation in one line.** Protect the algorithm as a trade secret, file the trademark before launch, skip the patent, and treat speed plus the verified ledger as the actual moat.

### Skip the patent (the Alice problem, honestly)

The prediction algorithm is close to unpatentable in practice, and pursuing a patent would actively hurt the business.

- Under the Alice/Mayo test, claims directed to abstract ideas (math, fundamental economic practices) are ineligible under 35 U.S.C. 101 unless they add significantly more. Betting-specific precedent is directly unfavorable. In re Smith (Fed. Cir. 2016) held that rules for conducting a wagering game are an abstract idea, a method of resolving financial obligations based on probabilities. A "compute an edge from odds and stats" claim combines a mathematical concept with a fundamental economic practice, which is squarely in the kill zone.
- The 2024 USPTO AI guidance did not soften this. AI and ML claims survive only when they show an improvement to computing technology itself. "My model picks winners better" is a business outcome, not a technical improvement.
- A few narrowly drafted sports-prediction patents have issued (for example US 11,127,250, an AI sports betting engine). Issuance is not enforceability. These are prime Alice invalidation targets, and asserting one costs far more than a solo founder can spend.
- Practical math: $15,000 to $25,000 in drafting and prosecution, 2 to 3 year pendency past launch, high rejection risk, weak enforceability if granted. Filing also requires public disclosure of the algorithm, which destroys the trade secret alternative.

### Trade secret is the right vehicle

The model runs server-side and never ships to customers, which is the classic protectable trade secret under the DTSA and state law. Protection depends on taking reasonable measures, so the checklist matters more than the doctrine.

- Signed NDAs before any disclosure to contractors, partners, or potential acquirers. Verify the NDA binds the actual entity receiving the disclosure. That exact failure lost the plaintiff everything in Protege Biomedical v. Duff & Phelps.
- Include the DTSA whistleblower-immunity notice in every NDA and contractor agreement. Omitting it forfeits exemplary damages and attorney fees.
- Access controls. Private repos, 2FA, revoke contractor access on roll-off, mark model files and docs Confidential.
- Never publish the methodology. Market the verified win-rate ledger and the Trap label as outputs. Do not blog the feature set, weights, or edge formula. The transparency positioning stops at inputs and results.
- Keep a dated internal document that identifies the secret specifically. Courts dismiss trade secret claims described only in vague outcome terms.
- IP assignment clauses in every contractor agreement so code written for the company belongs to the company.

Cost is essentially template legal work. This is the primary algorithm protection, and continuous model improvement is the real moat on top of it.

### Trademark plan, including the CRAY question

- File "Cray Cray for Parlays" plus the logo in Class 41 (entertainment and information services, where gambling information services live, and where Betfair registered SAME GAME PARLAY). Add Class 42 if budget allows. Base fee is $350 per class under the 2025 fee structure. Use preapproved ID Manual descriptions to avoid surcharges. Expect a required disclaimer on "PARLAYS" as generic for the services.
- Timeline is 10 to 18 months to registration, so there will be no registration by launch. Filing sets priority, and TM can be used immediately. If filing before revenue, use an intent-to-use application and budget the later allegation-of-use fees.
- A knockout search found no identical or near-identical live mark. The closest live filing in the space is PARPLAY (August 2025, a betting social app), which differs meaningfully in sound, appearance, and meaning.
- The HPE/Cray conflict is implausible but not zero. HPE's CRAY marks cover supercomputers and HPC products in Class 9. Likelihood of confusion requires related goods and services, and consumer sports picks in Class 41 are commercially remote from supercomputers. The commercial impression also differs, since "Cray Cray" reads as slang for crazy while CRAY is a founder surname. Existing coexistence of SO CRAY CRAY and other cray-formative marks in unrelated fields supports this. A dilution claim would require CRAY to be famous to the general consuming public, which is a hard showing for an enterprise HPC brand. The residual risk is that large companies sometimes oppose anyway. A one-hour attorney clearance review (roughly $500 to $1,500) before filing is cheap insurance.

### Copyright and data rights

- Picks, edge percentages, and ledger entries are facts once published and get essentially no copyright protection (Feist, and courts have specifically held sports stats unprotected). Nothing in copyright law stops a subscriber from republishing daily picks. Control that through the terms of service, rate limiting, and per-account watermarking, not IP law. Full copyright still covers the written analysis, UI, and source code automatically.
- The Odds API terms expressly permit this use case, where odds are an input to a graded product rather than the product itself. Two cautions: never add a raw odds feed or bulk export feature, and get written confirmation before exposing odds through any API of your own.
- ESPN data is a real problem. There is no official public ESPN API, and the Disney Terms of Use restrict use to personal noncommercial purposes and prohibit scraping and data compilation. Using scraped ESPN data inside a paid product is a terms breach with contract exposure, plus the practical risk of endpoints breaking mid-season. Migrate scores and stats to a licensed source (The Odds API scores endpoints, SportsDataIO, Sportradar, or similar) before charging money.

---

## 2. Regulatory position of selling picks

**Bottom line: selling sports picks is legal in all 50 states, and no state currently licenses or registers tout services as such.** Confidence on the general rule is high.

- Picks advice is treated as protected informational and commercial speech, provided the business never takes bets, places bets, holds customer funds, or shares in winnings. Cray Cray's structure (flat subscription, no bet placement, no funds held) is on the safe side of that line and should stay there.
- The federal Wire Act applies to those in the business of betting or wagering and expressly exempts transmission of information assisting bets in legal jurisdictions. A picks publisher is outside the statute.
- Nevada considered tout registration in 2019 and it never became law. Even Nevada has no registration requirement today.
- The licensing regimes that do exist (vendor, supplier, and affiliate licenses in states like Colorado and New York) attach only to companies paid by licensed sportsbooks. Because Cray Cray takes no affiliate revenue, it stays outside all of them. This is a real structural advantage. The day sportsbook affiliate links are added, the business inherits state-by-state affiliate licensing and each state's advertising rulebook. Treat that as a deliberate future decision, not a growth hack.
- Risky edges to avoid: performance-based or outcome-contingent pricing (never do it), and a handful of hostile state statutes such as NY Penal Law 225.05 and Georgia 16-12-28. Because subscribers presumably bet on legal regulated books, exposure is low, but frame all content as information about legal wagering and consider disclaiming or geoblocking Georgia, Utah, and Washington.
- The planned machine-built parlay feature moves closer to individualized wagering instruction than commentary. It is likely still lawful information, but label generated combinations as illustrations of model output rather than instructions, and get a short gaming-attorney read before shipping it.

---

## 3. Advertising claims: what the ledger must include

FTC Act Section 5 and state UDAP statutes are the main real exposure for this business. "63.5% win rate" is an objective, quantified performance claim, and the substantiation doctrine requires possessing the proof at the time the claim is made. The verified ledger is the best defense, but only if it is built to substantiation standard.

The published ledger must include:

- Every graded pick, with no deletions and no retroactive edits. Append-only and auditable.
- A clear definition of the population behind the headline number: which tier of picks, which timeframe, which odds range.
- The grading methodology and settlement source, published.
- Timestamps proving each pick was published before the game started.
- Odds context alongside win rate. A 63.5% rate on heavy favorites can lose money, so pair win rate with units or ROI at stated odds. A win rate presented without odds context can itself be a misleading claim.

Additional rules that bite:

- Never use "guaranteed," "lock," "can't lose," or any implication that subscribers will profit. That language is the fact pattern in every tout fraud action, and the BBB flagged handicapper guarantee schemes in a 2025 scam alert. The category is associated with fraud, so a clean operator should over-document.
- Testimonials carry the same substantiation duty as direct claims under the revised FTC Endorsement Guides. A subscriber's "I hit a 10-leg parlay" screenshot requires clear disclosure of what consumers can generally expect. The old "results not typical" disclaimer alone no longer suffices. Disclose any material connection with anyone who promotes the product.
- Never cherry-pick time windows. If the headline number covers a specific period, say so everywhere the number appears.
- State attorneys general share this authority and are the more likely enforcer against a small operator than the FTC itself.

---

## 4. Disclaimers and responsible-gambling posture

**Legally required: almost nothing. Worth adopting anyway: nearly all of it.** State responsible-gambling advertising mandates bind licensed operators and their paid affiliates, not independent picks publishers. Nothing mandates "for entertainment purposes only" language for a picks site. Adopt the industry-standard package regardless, for three reasons: it cuts deception exposure, payment processors and ad platforms expect responsible-gambling signals from gambling-adjacent businesses, and the compliant-by-choice posture matters if a regulator ever looks at the category.

Launch package:

- 21+ age attestation at signup.
- 1-800-GAMBLER and NCPG resources in the site footer and in marketing emails.
- A disclaimer stating the service is for informational and entertainment purposes only, is not betting or financial advice, offers no guarantee of profit, and that past performance does not guarantee future results.
- No marketing targeted at minors, placed on youth-skewing channels, or aimed at problem gamblers.

---

## 5. Payments and subscription compliance

### Processor category

A picks subscription with no prizes is outside Stripe's prohibited list as written. Stripe bans sports forecasting with a monetary or material prize, and this product has no prize, places no bets, and holds no funds. In practice, automated risk models treat subscription billing plus sports betting keywords plus chargebacks from losing bettors as a high-risk profile, and platform processors shut such accounts down preemptively and often irreversibly.

Plan:

- Describe the business explicitly in the Stripe account profile as informational sports analysis subscriptions with no wagering, no prizes, and no funds held.
- Use clear billing descriptors and keep chargebacks under 1%.
- Identify and pre-qualify a high-risk backup processor (a dedicated merchant account provider that underwrites this category) before launch, not after a freeze.

### Auto-renewal rules for the $19.99 plan

The FTC Click-to-Cancel rule was vacated on procedural grounds in July 2025, but ROSCA applies today, the FTC restarted the rulemaking in March 2026 and continues negative-option enforcement, and California's amended auto-renewal law (effective July 2025) imposes nearly the same obligations and effectively sets the national floor. Build the checkout to that standard once and the state patchwork is covered.

Concrete requirements for checkout and billing:

- Show price, renewal frequency, and how to cancel adjacent to the pay button, before collecting billing information.
- Use a separate, unchecked consent element specifically for the auto-renewal terms, and keep consent records for at least three years.
- Send a confirmation email with cancellation instructions.
- Provide one-click online cancellation with no obstruction, as easy as signup, in the same medium as signup.
- Send annual renewal reminders stating cost and frequency, and give notice of material changes.
- If a free trial converts to paid, all of the above applies at trial signup.

Stripe's customer portal handles most of the cancellation mechanics. Turn on Stripe Tax from day one, register for sales tax in the home state (nexus there is automatic), and confirm with a CPA whether the product classifies as SaaS or a digital information service, since that changes taxability in states like New York and Texas. Every other state's economic nexus threshold (typically $100,000 of in-state sales) is far away pre-revenue.

---

## 6. Business hygiene

### Entity

Form a single-member LLC now for liability separation and simple pass-through taxes. Do not elect S-corp taxation until net profit consistently clears roughly $60,000 to $80,000 per year (about 250 to 335 subscribers of pure profit at this price), because the election adds payroll and reasonable-salary overhead with no benefit before that. Keep a dedicated business bank account with zero commingling so the corporate veil holds against the most likely claim, which is an angry subscriber who lost money. Understand the veil's limits: it does not shield against personal criminal exposure or personal fraud claims, which is another reason the advertising discipline in section 3 matters.

### Terms of service clause checklist

Every comparable product (Action Network, SportsPicks.ai, and others) carries these clauses, and they are the entire defense against subscriber suits:

1. Entertainment and informational purposes only, not betting, wagering, or financial advice.
2. No guarantee of results, and past performance, including the published ledger, does not guarantee future results.
3. The service does not accept, place, facilitate, or broker bets and never holds customer funds.
4. Broad limitation of liability that expressly excludes wagering losses, capped at fees paid in the prior 12 months.
5. Binding individual arbitration with a class-action waiver. The closest analog product lacks one. Include it anyway.
6. 21+ requirement and user responsibility for legality in their own jurisdiction.
7. Responsible-gambling language with 1-800-GAMBLER.
8. Clear refund policy and the auto-renewal terms from section 5.
9. A prohibition on republishing or redistributing picks, since contract is the only tool that protects them (section 1).

### Insurance

Two relevant lines, often bundled for content businesses. E&O professional liability runs roughly $700 to $1,050 per year for $1M limits at generic small-business rates. Media liability (relevant because the product publishes labels like Trap on named games and a public ledger) runs roughly $930 to $4,000 per year for a small publisher. Expect quotes above generic averages because some carriers surcharge or exclude gambling-adjacent businesses, and disclose the product accurately on the application. Budget $1,500 to $4,000 per year combined. Price a cyber rider later, though Stripe holding the card data reduces that exposure.

---

## 7. Ranked risks and where to spend attorney hours

### Top risks, ranked

1. **Advertising substantiation on the win-rate claim.** The core marketing claim is an objective performance claim, state AGs are active here, and the category has a fraud reputation. Mitigation is section 3: immutable timestamped ledger, odds context, no guarantee language, disciplined testimonials.
2. **Payment processor shutdown.** The most likely operational disruption. Mitigation is a clean and explicit account description, low chargebacks, and a pre-qualified high-risk backup processor.
3. **Auto-renewal noncompliance, California above all.** Cheap to fix at checkout design time, expensive after. Build to the vacated federal rule's substance anyway.
4. **Scope creep into affiliate revenue or bet facilitation.** Either move triggers state licensing and advertising mandates that currently do not apply. The no-affiliate, no-bets, no-funds structure is a compliance asset. Change it only deliberately.
5. **ESPN data in the production path.** A terms-of-service breach inside a paid product, plus operational fragility. Replace before revenue.
6. **Subscriber suits and everything else.** Individually small and largely handled by the ToS package and insurance.

The legality of the core business is the lowest risk on the list. No state licenses tout services, and the current structure keeps the product outside gambling and affiliate regulation entirely.

### The short list worth actual attorney hours

1. **Trademark clearance review** before filing, roughly one hour, $500 to $1,500. The CRAY screen above is knockout-level research, not a legal opinion.
2. **ToS and NDA templates adapted by a lawyer**, using the clause checklist above and the DTSA notice. A few hours of template work.
3. **A one-hour gaming-attorney read on the machine-built parlay feature** before it ships, since it is the one feature that leans toward individualized wagering instruction.
4. **A marketing-copy scrub against the substantiation standard** before launch, by the same attorney or as a fixed-fee review.

Everything else in this document is execution, not counsel.

*Research-based guidance compiled July 2026. Not legal advice.*
