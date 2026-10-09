# AGENTS.md: the top line for every TrapHawk session

Read this before anything else, every session, human or routine. It is
the compiled version of the owner's goals, the standing rules, the
skills, and the things that are never done. It lives in the repo and is
synced into the `skills` table (row name `AGENTS.md`) on every deploy,
so a cloud routine reads the same text the code session reads. It is
edited only here (directive 15). Detail lives in the skills and the
four shared state tables. This page is the map.

## What TrapHawk is

TrapHawk (traphawk.io) is a sports betting research model with a graded
public record. Every read starts from the devigged market consensus
moneyline, adds a small set of factor adjustments per sport, derives the
other markets, clears a raw 2pp gate, deducts the price rails, and
publishes a tiered pick (Lean 2, Play 4, Strong Play 7, Sharp Take 10)
into a ledger that is graded, closed against the closing line, and
shown in full on the site. Legs (a no pick game with a heavy model
side) and Traps (a lured side the model prices 2pp under fair, graded
as a fade) are separate domains. Node/Express on Railway (main deploys
in 2 to 4 minutes, no staging), Vite/React in src/, Supabase Postgres
project pcjhulzyqmhrhsrgvwvx with pg_cron firing /cron/* endpoints.

## The goals, in the owner's words and in numbers

- Win. The owner's targets are 55 percent across the board, 60 on
  Strong Play and 65 on Sharp Take. Judged honestly, each tier is
  scored at its own break even plus five points on 200 or more picks,
  next to two KPIs the market cannot fake: return on turnover of 3 to 5
  percent and positive closing line value against the sharpest close
  we can buy.
- Be nimble per sport and per market. "The one size fits all planning
  is part of why we are here." Every gate, rail, floor and rule is
  keyed sport:market:side on the dial board, with the pooled row only
  as the default it overrides. MLB moneyline underdogs and MLB favorite
  run lines are the same sport and opposite businesses.
- Learn from our own ledger. "The whole idea of the lookback is that we
  have all this data and can identify what patterns are happening and
  get better." The lookback engine (second report, build_queue 67)
  mines every graded pick by sport, market, side and attribute, with
  false discovery control and walk forward, and proposes rules with
  evidence and a sunset.
- A mute is not an answer. "Turn off -1.5 favorites entirely is not an
  answer to picking more selective favorites." When a cell loses, find
  what separates its winners (the starter gap, the price, the model's
  own claim) and write the selection rule. A market is muted only when
  nothing we store tells the winners from the losers, and it says so.
- Get NFL props publishing under a rule and a shadow bar.
- Make money on transparency: a timestamped ledger with CLV, a factor
  trace on every pick, a parlay record next to the straight record,
  priced at the market anchor, with the ledger free forever.

## Where the truth lives

Chat is not memory. Four tables carry the shared state and every agent
reads them before acting and writes them after:

- `directives`: the standing owner decisions with enforcement and a
  `check_sql` the daily ops check runs. Never silently contradict one.
  Propose an amendment instead.
- `sport_dials` plus `model_weight_changes`: every tunable weight, per
  sport and market. A weight moves here with an evidence row, never as
  a constant edit. Moves follow the three test counterfactual and the
  Sunday sweep.
- `build_queue`: the running to do and decision list. Keep it current
  when work starts, finishes or is discovered.
- `agent_reports`: the blackboard (columns agent, summary, findings).
  File a row after every significant change. No analysis that reports
  only to one person.

Also: `rule_gates`, `rule_gate_log` and `rule_gate_scorecard` (the
lookback's selection rules, shadow until promoted, judged per verdict
against the ledger), `bucket_targets` (the per tier floors), `skills`
(the synced skill text), `mv_public_record` (the only source of any public record
number), `pick_clv_all` and `closing_lines` (closing line value),
`shadow_reads_graded` and `shadow_market_readiness()` (the shadow
ledger every muted market is judged on).

## Session start checklist

1. Read this file (the `AGENTS.md` row in `skills` for a routine).
2. Read active `directives`.
3. Read the last 7 days of `agent_reports` and the open `build_queue`.
4. Load the skill for the job: traphawk-data-model for any query,
   traphawk-ops-check for health, traphawk-performance-review for the
   record, traphawk-ship for any change, traphawk-cost-audit for spend,
   traphawk-status-board for the four tables in one view.
5. Say in one line what you are about to do.

## Session end checklist

1. Tests green, build green, migration file in supabase/migrations AND
   applied to production, PR merged by squash, branch reset onto main,
   live behavior verified (server-start row in cron_job_logs carries
   the commit sha).
2. `build_queue` rows updated. `model_weight_changes` row for any dial
   move. `directives` amended, never contradicted.
3. One `agent_reports` row with what changed, the evidence, and what
   the owner still has to decide.
4. Plain punctuation everywhere: commit messages, UI copy, blackboard
   rows, Discord embeds.

## The skills and when to use them

| Skill | Use it for |
| --- | --- |
| traphawk-data-model | Any question about picks, traps, legs, records, the ledger, the digest, any SQL. Every public percentage has one correct source. |
| traphawk-ops-check | Daily health: crons by rows written, feeds, directive check_sql sweep, tripwires. Read only apart from its own report. |
| traphawk-performance-review | Weekly record, calibration, CLV, tier win rates, bucket scorecard, shadow readiness, dial move protocol. |
| traphawk-ship | Any code change, migration, deploy, or why is it not live. The propagation table is authoritative. |
| traphawk-cost-audit | API and LLM spend from the cost log, reconciled to the bill. |
| traphawk-status-board | The four tables in one view. |

Skills are edited only in .claude/skills in the repo and synced to the
`skills` table by every deploy (directive 15). Nothing about a skill is
typed into a desktop app or a routine prompt. The cloud routines (daily
ops check, daily build, weekly calibration review, monthly cost audit)
each have a complete brief under agents/ in the repo, synced to the
same table as row agents/<file>, and each trigger's prompt is one line
that loads its brief. agents/README.md holds the schedule and the editing
rules: facts may be corrected by anyone with evidence, mission and
schedule and rules only by a deliberate owner commit.

## How a model change happens

1. Evidence first: the ledger by sport, market and side, the shadow
   ledger for a muted market, the calibration by claim bucket, CLV.
2. The Sunday sweep replays the variant. The three tests: it rescues
   the targeted losers, improves the sport's whole replayed record, and
   holds on shadow reads. A move stays damped to 25 percent per step
   unless the reading repeats across Mondays.
3. The change lands as a `sport_dials` row keyed sport:market with a
   `model_weight_changes` row carrying the evidence, and where the
   lookback proposed it, a six week sunset it must re survive.
4. Everything the change touches moves with it (directive 22): the
   dial board, the review skill, the ops check, the code default, the
   UI copy, the data model skill.
5. The blackboard row.

The LLM narrates. It never moves the side or the number. The only
future exception is the pre publish review agent, bounded to hold or
shade a pick down by a fixed amount on information the model could not
see, with every action logged and scored against the close.

## Never

- Never re-flip a grade automatically. Regrades only through the
  allow_regrade transaction plus a cron_job_logs entry. The frozen
  cohort (529 rows resolved at 2026-08-09 12:13:08.323644-06) is
  untouchable. No ledger modification to picks with game_date before
  2026-07-01.
- Never publish a public record number from anything but
  mv_public_record.
- Never edit a weight, multiplier, rail or floor as a code constant.
  Dial row plus evidence row, or it did not happen.
- Never mute a market as the answer to a losing cell without first
  looking for the selection rule inside it, and never mute with a zero
  multiplier. A mute is publish_<market> 0 on the dial board.
- Never raise the 2pp gate or add a beat the close filter on the
  current ledger. Both lose money on it (second report, section 3).
- Never pool a new rule across sports or markets. Sport:market:side
  rows over a default.
- Never let calibration create a pick. The raw claim is the only gate.
- Never grade a new formula by an old formula's measurements. A change
  to how claims are generated resets the affected maps and advances the
  fit floor.
- Never contradict an active directive silently. Amend it with a row.
- Never let an analysis agent change code or data. Only the code
  shipping session changes code or data (directive 13).
- Never trust a cron status as proof of ingestion. Feeds are judged by
  rows written (directive 14).
- Never use Wikipedia for anything. Records are verified against ESPN,
  CBS Sports, Yahoo Sports, Fox Sports or the league site (directive
  24).
- Never narrate a whole sport shadow read (directive 23).
- Never publish Tennis at +111 or longer (directive 4).
- Never put a secret in the repo, a commit, a blackboard row or a
  Discord embed.
- Never put a link in a Discord post (no previews, no pixels). Embeds
  only.
- Never use an em dash, en dash, semicolon or arrow in prose, code
  comments, commit messages, UI copy or blackboard rows.
- Never fire a cron with a guessed parameter. Pre-analyze takes
  `sports=` (lowercase, plural). `sport=NFL` runs every sport.
- Never write agent_reports with columns other than agent, summary and
  findings. cron_job_logs has job_name, status, details and created_at.
- Never publish a shadow read or sell one. A tier under its bucket
  floor on 50 rows wears a calibrating badge, not a claim.
- Never open a PR unless asked, and never merge one that is not green.

## Owner working style

- Decisions are terse: "go", "yes dial move", "not what I said". Read
  the reversal and act on the latest word. When a request is reaffirmed
  after a concern, it is the decision.
- Wants to see the why: the factor trace (anchor, factor rows with dial
  names and moves, net, market edge, sizing, rails, tier, outcome) is
  the display standard for a pick.
- Wants selection over suppression, per market over pooled, evidence
  over instinct, and a document with the numbers rather than a chat
  summary when the question is a plan.
- Hates repeat noise: no duplicate Discord posts, no re-stating settled
  findings, no walls of text where a table will do.

## Sports and markets, as of 2026-10-03

The live truth is `sport_dials` (publish_ml, publish_spread,
publish_total per sport) and `shadow_market_readiness()`. Snapshot:

| Sport | Live | Shadow or muted | Note |
| --- | --- | --- | --- |
| MLB | moneyline, run line | totals (directive 10) | The lookback rules R1 to R4 run as shadow gates. The starter gap is the mechanism. A read with no probable starters deducts no_starter_penalty_pp (MLB 3) and still publishes (owner 2026-10-03) |
| NFL | moneyline, spread | totals, props (v2 shadow) | 18 picks so far, no rule until 100 per cell |
| NCAAF | totals (auto promoted 2026-09-27) | moneyline, spread | Ratings anchor, watch weekly |
| NHL | moneyline, puck line, total (owner go 2026-10-03) | | Judged weekly against its shadow record per directive 10. Starting goalies factor live 2026-10-04 (goalie_anchor_damp 0.5, goalie_required shadow gate, no_goalie_penalty_pp 0) and the lineup factor (nhl_skater_out_pp, nhl_lineup_cap_pp, DailyFaceoff line chart) |
| NBA, NCAAB | none | all, preseason | Flip at each regular season open, owner call |
| Tennis | favorites | dogs fenced at +111 | Surface Elo before dogs return |
| UFC | moneyline | | Out of the leg pool |
| Soccer family | none | all | xG anchor before anything publishes |

## The two reports

The plan of record is two Claude docs, both filed on the blackboard
with their build_queue items: "TrapHawk Model and Site Plan" (model
inputs, what the ledger supports, site evaluation, the per sport per
market table) and "TrapHawk Lookback Engine and Business Plan" (the
engine method, the first run, rules per market, the store, parlays,
the roadmap). Open decisions are the numbered lists at the end of each.
