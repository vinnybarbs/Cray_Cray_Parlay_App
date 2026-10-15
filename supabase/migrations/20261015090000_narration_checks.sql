-- Inline narration checker, shadow (owner 2026-10-11, build_queue 90).
-- pre-analyze-games.js writes one row per fresh narration: the Haiku 5.5
-- verdict on the draft against the context it was written from. Nothing
-- reads this table on the pricing or publish path. blocked stays false
-- for the two week shadow, after which the owner decides whether a
-- failing draft is rewritten and fact-check-picks is unscheduled.
create table if not exists public.narration_checks (
  id bigserial primary key,
  game_key text not null,
  sport text,
  game_date date,
  tier text,
  narration_model text,
  checker_model text not null,
  verdict text not null check (verdict in ('pass', 'fail', 'error')),
  issues jsonb not null default '[]'::jsonb,
  error text,
  analysis_snippet text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10, 6),
  blocked boolean not null default false,
  checked_at timestamptz not null default now()
);

create index if not exists narration_checks_checked_at_idx on public.narration_checks (checked_at desc);
create index if not exists narration_checks_game_key_idx on public.narration_checks (game_key);

-- Service role only. No anon or authenticated policy, the site never reads it.
alter table public.narration_checks enable row level security;
