-- Owner 2026-09-21: "use espn or cbs NOT EVER WIKIPEDIA", then "espn cbs
-- sports yahoo google sports really anything verified". The 09-21 04:45 MT
-- integrity sweep filed six MLB record_mismatch rows off Wikipedia season
-- pages that were a game behind, and each one reached that day's narration
-- as a DATA WARNING against a correct record. The code fence ships in the
-- same PR (lib/services/data-integrity-agent.js). This row makes it law and
-- gives the daily ops check a wire for it.

insert into directives (directive, decided_on, enforcement, check_sql, notes, status)
values (
  'Wikipedia is never a data source. Team records are verified only against ESPN, CBS Sports, Yahoo Sports, Fox Sports or the league''s official site, and a record mismatch citing anything else is never stored or narrated. No data agent searches Wikipedia for anything.',
  '2026-09-21',
  'lib/services/data-integrity-agent.js: RECORD_SOURCES fences the records-verifier web search (allowed_domains), BANNED_SOURCES blocks wikipedia.org on every other sub-agent, approvedRecordSource drops an off-list mismatch before insert (counted as dropped_unapproved_source on record_check_summary) and again in getIntelContext. Tested in __tests__/lib/data-integrity-sources.test.js, watched by this check_sql.',
  'select id, kind, team, payload->>''source'' as source, created_at from agent_intel where created_at > ''2026-09-22 00:00:00-06'' and created_at > now() - interval ''24 hours'' and payload::text ilike ''%wikipedia%''',
  'The six 2026-09-21 04:45 MT Wikipedia rows (Orioles, Blue Jays, Nationals, Tigers, Twins, Giants, each ours one game ahead) predate the fence. The check floor is 2026-09-22 so it starts clean after the deploy. Google has no standings pages the search tool can return, so it is not on the list.',
  'active'
);
