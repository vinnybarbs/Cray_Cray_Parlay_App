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

Higher tiers should win more often over meaningful samples. Sharp Take under Strong Play over 30 days or more is a calibration finding, not a fluke to smooth over.

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

## 4. Traps and legs

Trap record from the mv tier row (fade framing). If trap_signals is populated, group the week's trap outcomes by signal to spot a dragging lure. Legs: hit rate versus the 65% floor. Legs hitting well below 65% over a real sample means the model probabilities are optimistic exactly where the parlay builder trusts them most.

## 5. Shadow sports and CLV

Shadow promotion is judged on PERFORMANCE, not read volume. The bar: 75 graded publishable picks (claimed edge 2pp or more) whose actual win rate meets or beats fair implied. One call returns everything:

```sql
select public.shadow_model_readiness();
```

Report each model's publishable record against implied ("Tennis 30-7 on 37 publishable, 81.1 actual vs 78.2 implied, needs 75"). Never judge a shadow model on its sub-2pp reads, those are Skips by our own ladder and were never candidates for the record (the Aug 2026 lesson: the aggregate made Tennis look below-market while its publishable bucket was beating its own claims). For CLV, if closing line data exists for the period, report average CLV in pp and percent beating close. Under 50% beating close is not marketing material, say so honestly.

## 6. Historical context that prevents false findings

- `record_mismatch` rows in agent_intel for Tennis or UFC dated before 2026-08-05 are FALSE POSITIVES. The verifier was comparing 30-day form (stored by design in the record columns) against season records. Fixed 2026-08-05, and the tennis model prices off market consensus and never reads those columns, so they never contaminated reads.
- The Leg tier shipped 2026-08-05 and requires a 65 percent model-probability side with no edge. Zero or few Leg rows shortly after that date is the feature being honest, not broken.
- Rows with `voided_at` set are retroactively voided picks (first use: MLB spreads published under the 0.60 seed multiplier, voided 2026-08-06). mv_public_record excludes them. When counting from raw ai_suggestions, always filter `voided_at is null` to match the public record.

## 7. Output

End with at most three recommendations, each one sentence, each tied to a number above. If the data says do nothing, say the model is behaving and skip invented action items. Plain punctuation, no em dashes, en dashes, semicolons, or arrows. Do not change code or data during a review.
