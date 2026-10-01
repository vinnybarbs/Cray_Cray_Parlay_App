-- Owner 2026-10-01: "Approve the four MLB rules as shadow gates now
-- (starter required, starter gap 0.25 for moneyline favorites, light
-- favorite rail, +1.5 probability floor). They log only. YES." Plus the
-- trap run line and juicy dog signals to shadow, and the Sunday sweep
-- variants (pitcher_anchor_damp 0.75 and 1.0, chalk_penalty_pp 1.5).
--
-- rule_gates is the rule store the lookback engine proposes into: one row
-- per sport, market, side and rule_key with its params, mode (shadow, live,
-- off), evidence and sunset. rule_gate_log is one row per published pick
-- per rule with the verdict and the inputs it saw. rule_gate_scorecard
-- joins the log to the graded ledger so each rule is judged on its held
-- cohort against its passed cohort. Code: lib/services/rule-gates.js,
-- hooked in api/cron/pre-analyze-games.js after the ledger write.

create table if not exists public.rule_gates (
  id bigserial primary key,
  sport text not null,
  market text not null default 'any',          -- ml, spread, total, any
  side text not null default 'any',            -- favorite, underdog, any
  rule_key text not null unique,
  params jsonb not null default '{}'::jsonb,
  mode text not null default 'shadow' check (mode in ('shadow', 'live', 'off')),
  evidence text,
  proposed_on date not null default current_date,
  sunset_on date,
  promotion_bar text default '100 picks per verdict on rule_gate_scorecard, the held cohort losing and the passed cohort holding, then an owner call',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rule_gates enable row level security;

create table if not exists public.rule_gate_log (
  id bigserial primary key,
  logged_at timestamptz not null default now(),
  session_id text not null,
  game_key text not null,
  sport text not null,
  home_team text,
  away_team text,
  game_date timestamptz,
  bet_type text,
  side text,
  pick text,
  odds text,
  tier text,
  edge_pp numeric,
  rule_key text not null,
  mode text not null default 'shadow',
  verdict text not null check (verdict in ('pass', 'hold')),
  reason text,
  inputs jsonb not null default '{}'::jsonb,
  unique (session_id, game_key, rule_key)
);
create index if not exists rule_gate_log_rule_idx on public.rule_gate_log (rule_key, verdict, logged_at desc);
alter table public.rule_gate_log enable row level security;

insert into public.rule_gates (sport, market, side, rule_key, params, mode, evidence, proposed_on, sunset_on) values
  ('MLB', 'any', 'any', 'starter_required', '{"markets": ["ml", "spread"]}',
   'shadow', 'Lookback 2026-09-28 since 08-01: ML favorites with the Probable starters factor 99-53 +12.7u, without it 11-13 -6.7u. Run line favorites without it 9-22 -11.2u.', '2026-10-01', '2026-11-12'),
  ('MLB', 'ml', 'favorite', 'starter_gap_025', '{"min_gap": 0.25}',
   'shadow', 'Lookback 2026-09-28: ML favorites with a pick side starter ERA gap over 1.0 went 62-25 +13.9u, both halves positive. A 0.25 gap rule keeps 121 picks at +14.2u and drops 55 at -8.3u since 08-21.', '2026-10-01', '2026-11-12'),
  ('MLB', 'ml', 'any', 'light_favorite_rail', '{"lo": -115, "hi": 110}',
   'shadow', 'Lookback 2026-09-28: MLB moneylines priced -110 to +110 went 11-24 -13.6u, negative in both halves (4-13 then 7-11). The loss sits where the model''s own claim was under 2pp.', '2026-10-01', '2026-11-12'),
  ('MLB', 'spread', 'favorite', 'rl_favorite_rule', '{"max_ml_claim_pp": 5}',
   'shadow', 'Owner 2026-09-28: a mute is not an answer. -1.5 favorites with a 5pp plus moneyline claim 34-50 -13.8u, at 2 to 5pp 26-27 +6.3u, without the pitcher factor 9-22 -11.2u.', '2026-10-01', '2026-11-12'),
  ('MLB', 'spread', 'underdog', 'rl_dog_prob_floor', '{"min_prob": 0.65}',
   'shadow', 'Lookback 2026-09-28: +1.5 dogs at model cover probability 65 to 75 went 41-12 +10.7u, at 55 to 65 went 22-20 -3.8u. The .65 spread bucket is the only one that overdelivers (78 percent against a 63 percent break even).', '2026-10-01', '2026-11-12')
on conflict (rule_key) do nothing;

-- Scorecard: each rule's passed and held cohorts against the graded ledger.
-- Units at the taken price, one unit to win on a plus price, one unit at
-- risk on a minus price. Shadow trap rows (rule_key trap_shadow_*) have no
-- ledger row and are left to the lookback.
create or replace view public.rule_gate_scorecard as
with graded as (
  select l.rule_key, l.mode, l.verdict, l.sport, l.bet_type, l.side, s.actual_outcome, s.game_date,
         case when s.actual_outcome = 'won' and o.n > 0 then o.n / 100.0
              when s.actual_outcome = 'won' and o.n < 0 then 100.0 / abs(o.n)
              when s.actual_outcome = 'lost' then -1
              else 0 end as units
    from public.rule_gate_log l
    join public.ai_suggestions s
      on s.session_id = l.session_id and s.home_team = l.home_team and s.away_team = l.away_team
     and s.bet_type = l.bet_type and s.voided_at is null
    cross join lateral (select nullif(regexp_replace(coalesce(s.odds, ''), '[^0-9-]', '', 'g'), '')::numeric as n) o
   where s.actual_outcome in ('won', 'lost', 'push')
     and l.rule_key not like 'trap_shadow_%'
)
select rule_key, mode, verdict, sport, bet_type,
       count(*) as picks,
       count(*) filter (where actual_outcome = 'won') as won,
       count(*) filter (where actual_outcome = 'lost') as lost,
       count(*) filter (where actual_outcome = 'push') as pushed,
       round(100.0 * count(*) filter (where actual_outcome = 'won') / nullif(count(*) filter (where actual_outcome in ('won', 'lost')), 0), 1) as win_pct,
       round(sum(units)::numeric, 2) as units,
       min(game_date)::date as first_game,
       max(game_date)::date as last_game
  from graded
 group by rule_key, mode, verdict, sport, bet_type
 order by rule_key, verdict;

-- Trap signals to shadow (decision 3): run line traps and juicy dog traps
-- stop publishing for MLB. The dial reads sport row then __all__, code
-- default open, so only MLB changes.
insert into public.sport_dials (sport, dial, value) values
  ('__all__', 'trap_publish_spread', 1),
  ('__all__', 'trap_publish_juicy_dog', 1),
  ('MLB', 'trap_publish_spread', 0),
  ('MLB', 'trap_publish_juicy_dog', 0)
on conflict (sport, dial) do update set value = excluded.value, updated_at = now();

insert into public.model_weight_changes (sport, component, before, after, reason, source) values
  ('MLB', 'trap_publish_spread, trap_publish_juicy_dog: trap signals to shadow',
   jsonb_build_object('trap_publish_spread', 1, 'trap_publish_juicy_dog', 1, 'note', 'no dial, every detected trap published'),
   jsonb_build_object('trap_publish_spread', 0, 'trap_publish_juicy_dog', 0),
   'Owner 2026-10-01 YES on build_queue 69. Lookback since 08-01: MLB moneyline trap fades 63-31 (chalk and home signals) but run line fades 12-11 and juicy dog fades 17-12 on 40 rows, lure score does not sort them. Shadow traps log to rule_gate_log (rule_key trap_shadow_spread, trap_shadow_juicy_dog) with the fade side and price for the lookback to grade.',
   'owner-approved-2026-10-01');

-- Sunday sweep variants (decision 2): the three approved MLB moneyline
-- counterfactuals join the weekly replay. The cron secret is read from the
-- job's own command, never written here.
do $$
declare
  v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'weekly-replay-sweep';
  if v_cmd is null then
    raise exception 'weekly-replay-sweep job not found';
  end if;
  if v_cmd not like '%pdamp75:current:pitcher_anchor_damp=0.75%' then
    v_cmd := replace(v_cmd,
      'shift_hi:current:home_margin_shift=-0.75&run_id=',
      'shift_hi:current:home_margin_shift=-0.75%3Bpdamp75:current:pitcher_anchor_damp=0.75%3Bpdamp1:current:pitcher_anchor_damp=1.0%3Bchalk15:current:chalk_penalty_pp=1.5&run_id=');
    if v_cmd not like '%pdamp75:current:pitcher_anchor_damp=0.75%' then
      raise exception 'weekly-replay-sweep command did not carry the expected variant list';
    end if;
    perform cron.alter_job(job_id := (select jobid from cron.job where jobname = 'weekly-replay-sweep'), command := v_cmd);
  end if;
end $$;

update public.build_queue set status = 'done',
  detail = detail || ' SHIPPED 2026-10-01: rule_gates seeded (five rules, mode shadow, sunset 2026-11-12), rule_gate_log written by pre-analyze after every ledger write, rule_gate_scorecard view. Promotion is an owner call at 100 picks per verdict.'
 where id = 68;
update public.build_queue set status = 'done',
  detail = detail || ' SHIPPED 2026-10-01: UFC leg_prob_floor 1.01 (model_weight_changes 38), trap_publish_spread and trap_publish_juicy_dog 0 for MLB, shadow traps logged to rule_gate_log. Tennis pool band stays as filed (no change until the leg floor is per sport and band).'
 where id = 69;
update public.build_queue set status = 'done',
  detail = detail || ' SHIPPED 2026-10-01: weekly-replay-sweep carries pdamp75, pdamp1 and chalk15 from Monday 2026-10-05.'
 where id = 74;
update public.build_queue set status = 'done',
  detail = detail || ' SHIPPED 2026-10-01: MODEL_JUDGMENT claude-sonnet-5 in data-integrity-agent.js.'
 where id = 75;

insert into public.build_queue (priority, status, title, detail) values
  ('medium', 'open', 'Rule gate promotion review (owner call): each MLB shadow rule at 100 picks per verdict on rule_gate_scorecard',
   'Shipped 2026-10-01 as shadow. The Monday review reads rule_gate_scorecard: a rule earns live when its held cohort loses and its passed cohort holds on 100 picks each, with a positive line in the weeks after proposal (sunset 2026-11-12, it must re survive). Live mode is a mode flip on rule_gates plus a model_weight_changes row, and a change to how claims publish resets the affected calibration maps.'),
  ('low', 'open', 'Grade the shadow traps: rule_gate_log rows with rule_key trap_shadow_spread and trap_shadow_juicy_dog against game_results, as fades',
   'Shadow traps (MLB run line and juicy dog) are logged with the fade side, price and lure evidence but have no ai_suggestions row, so rule_gate_scorecard leaves them out. The lookback or a small grader joins them to results so the signal can be re judged on its own record.');
