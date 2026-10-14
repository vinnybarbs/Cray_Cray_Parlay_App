-- Promo codes (owner 2026-10-14): codes the owner hands to friends who
-- will spread the word. Redeeming one gives free Pro, for good or for a
-- set number of days, with no card and no Stripe. The owner (or the exec
-- assistant) creates codes with an insert. Only the server redeems them,
-- through redeem_promo_code(), which checks and counts in one step.

create table if not exists public.promo_codes (
  code text primary key check (code = upper(code) and length(code) between 3 and 40),
  note text,
  -- null means free Pro for good, else this many days from redeeming.
  grant_days integer check (grant_days is null or grant_days > 0),
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.promo_redemptions (
  code text not null references public.promo_codes(code),
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)
);

alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;

-- out_result is 'ok', 'already', 'invalid', 'expired' or 'used_up', and
-- out_until is the new comp_until on ok or already.
create or replace function public.redeem_promo_code(p_code text, p_user uuid, p_email text)
returns table (out_result text, out_until timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  c public.promo_codes%rowtype;
  v_until timestamptz;
begin
  select * into c from public.promo_codes where code = upper(trim(p_code)) for update;
  if not found or not c.active then
    return query select 'invalid'::text, null::timestamptz; return;
  end if;
  if exists (select 1 from public.promo_redemptions r where r.code = c.code and r.user_id = p_user) then
    return query select 'already'::text, (select s.comp_until from public.subscriptions s where s.user_id = p_user); return;
  end if;
  if c.expires_at is not null and c.expires_at <= now() then
    return query select 'expired'::text, null::timestamptz; return;
  end if;
  if c.max_uses is not null and c.uses >= c.max_uses then
    return query select 'used_up'::text, null::timestamptz; return;
  end if;

  select s.comp_until into v_until from public.subscriptions s where s.user_id = p_user;
  if c.grant_days is null then
    v_until := 'infinity';
  elsif v_until is null or v_until < now() then
    v_until := now() + make_interval(days => c.grant_days);
  elsif v_until <> 'infinity' then
    v_until := v_until + make_interval(days => c.grant_days);
  end if;

  insert into public.promo_redemptions (code, user_id) values (c.code, p_user);
  update public.promo_codes set uses = uses + 1 where code = c.code;
  insert into public.subscriptions (user_id, email, comp_until)
    values (p_user, p_email, v_until)
    on conflict (user_id) do update set comp_until = excluded.comp_until, updated_at = now();
  return query select 'ok'::text, v_until;
end
$$;

revoke all on function public.redeem_promo_code(text, uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_promo_code(text, uuid, text) to service_role;
