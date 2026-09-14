-- Directive 23 (owner, 2026-09-14): shadow sports compute without
-- narration until go-live. NCAAF narration alone breached the 6.00 daily
-- ceiling three Saturdays running (6.68, 7.51, 7.12) while the board
-- withheld every NCAAF read, so the Claude call bought prose nobody
-- could see. A whole-sport shadow read (every publish dial 0) stores
-- its edges, grades into the shadow ledger, and carries model_used
-- shadow-silent with zero tokens. Narration resumes the morning
-- promote_ready_markets opens a market for the sport.

insert into directives (directive, decided_on, enforcement, check_sql, notes, status)
values (
  'A whole-sport shadow read (publish_ml, publish_spread and publish_total all 0) is never narrated: the math runs, the edges store and grade into the shadow ledger, and no Claude call is made. Narration resumes the day a market of the sport goes live.',
  '2026-09-14',
  'pre-analyze-games shadowSilent branch (lib/services/publish-markets.js shadowNarration); this check_sql',
  'select g.sport, count(*) as narrated_shadow_rows from game_analysis g where g.generated_at > ''2026-09-14 12:00:00-06'' and coalesce(g.model_used, '''') <> ''shadow-silent'' and not exists (select 1 from sport_dials d where d.sport = g.sport and d.dial like ''publish_%'' and d.value >= 1) and exists (select 1 from sport_dials d where d.sport = g.sport and d.dial = ''publish_ml'') group by g.sport',
  'Owner 2026-09-14, the second option from the ops check cost finding. Tennis is excluded from the silent branch because it publishes.',
  'active'
);
