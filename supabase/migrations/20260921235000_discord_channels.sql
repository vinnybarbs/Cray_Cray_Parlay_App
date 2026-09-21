-- Owner 2026-09-21: Discord redesign. Three channels (board, receipts,
-- model), embeds, no links, no pixels. This adds the cursor the hourly
-- model feed uses and schedules the three new posters against Railway.
-- Webhooks are Railway env vars (DISCORD_WEBHOOK_URL for the board,
-- DISCORD_WEBHOOK_RECEIPTS_URL, DISCORD_WEBHOOK_MODEL_URL); a channel
-- without its own webhook falls back to the board one.

create table if not exists public.discord_feed_cursor (
  feed text primary key,
  last_seen timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.discord_feed_cursor enable row level security;

-- Seed at now so the feed starts with the next change, not the archive.
insert into public.discord_feed_cursor (feed, last_seen) values
  ('weight_changes', now()), ('directives', now())
on conflict (feed) do nothing;

do $$
declare
  v_secret text;
  j text;
begin
  select substring(command from 'secret=([^&'']+)') into v_secret
    from cron.job where jobname = 'discord-morning-board' limit 1;
  if v_secret is null then
    raise exception 'discord-morning-board job not found, cannot read the cron secret';
  end if;

  for j in select jobname from cron.job where jobname in ('discord-receipts', 'discord-model-feed', 'discord-dial-board') loop
    perform cron.unschedule(j);
  end loop;

  -- Receipts: 7:30 AM MT, after the West Coast games settle, before the board.
  perform cron.schedule('discord-receipts', '30 13 * * *', format($j$
    SELECT net.http_post(
      url := 'https://craycrayparlayapp-production.up.railway.app/cron/discord-receipts?secret=%s',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 120000);
  $j$, v_secret));

  -- Model feed: hourly at :20.
  perform cron.schedule('discord-model-feed', '20 * * * *', format($j$
    SELECT net.http_post(
      url := 'https://craycrayparlayapp-production.up.railway.app/cron/discord-model-feed?secret=%s',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 120000);
  $j$, v_secret));

  -- Dial board: Mondays 10:00 AM MT, after the scorecard and the review.
  perform cron.schedule('discord-dial-board', '0 16 * * 1', format($j$
    SELECT net.http_post(
      url := 'https://craycrayparlayapp-production.up.railway.app/cron/discord-dial-board?secret=%s',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 120000);
  $j$, v_secret));
end $$;

insert into public.build_queue (priority, status, title, detail) values
  ('medium', 'done', 'Discord redesign: three channels, embeds, no links, receipts, model feed, dial board (owner 2026-09-21)',
   'Board channel (DISCORD_WEBHOOK_URL): morning board and Strong Play or Sharp Take entry alerts as embeds, no site link. Receipts channel (DISCORD_WEBHOOK_RECEIPTS_URL): daily 07:30 MT card of yesterday''s settled picks by tier plus the 3, 7 and 30 day record, numbers from mv_public_record only. Model channel (DISCORD_WEBHOOK_MODEL_URL): hourly feed of new model_weight_changes rows and new or amended directives (cursor in discord_feed_cursor, advances only after a real post) and the Monday 10:00 MT dial board embed, one field per sport with multipliers and the week''s moves plus the bucket floors. Text on purpose, no pixels. A channel without its own webhook falls back to the board one. Still to do by hand: create the two channels in Discord, paste the two new webhooks into Railway.');
