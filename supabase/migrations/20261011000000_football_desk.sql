-- 2026-10-11. Owner go 2026-10-09 on the workforce plan (build_queue 89,
-- steps 1 to 3): the football desk in shadow. Directive 13 is amended
-- once so a registered analysis worker may append to its own shadow
-- table, a workforce registry names every worker and the one table it
-- may write, two append only desk tables hold the verdicts and the
-- pre registered hypotheses, and desk_scorecard grades the verdicts
-- against the result and the close in the shape of rule_gate_scorecard.
-- Nothing on the pricing or publish path reads any of these.

-- 1. Directive 13 amendment (plan decision 1, approved 2026-10-09).
update public.directives set
  directive = 'Only the code shipping session changes code or production data. A registered analysis worker (agent_registry, status shadow or live) may append rows to its own shadow table named there and file its one blackboard row, nothing else. Nothing on the pricing or publish path reads a shadow table until the owner promotes a category, and the code session ships that promotion as a dial.',
  enforcement = 'agent briefs under agents/ and the agent_registry write_table column. Desk tables are append only by trigger, RLS on with no policies. git history is the audit trail for code. This check.',
  check_sql = $q$select 'desk rows from an unregistered worker: ' || v.desk as name from (select distinct desk from public.desk_verdicts where written_at > now() - interval '7 days' union select distinct desk from public.desk_hypotheses where registered_at > now() - interval '7 days') v where v.desk not in (select name from public.agent_registry where status in ('shadow', 'live')) union all select 'registered worker whose brief row is missing from skills: ' || r.name from public.agent_registry r where r.status in ('shadow', 'live') and r.brief not in (select name from public.skills)$q$,
  notes = coalesce(notes, '') || ' Amended 2026-10-11 (owner go 2026-10-09, workforce plan decision 1): a registered analysis worker may append to its own shadow table. The football desk is the first, in shadow, writing desk_verdicts and desk_hypotheses only.',
  updated_at = now()
where id = 13;

-- 2. The workforce registry (plan decision 7).
create table if not exists public.agent_registry (
  name text primary key,
  kind text not null check (kind in ('routine', 'desk', 'cron')),
  brief text,
  trigger_id text,
  model text,
  schedule text,
  write_table text not null default 'agent_reports',
  scorecard_view text,
  monthly_budget_usd numeric,
  status text not null default 'shadow' check (status in ('shadow', 'live', 'retired')),
  review_by date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.agent_registry enable row level security;
comment on table public.agent_registry is
  'Every LLM worker: its brief (a skills table row), its trigger, model, schedule, the one table it may write beyond agent_reports, its scorecard view, budget and status. The ops check verifies each shadow or live worker fired on schedule and wrote only its own table. Directive 13.';

insert into public.agent_registry (name, kind, brief, trigger_id, model, schedule, write_table, scorecard_view, monthly_budget_usd, status, review_by, notes) values
  ('ops-check', 'routine', 'agents/daily-ops-check.md', 'trig_015qoYxVhMJyekxCgUaV1atQ', 'Opus 5.5', '0 14 * * * UTC (08:00 MDT daily)', 'agent_reports', null, null, 'live', '2026-11-02', 'Routine runs bill the claude.ai plan, not the API key, so the cost audit reads the console for this worker.'),
  ('exec-assistant', 'routine', 'agents/exec-assistant.md', 'trig_01XJzYU2KWVus6U9YWWz5zHb', 'Opus 5.5', 'CRON_TZ=America/Denver 57 8 * * * (08:57 MT daily)', 'agent_reports', null, null, 'live', '2026-11-02', 'The code shipping session and the one voice to the owner. Also writes code through the ship pipeline and build_queue.'),
  ('calibration-review', 'routine', 'agents/weekly-calibration-review.md', 'trig_01XdGMb6AvwbjCHJWNGJPTFn', 'Opus 5.5', '0 12 * * 1 UTC (06:00 MDT Mondays)', 'agent_reports', null, null, 'live', '2026-11-02', 'The model unit manager: reads rule_gate_scorecard, the bucket scorecard and desk_scorecard and files the verdict lists.'),
  ('cost-audit', 'routine', 'agents/monthly-cost-audit.md', 'trig_01LP5t3AcowYb1vXr7XSNdCW', 'Opus 5.5', '0 15 2 * * UTC (09:00 MDT on the 2nd)', 'agent_reports', null, null, 'live', '2026-11-02', 'Reconciles the cost log to the console bill, the desks included from November 2.'),
  ('football-desk', 'desk', 'agents/football-desk.md', null, 'Sonnet 5.5', 'CRON_TZ=America/Denver 0 18 * * 5 and 45 9 * * 0 and 30 6 * * 2 (Fri 18:00, Sun 09:45, Tue 06:30 MT), three triggers with the same prompt', 'desk_verdicts, desk_hypotheses', 'desk_scorecard', 30, 'shadow', '2026-11-22', 'Trigger ids filled in by the owner after creating the three triggers in the routines UI. Shadow until a category passes the promotion bar: 100 graded verdicts in the category, desk_right_pct above the model win rate and avg_clv_pp positive, then an owner flip with a model_weight_changes row into the bounded veto.')
on conflict (name) do update set brief = excluded.brief, trigger_id = coalesce(public.agent_registry.trigger_id, excluded.trigger_id), model = excluded.model, schedule = excluded.schedule, write_table = excluded.write_table, scorecard_view = excluded.scorecard_view, monthly_budget_usd = excluded.monthly_budget_usd, status = excluded.status, review_by = excluded.review_by, notes = excluded.notes, updated_at = now();

-- 3. The desk tables, append only (plan decisions 2 and 3).
create table if not exists public.desk_verdicts (
  id bigserial primary key,
  desk text not null,
  run_label text not null check (run_label in ('friday', 'sunday', 'tuesday', 'adhoc')),
  sport text not null,
  game_key text,
  home_team text not null,
  away_team text not null,
  game_date timestamptz not null,
  market text not null check (market in ('h2h', 'spreads', 'totals')),
  model_side text not null check (model_side in ('home', 'away', 'over', 'under')),
  model_pick text not null,
  model_tier text,
  model_edge_pp numeric,
  model_odds text,
  model_point numeric,
  suggestion_id bigint,
  analysis_id uuid,
  verdict text not null check (verdict in ('agree', 'hold', 'shade')),
  shade_pp numeric check (shade_pp is null or (shade_pp > 0 and shade_pp <= 2)),
  category text not null check (category in ('none', 'injury_depth', 'quarterback', 'weather', 'rest_travel', 'matchup', 'situation', 'line_move', 'key_number')),
  evidence jsonb not null default '[]'::jsonb,
  note text,
  written_at timestamptz not null default now(),
  constraint desk_verdicts_shade_needs_pp check (verdict <> 'shade' or shade_pp is not null),
  constraint desk_verdicts_hold_shade_need_category check (verdict = 'agree' or category <> 'none'),
  constraint desk_verdicts_evidence_is_array check (jsonb_typeof(evidence) = 'array')
);
create index if not exists desk_verdicts_desk_written_idx on public.desk_verdicts (desk, written_at desc);
create index if not exists desk_verdicts_suggestion_idx on public.desk_verdicts (suggestion_id);
alter table public.desk_verdicts enable row level security;
comment on table public.desk_verdicts is
  'A desk''s verdict on a published model pick: agree, hold, or shade down by at most 2pp, with one category from the fixed list and an evidence array of {fact, source}. No probability of its own. Append only. Graded by desk_scorecard. Nothing on the publish path reads it.';

create table if not exists public.desk_hypotheses (
  id bigserial primary key,
  desk text not null,
  month date not null,
  hypothesis text not null,
  mechanism text not null,
  direction text not null,
  market text not null default 'any' check (market in ('h2h', 'spreads', 'totals', 'any')),
  test_sql text,
  registered_at timestamptz not null default now(),
  graded_at timestamptz,
  result jsonb,
  status text not null default 'open' check (status in ('open', 'supported', 'refuted', 'inconclusive'))
);
create index if not exists desk_hypotheses_desk_month_idx on public.desk_hypotheses (desk, month);
alter table public.desk_hypotheses enable row level security;
comment on table public.desk_hypotheses is
  'Pre registered desk hypotheses, three to five a month, each with a mechanism, a direction and the SQL that grades it. The hypothesis never changes after registration, only graded_at, result and status. Directive 13.';

create or replace function public.desk_verdicts_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'desk_verdicts is append only (directive 13)';
end $$;
create trigger desk_verdicts_append_only
  before update or delete on public.desk_verdicts
  for each row execute function public.desk_verdicts_append_only();

create or replace function public.desk_hypotheses_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'desk_hypotheses is append only (directive 13)';
  end if;
  if new.desk is distinct from old.desk or new.month is distinct from old.month
     or new.hypothesis is distinct from old.hypothesis or new.mechanism is distinct from old.mechanism
     or new.direction is distinct from old.direction or new.market is distinct from old.market
     or new.test_sql is distinct from old.test_sql or new.registered_at is distinct from old.registered_at then
    raise exception 'a registered hypothesis never changes, only its grade (directive 13)';
  end if;
  return new;
end $$;
create trigger desk_hypotheses_guard
  before update or delete on public.desk_hypotheses
  for each row execute function public.desk_hypotheses_guard();

-- 4. The scorecard, in the shape of rule_gate_scorecard. A verdict is
-- graded once the model pick it sits on settles. desk_right_pct: an
-- agree is right when the model pick won, a hold or shade is right when
-- it lost. avg_clv_pp is the model pick's own closing line value from
-- pick_clv_all, so a category that holds picks the market later moved
-- against shows a negative number here.
create or replace view public.desk_scorecard as
with graded as (
  select v.desk, v.sport, v.market, v.run_label, v.verdict, v.category,
         s.actual_outcome, s.game_date,
         case when s.actual_outcome = 'won' and o.n > 0 then o.n / 100.0
              when s.actual_outcome = 'won' and o.n < 0 then 100.0 / abs(o.n)
              when s.actual_outcome = 'lost' then -1
              else 0 end as units,
         c.price_clv_pp
    from public.desk_verdicts v
    join public.ai_suggestions s on s.id = v.suggestion_id and s.voided_at is null
    cross join lateral (select nullif(regexp_replace(coalesce(s.odds, ''), '[^0-9-]', '', 'g'), '')::numeric as n) o
    left join public.pick_clv_all c on c.id = s.id
   where s.actual_outcome in ('won', 'lost', 'push')
)
select desk, sport, market, run_label, verdict, category,
       count(*) as picks,
       count(*) filter (where actual_outcome = 'won') as won,
       count(*) filter (where actual_outcome = 'lost') as lost,
       count(*) filter (where actual_outcome = 'push') as pushed,
       round(100.0 * count(*) filter (where actual_outcome = 'won') / nullif(count(*) filter (where actual_outcome in ('won', 'lost')), 0), 1) as win_pct,
       round(sum(units)::numeric, 2) as units,
       round(100.0 * count(*) filter (where (verdict = 'agree' and actual_outcome = 'won') or (verdict <> 'agree' and actual_outcome = 'lost'))
             / nullif(count(*) filter (where actual_outcome in ('won', 'lost')), 0), 1) as desk_right_pct,
       count(price_clv_pp) as clv_n,
       round(avg(price_clv_pp)::numeric, 2) as avg_clv_pp,
       min(game_date)::date as first_game,
       max(game_date)::date as last_game
  from graded
 group by desk, sport, market, run_label, verdict, category
 order by desk, sport, market, verdict, category;
comment on view public.desk_scorecard is
  'Desk verdicts graded against the settled model pick and its closing line value, per desk, sport, market, run and category. The Monday review reads it. Promotion bar per category: 100 graded verdicts, desk_right_pct above the model win rate, avg_clv_pp positive for the held side.';
