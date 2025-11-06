create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  username text unique,
  full_name text,
  avatar_url text
);

alter table profiles enable row level security;
create policy profiles_select on profiles for select using (auth.uid() = user_id);
create policy profiles_insert on profiles for insert with check (auth.uid() = user_id);
create policy profiles_update on profiles for update using (auth.uid() = user_id);

create table if not exists parlays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  ai_model varchar(50) not null,
  risk_level varchar(20) not null,
  sportsbook varchar(50) not null,
  preference_type varchar(20) not null,
  total_legs integer not null,
  combined_odds varchar(20),
  potential_payout numeric(10,2),
  is_lock_bet boolean default false,
  status varchar(20) default 'pending',
  final_outcome varchar(20),
  hit_percentage numeric(5,2),
  profit_loss numeric(10,2),
  confidence_score numeric(3,2),
  metadata jsonb
);

create index if not exists idx_parlays_created_at on parlays(created_at);
create index if not exists idx_parlays_user on parlays(user_id);
create index if not exists idx_parlays_status on parlays(status);
create index if not exists idx_parlays_outcome on parlays(final_outcome);

alter table parlays enable row level security;
create policy parlays_select on parlays for select using (auth.uid() = user_id);
create policy parlays_insert on parlays for insert with check (auth.uid() = user_id);
create policy parlays_update on parlays for update using (auth.uid() = user_id);
create policy parlays_delete on parlays for delete using (auth.uid() = user_id);

create table if not exists parlay_legs (
  id uuid primary key default gen_random_uuid(),
  parlay_id uuid not null references parlays(id) on delete cascade,
  leg_number integer not null,
  game_date date not null,
  sport varchar(50) not null,
  home_team varchar(100) not null,
  away_team varchar(100) not null,
  bet_type varchar(50) not null,
  bet_details jsonb not null,
  odds varchar(20) not null,
  confidence integer,
  reasoning text,
  game_completed boolean default false,
  leg_result varchar(20),
  actual_value numeric(10,2),
  margin_of_victory numeric(10,2),
  created_at timestamptz default now(),
  resolved_at timestamptz
);

create index if not exists idx_parlay_legs_parlay on parlay_legs(parlay_id);
create index if not exists idx_parlay_legs_game_date on parlay_legs(game_date);
create index if not exists idx_parlay_legs_teams on parlay_legs(home_team, away_team);
create index if not exists idx_parlay_legs_bet_type on parlay_legs(bet_type);

alter table parlay_legs enable row level security;
create policy parlay_legs_select on parlay_legs for select using (
  exists (
    select 1 from parlays p where p.id = parlay_id and p.user_id = auth.uid()
  )
);
create policy parlay_legs_insert on parlay_legs for insert with check (
  exists (
    select 1 from parlays p where p.id = parlay_id and p.user_id = auth.uid()
  )
);
create policy parlay_legs_update on parlay_legs for update using (
  exists (
    select 1 from parlays p where p.id = parlay_id and p.user_id = auth.uid()
  )
);
create policy parlay_legs_delete on parlay_legs for delete using (
  exists (
    select 1 from parlays p where p.id = parlay_id and p.user_id = auth.uid()
  )
);

create table if not exists user_stats_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  stat_date date not null,
  bets_placed integer default 0,
  bets_won integer default 0,
  bets_lost integer default 0,
  bets_push integer default 0,
  win_rate numeric(5,2),
  roi numeric(6,2),
  avg_odds numeric(8,2),
  created_at timestamptz default now(),
  primary key (user_id, stat_date)
);

alter table user_stats_daily enable row level security;
create policy user_stats_daily_select on user_stats_daily for select using (auth.uid() = user_id);
create policy user_stats_daily_upsert on user_stats_daily for insert with check (auth.uid() = user_id);
create policy user_stats_daily_update on user_stats_daily for update using (auth.uid() = user_id);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  sport varchar(20) not null,
  name text not null,
  api_sports_id integer,
  provider_ids jsonb,
  created_at timestamptz default now(),
  unique (sport, name)
);

create index if not exists idx_teams_sport_name on teams(sport, name);

create table if not exists team_aliases (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  sport varchar(20) not null,
  alias text not null,
  unique (sport, alias)
);

create index if not exists idx_team_aliases_team on team_aliases(team_id);
create index if not exists idx_team_aliases_alias on team_aliases using gin (alias gin_trgm_ops);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete set null,
  sport varchar(20) not null,
  name text not null,
  position text,
  provider_ids jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_players_team on players(team_id);
create index if not exists idx_players_name on players using gin (name gin_trgm_ops);

create table if not exists player_aliases (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  sport varchar(20) not null,
  alias text not null,
  unique (sport, alias)
);

create index if not exists idx_player_aliases_player on player_aliases(player_id);
create index if not exists idx_player_aliases_alias on player_aliases using gin (alias gin_trgm_ops);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  sport varchar(20) not null,
  season integer,
  week integer,
  game_date timestamptz,
  status varchar(20),
  home_team_id uuid references teams(id),
  away_team_id uuid references teams(id),
  provider_ids jsonb,
  created_at timestamptz default now(),
  unique (sport, season, week, home_team_id, away_team_id)
);

create index if not exists idx_games_date on games(game_date);
create index if not exists idx_games_teams on games(home_team_id, away_team_id);

create table if not exists team_stats_season (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  season integer not null,
  metrics jsonb not null,
  updated_at timestamptz default now(),
  unique (team_id, season)
);

create index if not exists idx_team_stats_team on team_stats_season(team_id);

create table if not exists player_stats_season (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  season integer not null,
  metrics jsonb not null,
  updated_at timestamptz default now(),
  unique (player_id, season)
);

create index if not exists idx_player_stats_player on player_stats_season(player_id);

create table if not exists team_game_stats (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  metrics jsonb not null,
  updated_at timestamptz default now(),
  unique (game_id, team_id)
);

create index if not exists idx_team_game_stats_game on team_game_stats(game_id);

create table if not exists player_game_stats (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  metrics jsonb not null,
  updated_at timestamptz default now(),
  unique (game_id, player_id)
);

create index if not exists idx_player_game_stats_game on player_game_stats(game_id);

create table if not exists injuries (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references players(id) on delete set null,
  team_id uuid references teams(id) on delete set null,
  report_date date not null,
  status text,
  details jsonb,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_injuries_team on injuries(team_id);
create index if not exists idx_injuries_report_date on injuries(report_date);
create index if not exists idx_injuries_expires_at on injuries(expires_at);

create table if not exists head_to_head_agg (
  id uuid primary key default gen_random_uuid(),
  sport varchar(20) not null,
  team_a_id uuid not null references teams(id) on delete cascade,
  team_b_id uuid not null references teams(id) on delete cascade,
  metrics jsonb,
  updated_at timestamptz default now(),
  unique (sport, team_a_id, team_b_id)
);

create index if not exists idx_h2h_teams on head_to_head_agg(team_a_id, team_b_id);

create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  url_hash text not null,
  title text,
  source text,
  published_at timestamptz,
  content text,
  entities jsonb,
  created_at timestamptz default now(),
  unique (url_hash)
);

create index if not exists idx_articles_published_at on articles(published_at);
create index if not exists idx_articles_fts on articles using gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')));
create index if not exists idx_articles_url_trgm on articles using gin (url gin_trgm_ops);

create table if not exists game_research_cache (
  id uuid primary key default gen_random_uuid(),
  sport varchar(20) not null,
  game_id uuid references games(id) on delete cascade,
  summary text,
  sources jsonb,
  generated_at timestamptz default now(),
  expires_at timestamptz,
  unique (game_id)
);

create index if not exists idx_research_expires_at on game_research_cache(expires_at);

-- Odds cache for hourly refresh from Odds API
create table if not exists odds_cache (
  id uuid primary key default gen_random_uuid(),
  sport varchar(20) not null,
  game_id uuid references games(id) on delete cascade,
  external_game_id varchar(100), -- Odds API game ID
  commence_time timestamptz,
  home_team varchar(100) not null,
  away_team varchar(100) not null,
  bookmaker varchar(50) not null,
  market_type varchar(50) not null,
  outcomes jsonb not null, -- [{name, price, point}]
  last_updated timestamptz default now(),
  unique (external_game_id, bookmaker, market_type)
);

create index if not exists idx_odds_cache_game on odds_cache(game_id);
create index if not exists idx_odds_cache_external on odds_cache(external_game_id);
create index if not exists idx_odds_cache_commence on odds_cache(commence_time);
create index if not exists idx_odds_cache_updated on odds_cache(last_updated);
create index if not exists idx_odds_cache_teams on odds_cache(home_team, away_team);
