-- Golf field board: devigged outright odds + per-player research notes.
-- Populated by /cron/analyze-golf from odds_cache golf_% outrights. This is
-- a DISPLAY/value surface, not graded picks. Golf has no h2h edge model.
create table if not exists golf_field (
  id bigserial primary key,
  tournament_key text not null,
  tournament_name text,
  player_name text not null,
  prices jsonb,
  best_price int,
  best_book text,
  consensus_prob numeric,
  value_pp numeric,
  espn_position int,
  espn_score text,
  research_note text,
  news_context text,
  generated_at timestamptz not null default now(),
  unique (tournament_key, player_name)
);

-- Backend-only table, same deny-all posture as the rest: RLS on, no anon
-- policies. The server reads it with the service role and serves sanitized
-- JSON through /api/digest.
alter table golf_field enable row level security;

-- Three passes a day: pre-round morning, midday, evening (UTC).
select cron.schedule(
  'analyze-golf',
  '30 10,16,22 * * *',
  $$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/analyze-golf?secret=dZ3wOm9mlITZk3sYtN619yyj6iCJgfBnrqiI0jXQlIY',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) as request_id;
  $$
);
