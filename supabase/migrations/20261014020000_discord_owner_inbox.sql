-- Owner 2026-10-14: a private Discord server where the owner can reply
-- to the exec assistant. Webhooks stay send only. A bot polls one
-- private channel (#talk-to-claude) every ten minutes through
-- /cron/discord-inbox and stores the owner's own messages here. The exec
-- assistant reads status new rows at the start of every run, treats each
-- as the owner's answer, and marks it handled with what it did.

create table if not exists public.owner_inbox (
  id bigserial primary key,
  discord_message_id text not null unique,
  channel_id text not null,
  author_id text not null,
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  reply_to text,
  posted_at timestamptz not null,
  received_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'handled', 'ignored')),
  handled_at timestamptz,
  handled_by text,
  response text
);
create index if not exists owner_inbox_new_idx on public.owner_inbox (posted_at) where status = 'new';
create index if not exists owner_inbox_channel_idx on public.owner_inbox (channel_id, posted_at desc);
-- Service role only: no policies, so anon and authenticated read nothing.
alter table public.owner_inbox enable row level security;

do $$
declare
  v_secret text;
begin
  select substring(command from 'secret=([^&'']+)') into v_secret
    from cron.job where jobname = 'discord-morning-board' limit 1;
  if v_secret is null then
    raise exception 'discord-morning-board job not found, cannot read the cron secret';
  end if;

  if exists (select 1 from cron.job where jobname = 'discord-inbox') then
    perform cron.unschedule('discord-inbox');
  end if;

  -- Every ten minutes. A no-op until the bot variables are set on Railway.
  perform cron.schedule('discord-inbox', '*/10 * * * *', format($j$
    SELECT net.http_post(
      url := 'https://craycrayparlayapp-production.up.railway.app/cron/discord-inbox?secret=%s',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 60000);
  $j$, v_secret));
end $$;
