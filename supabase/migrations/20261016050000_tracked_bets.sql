-- Tracked bets (owner 2026-10-16: "one more tab next to board of tracked
-- would be great and a little track bet that you can click to add that
-- to tracked"). One row per signed in user per tracked play or prop.
-- The browser writes it directly through the anon client under RLS, so
-- a user only ever sees and changes their own rows. A visitor who is not
-- signed in keeps the same list in local storage on their device, and
-- it moves into this table the first time they sign in.
--
-- item is the snapshot the Tracked page renders from (pick text, teams,
-- kickoff, price, book and model percentages). Outcomes are never stored
-- here: the page asks the server for the official grade by key.

create table if not exists public.tracked_bets (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  kind text not null check (kind in ('game', 'prop')),
  item jsonb not null,
  game_time timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, item_key)
);

create index if not exists tracked_bets_user_game_time
  on public.tracked_bets (user_id, game_time desc);

alter table public.tracked_bets enable row level security;

create policy tracked_bets_select_own on public.tracked_bets
  for select to authenticated using (auth.uid() = user_id);

create policy tracked_bets_insert_own on public.tracked_bets
  for insert to authenticated with check (auth.uid() = user_id);

create policy tracked_bets_update_own on public.tracked_bets
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy tracked_bets_delete_own on public.tracked_bets
  for delete to authenticated using (auth.uid() = user_id);
