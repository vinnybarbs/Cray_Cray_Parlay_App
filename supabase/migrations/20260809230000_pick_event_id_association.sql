-- Event-ID association for picks (2026-08-09).
--
-- The regrade dispute happened because picks carried no pointer to the
-- game they were priced from: settlement re-derived the association from
-- team names and calendar days, and calendar days lied (UTC-stamped
-- game_results before 2026-07-25, one grader with a 3-day window). From
-- now on every pick stores the Odds API event id it was priced from, and
-- settlement resolves results by that id first (primary-key hit against
-- odds_api_scores), instant +/-3h second, calendar day last. Props
-- already carry event_id from birth; this brings straight picks up to
-- the same standard.

alter table public.ai_suggestions
  add column if not exists odds_event_id text;

create index if not exists idx_ai_suggestions_odds_event
  on public.ai_suggestions (odds_event_id)
  where odds_event_id is not null;

comment on column public.ai_suggestions.odds_event_id is
  'The Odds API event id (odds_cache.external_game_id) this pick was priced from. Settlement resolves by this id before any team/date matching.';
