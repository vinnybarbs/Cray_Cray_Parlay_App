---
name: traphawk-performance-review
description: The weekly TrapHawk model performance and calibration review. Use whenever the user asks how the model is doing, whether the site is on a heater, tier win rates, trap detector accuracy, edge calibration, CLV, shadow sport promotion progress, or wants "the latest performance" or a business status update. Also the template for a scheduled Monday review. Prevents the two classic reporting mistakes, mixing record sources and misreading trap grades.
---

# TrapHawk performance review

Read-only against production (Supabase project `pcjhulzyqmhrhsrgvwvx`, `execute_sql` tool). Two rules prevent every historical reporting error: all public numbers come from `mv_public_record` only (never raw ai_suggestions math, never mv_model_accuracy), and trap rows grade the fade (a won trap means the named side lost, report it as "fading them went W-L"). Full schema context is in the traphawk-data-model skill.

Before anything else, read the blackboard so the review builds on what other workers already found instead of rediscovering it:

```sql
select created_at, agent, summary from agent_reports
where created_at >= now() - interval '14 days'
order by created_at desc limit 20;
```

At the end, file your own report so the next worker starts where you finished:

```sql
insert into agent_reports (agent, summary, findings)
values ('calibration-review', '<two or three sentences: headline verdict and the recommendations>', '<json of key metrics, or null>');
```

## 1. Headline records, all four windows

```sql
select period_bucket, dimension_value as tier, won, lost, push, pending,
       round(100.0 * won / nullif(won + lost, 0), 1) as win_pct
from mv_public_record
where dimension_type = 'tier'
order by period_bucket, tier;
```

Also pull the `overall` rows. Present Sharp Take first (it is the flagship), then the ladder. The interesting story is always the spread between last_3d and last_7d versus last_30d and all: call heaters and cold streaks plainly with the sample size right next to the claim. A 9-2 three-day run is a heater, a 5-4 one is noise, say which.

## 2. Tier monotonicity

Higher tiers should win more often over meaningful samples. A higher tier under a lower one over 30 days or more is a calibration finding, not a fluke to smooth over.

Chalk fence 2026-08-10: no Sharp Take heavier than -150 regardless of claimed edge, the pick publishes as Play instead. Rationale: 45 days of chalk Sharp Takes won 67 percent for +2.8u while dog Sharp Takes won 65 percent for +25.3u, heavy-chalk claimed edges measured as mostly vig. When reviewing Sharp Take performance, also report the fenced population (Play-tier picks at -150 or heavier with edge_pp >= 10) so the fence itself gets judged. The fence retires when per-band price calibration ships at football go-live.

Ladder change 2026-08-10: Strong Play merged into Play, the live ladder is Sharp Take 10pp+, Play 4-10pp, Lean 2-4pp. The old 4-7 and 7-10 bands were indistinguishable over every window and both carried negative CLV. Historical rows keep their stored Strong Play tier, so tier queries over windows that cross the merge date will show both labels, treat Strong Play rows as Play when judging the ladder. A lock-time reprice cron (reprice-pending-picks, every 30 min) demotes pending Play moneyline picks to Lean when the market fades their side by 1pp of implied probability inside 90 minutes of first pitch, check its cron_job_logs demote counts when reviewing Play performance. Per-band calibration multipliers are planned for football go-live, revisit tier boundaries only at 500+ settled picks per band.

## 2b. Muted markets and market shadow performance

`select * from market_shadow_calibration();` grades every sport's RAW spread, total, and moneyline edges against finals, no publication needed. This is how a muted market earns its way back and how NFL and NCAAF markets get measured from week one. Report each muted market's shadow record and units at -110, and recommend re-enabling ONLY when the shadow record clears the juice break-even (52.4 percent at -110) over a real sample. Baseline for context, Aug 2026 MLB over 317 games: spreads 50.5 percent and -11.6u, totals 47.9 percent and -26.2u; ml 53 percent, live.

Owner decision 2026-08-10: MLB spreads re-entered production at multiplier 0.21 (the shadow-fitted k) and MLB totals on probation at 0.10 even though the shadow measured a negative k. Tennis left the shadow list the same day and publishes through the ladder at 0.50. Every weekly review must report how these three re-entries are performing against their published record AND their shadow record, and recommend re-muting any of them that runs below break-even on a real published sample. Do not silently accept the multipliers as settled.

Football plan, same owner decision: NFL and NCAAF are in SHADOW_SPORTS through preseason. Every preseason game gets full analysis and its raw edges get shadow graded, nothing publishes. Weekly reviews during preseason must report the football shadow record per market. Go-live is a deliberate flip at the openers, NCAAF 2026-08-29 and NFL 2026-09-10: remove the sport from SHADOW_SPORTS and seed its multipliers from the preseason measured_k. Do not promote early on a hot preseason sample, and do not let the flip date slip silently.

## 3. Edge calibration

For settled picks in the last 30 days, bucket by stated edge and compare implied versus actual:

```sql
select case when edge_pp >= 10 then '10+' when edge_pp >= 7 then '7-10'
            when edge_pp >= 4 then '4-7' else '2-4' end as bucket,
       count(*) filter (where actual_outcome = 'won') as won,
       count(*) filter (where actual_outcome = 'lost') as lost
from ai_suggestions
where session_id like 'auto_digest_2%' and tier not in ('Trap','Skip','Leg')
  and voided_at is null
  and actual_outcome in ('won','lost')
  and game_date >= now() - interval '30 days'
group by 1 order by 1;
```

An edge bucket winning more than about 5 points under what its edge implies is drift. Note it and check whether one sport drives it (add sport to the group by).

## 3b. Price buckets: where does the claimed edge actually pay

The pp bands say how much edge the model claims. The price of the pick says where that claim has historically paid, and the two disagree. The 2026-08-21 forensic over the season to date: nearly all MLB moneyline profit lived in slight dogs (+100 to +150, delivered about +11pp over implied since Jul 1), slight favorites (-101 to -149) underdelivered the entire season and were August's biggest bleeder, and the underdog side as a whole beat implied every single month while the margin decayed (roughly +22pp in May to +4pp in August). Do not assume dogs are the problem because books shade longshots; in this model's record the dogs carried it. Run this weekly per sport:

```sql
select case when odds::numeric <= -150 then '1 chalk -150 and heavier'
            when odds::numeric < 0 then '2 slight fav -101 to -149'
            when odds::numeric <= 150 then '3 slight dog +100 to +150'
            else '4 long dog +151 and up' end as bucket,
       count(*) as n,
       count(*) filter (where actual_outcome = 'won') as won,
       round(100.0 * avg(implied_prob::numeric), 1) as implied,
       round(100.0 * count(*) filter (where actual_outcome = 'won') / count(*)
             - 100.0 * avg(implied_prob::numeric), 1) as delivered_pp,
       round(sum(case when actual_outcome = 'won'
                 then (case when odds::numeric > 0 then odds::numeric / 100.0
                       else 100.0 / abs(odds::numeric) end) else -1 end), 1) as units
from ai_suggestions
where bet_type = 'Moneyline' and actual_outcome in ('won','lost') and voided_at is null
  and tier in ('Sharp Take','Strong Play','Play')
  and game_date >= now() - interval '30 days'
group by 1 order by 1;
```

Report delivered_pp and units per bucket next to the pp bands. A price bucket that has never delivered its claim (slight favorites, historically) staying negative for another 30-day window is evidence for a price-aware haircut; raise it as a recommendation, do not auto-apply one.

## 4. Traps and legs

Trap record from the mv tier row (fade framing). If trap_signals is populated, group the week's trap outcomes by signal to spot a dragging lure. Legs: hit rate versus the 65% floor. Legs hitting well below 65% over a real sample means the model probabilities are optimistic exactly where the parlay builder trusts them most.

## 5. Shadow sports and CLV

Shadow promotion is judged on PERFORMANCE, not read volume. The bar: 75 graded publishable picks (claimed edge 2pp or more) whose actual win rate meets or beats fair implied. One call returns everything:

```sql
select public.shadow_model_readiness();
```

Report each model's publishable record against implied AND its units ("Tennis 30-7 on 37 publishable, 81.1 actual vs 78.2 implied, -0.28u, needs 75 and positive units"). Never judge a shadow model on its sub-2pp reads, those are Skips by our own ladder and were never candidates for the record (the Aug 2026 lesson: the aggregate made Tennis look below-market while its publishable bucket was beating its own claims). And never judge on win rate alone: the same Tennis bucket won 81 percent and still lost units, because at heavy chalk the vig eats a 3 point edge. When a model calibrates well but cannot beat the vig, weigh the leg alternative in the promotion decision: it may belong in the Leg Pool feeding parlays, not the pick record. For CLV, the `pick_clv` view (shipped 2026-08-10) computes closing line value for every moneyline pick since 2026-07-11, joined by event id or kickoff instant. Canonical query:

```sql
select tier, count(*) as n, round(avg(clv_pp), 2) as avg_clv_pp,
       round(100.0 * count(*) filter (where clv_pp > 0) / count(*), 1) as pct_beat_close
from pick_clv
where actual_outcome in ('won','lost','push')
group by tier order by tier;
```

Report average CLV in pp and percent beating close per tier. First baseline, 2026-08-10 over 229 picks: overall +0.19pp and 53.3 percent beating close, Sharp Take +1.81pp. CLV is the earliest honest signal of edge drift, a tier whose CLV goes negative is losing its edge before the win rate shows it. Under 50 percent beating close is not marketing material, say so honestly.

## 6. Historical context that prevents false findings

- `record_mismatch` rows in agent_intel for Tennis or UFC dated before 2026-08-05 are FALSE POSITIVES. The verifier was comparing 30-day form (stored by design in the record columns) against season records. Fixed 2026-08-05, and the tennis model prices off market consensus and never reads those columns, so they never contaminated reads.
- The Leg tier shipped 2026-08-05 and requires a 65 percent model-probability side with no edge. Zero or few Leg rows shortly after that date is the feature being honest, not broken.
- Rows with `voided_at` set are retroactively voided picks (first use: MLB spreads published under the 0.60 seed multiplier, voided 2026-08-06). mv_public_record excludes them. When counting from raw ai_suggestions, always filter `voided_at is null` to match the public record.
- THE FROZEN COHORT (2026-08-09): 529 rows share `resolved_at = '2026-08-09 12:13:08.323644-06'`. They were regraded at 12:13 MT, then restored to their original grades at 14:45 MT at the owner's direction. Six forensic audits ran that day. Instant-based arbitration found the regrade correct on 463 rows and the originals correct on 65, with one bad push. The row-level lists live in agent_reports (agent ops-check, 2026-08-09). NEVER re-flip any of these rows in an automated sweep or an integrity fix. Any correction is per row, matched by kickoff instant, and happens only on explicit owner approval.
- game_results.date was UTC-stamped before 2026-07-25, so about a quarter of pre-fix evening games are filed one day late. Do not treat pre-7/25 game_results dates as ground truth for which night a game was played. Picks created since 2026-08-09 carry odds_event_id, and settlement resolves by event id first, kickoff instant second, calendar day last.

## 7. Output

End with at most three recommendations, each one sentence, each tied to a number above. If the data says do nothing, say the model is behaving and skip invented action items. Plain punctuation, no em dashes, en dashes, semicolons, or arrows. Do not change code or data during a review.
