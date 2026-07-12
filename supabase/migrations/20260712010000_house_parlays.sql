-- Machine-built graded parlays (audit ROADMAP NOW item 4).
-- The house assembles cross-game parlays from its own verified positive-edge
-- legs (the auto_digest picks in ai_suggestions), publishes them before the
-- games, and settles them publicly after. One row per published parlay.

create table if not exists public.house_parlays (
  id bigint generated always as identity primary key,
  parlay_date date not null,                -- publication date (America/Denver day)
  legs_count int not null,
  -- Snapshot of each leg at build time. suggestion_id links back to the
  -- ai_suggestions row so settlement propagates from the existing pipeline.
  -- [{suggestion_id, sport, home_team, away_team, game_date, bet_type,
  --   pick, odds, edge_pp, tier}]
  legs jsonb not null,
  combined_odds int not null,               -- American odds for the full parlay
  combined_decimal numeric not null,        -- product of leg decimal odds
  combined_edge_pp numeric not null,        -- sum of leg edges (grading score)
  status text not null default 'pending',   -- pending | won | lost | push | void
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  -- one build per (day, size) — reruns of the builder must not duplicate
  unique (parlay_date, legs_count)
);

create index if not exists idx_house_parlays_date on public.house_parlays (parlay_date desc);
create index if not exists idx_house_parlays_status on public.house_parlays (status);

alter table public.house_parlays enable row level security;

-- Public read (the ledger is the product), service-role write.
drop policy if exists "house_parlays_public_read" on public.house_parlays;
create policy "house_parlays_public_read" on public.house_parlays
  for select using (true);

drop policy if exists "house_parlays_service_write" on public.house_parlays;
create policy "house_parlays_service_write" on public.house_parlays
  for all using (auth.role() = 'service_role');
