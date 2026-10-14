-- Billing (owner 2026-10-14): Stripe subscriptions at a $9.99 a month
-- launch price that a launch member keeps for life. One row per user,
-- written only by the server (service role) from Stripe webhooks. A
-- signed in user can read their own row. comp_until is the owner's free
-- access grant (friends, testers), set by hand.

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  -- Stripe's subscription status: trialing, active, past_due, canceled,
  -- incomplete, incomplete_expired, unpaid, paused. none before checkout.
  status text not null default 'none',
  price_id text,
  plan text check (plan in ('launch', 'standard')),
  -- Grandfathered: once true it stays true, and a returning launch
  -- member checks out at the launch price again.
  launch_member boolean not null default false,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  comp_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy subscriptions_read_own on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

-- Webhook idempotency: Stripe retries, so every event id is stored once.
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

alter table public.stripe_events enable row level security;

-- Launch seats taken, for the cap on the launch price.
create or replace function public.launch_seats_taken()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.subscriptions where launch_member
$$;

revoke all on function public.launch_seats_taken() from public, anon, authenticated;
grant execute on function public.launch_seats_taken() to service_role;
