-- Soccer goal model (owner 2026-10-13: "Do goal model").
--
-- soccer_match_history: finished matches from ESPN scoreboards, kept apart
--   from game_results on purpose. game_results feeds grading, and the deep
--   history walk this model needs (about 14 months) must not hand old
--   pending rows new results.
-- soccer_team_strengths: the current attack and defense rating per club
--   and pool (europe, mls), replaced on every fit. team_key is the JS
--   soccerTeamKey() of the ESPN name, which pre-analyze matches against
--   the Odds API names.
-- soccer_model_fits: one row per pool per fit with the competition rates,
--   rho, and the walk forward replay against closing prices (log loss and
--   Brier per blend weight). The evidence for any goal_model_weight move.
-- goal_model_weight dial: 0 for all eight soccer sports. At 0 the model's
--   probabilities are recorded on every read (edge_factors goalModel) and
--   change no claim. Raising it is an owner call on the replay evidence
--   and the three test protocol, and a new calibration regime.
-- fit-soccer-strengths cron: daily 09:10 UTC, ahead of the morning
--   pre-analyze runs. The command reuses the sync-standings URL and secret
--   from cron.job so the secret never enters the repo.

create table if not exists public.soccer_match_history (
  espn_event_id text primary key,
  competition text not null,
  match_date date not null,
  home_team_id integer,
  home_team_name text not null,
  away_team_id integer,
  away_team_name text not null,
  home_goals integer not null,
  away_goals integer not null,
  espn_status text,
  created_at timestamptz not null default now()
);
create index if not exists soccer_match_history_comp_date on public.soccer_match_history (competition, match_date);

create table if not exists public.soccer_team_strengths (
  pool text not null,
  espn_team_id text not null,
  team_name text not null,
  team_key text not null,
  attack numeric not null,
  defense numeric not null,
  games_weighted numeric not null,
  competitions text[] not null default '{}',
  fitted_at timestamptz not null,
  primary key (pool, espn_team_id)
);
create index if not exists soccer_team_strengths_key on public.soccer_team_strengths (pool, team_key);

create table if not exists public.soccer_model_fits (
  id bigserial primary key,
  pool text not null,
  fitted_at timestamptz not null,
  n_matches integer not null,
  n_teams integer not null,
  rho numeric not null,
  half_life_days numeric not null,
  ridge numeric not null,
  competitions jsonb not null,
  evaluation jsonb,
  created_at timestamptz not null default now()
);
create index if not exists soccer_model_fits_pool_time on public.soccer_model_fits (pool, fitted_at desc);

alter table public.soccer_match_history enable row level security;
alter table public.soccer_team_strengths enable row level security;
alter table public.soccer_model_fits enable row level security;

insert into public.sport_dials (sport, dial, value, updated_at)
select s, 'goal_model_weight', '0', now()
from unnest(array['EPL', 'MLS', 'Champions League', 'Europa League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1']) s
on conflict do nothing;

insert into public.model_weight_changes (changed_at, sport, component, before, after, reason, source)
select now(), s, 'goal_model_weight', null,
  '{"goal_model_weight": 0}'::jsonb,
  'New dial: the fitted goal model is recorded on every soccer read at weight 0 and moves no claim. Weight only on replay evidence against the close (soccer_model_fits.evaluation).',
  'owner-approved-2026-10-13'
from unnest(array['EPL', 'MLS', 'Champions League', 'Europa League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1']) s
where not exists (select 1 from public.model_weight_changes m where m.sport = s and m.component = 'goal_model_weight');

do $mig$
declare
  src text;
  cmd text;
begin
  if exists (select 1 from cron.job where jobname = 'fit-soccer-strengths') then
    return;
  end if;
  select command into src from cron.job where jobname = 'sync-standings';
  if src is null then
    raise exception 'sync-standings cron job not found';
  end if;
  cmd := regexp_replace(src, '/cron/sync-standings', '/cron/fit-soccer-strengths');
  cmd := regexp_replace(cmd, '&sports=[A-Za-z0-9,]*', '');
  if position('fit-soccer-strengths' in cmd) = 0 then
    raise exception 'could not build fit-soccer-strengths command';
  end if;
  perform cron.schedule('fit-soccer-strengths', '10 9 * * *', cmd);
end
$mig$;
