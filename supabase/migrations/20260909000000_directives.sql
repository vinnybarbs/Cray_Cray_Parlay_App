-- THE DIRECTIVES TABLE (owner: "I have asked most of these same things
-- a million times over the months and nothing sticks... how do we
-- ensure this does?"). Root cause: owner decisions lived in chat,
-- which is not memory. What stuck across months was always code,
-- tests, tables, or skills. This table makes the decisions themselves
-- infrastructure: every standing owner directive, dated, with WHERE it
-- is enforced and, where mechanical, a check_sql that returns
-- violating rows (empty result = compliant). The daily ops check runs
-- every active check_sql; any returned row is a finding. Retire or
-- supersede directives here, never delete, the history is the point.
CREATE TABLE IF NOT EXISTS directives (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  directive text NOT NULL,
  decided_on date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  enforcement text NOT NULL,
  check_sql text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
COMMENT ON TABLE directives IS
  'Standing owner directives. status: active, retired, superseded. enforcement names the code path, test, trigger, or protocol that enforces it. check_sql, when present, returns violating rows and is run by the daily ops check compliance sweep.';

INSERT INTO directives (directive, decided_on, enforcement, check_sql, notes) VALUES
('Odds are an indicator of likelihood, not just a break even number. The devigged market consensus IS the base probability in every sport whenever it exists; the record blend survives only as the no-odds fallback.', '2026-09-02',
 'edge-calculator market anchor block; factors carry marketAnchored flag',
 NULL,
 'The anchor is the enforcement of the likelihood principle at the base.'),

('No side priced +300 or longer ever rates above Lean, regardless of claimed edge. Traps and Skips exempt.', '2026-09-02',
 'pick-grader.js and src/lib/tiers.js LONGSHOT_TIER_CEILING_ODDS; regression tests',
 'select id, sport, tier, odds from ai_suggestions where voided_at is null and created_at > now() - interval ''2 days'' and odds ~ ''^[+-]?[0-9]+$'' and odds::numeric >= 300 and tier in (''Sharp Take'',''Strong Play'',''Play'')',
 'Born from the +1300 no name vs SEC powerhouse pick.'),

('No Sharp Take at -150 or heavier (chalk fence). The pick publishes as Play instead.', '2026-08-10',
 'pick-grader chalk fence; weekly review judges the fenced population',
 'select id, sport, tier, odds from ai_suggestions where voided_at is null and created_at > now() - interval ''2 days'' and odds ~ ''^[+-]?[0-9]+$'' and odds::numeric <= -150 and tier = ''Sharp Take''',
 'Retires when per band price calibration proves out.'),

('Tennis at +251 or longer never publishes (dispersion mirage, not prediction). Pending rows past the fence are voided, not demoted.', '2026-09-01',
 'pre-analyze-games tennis fence; voidFencedTennisRow',
 'select id, tier, odds from ai_suggestions where voided_at is null and sport = ''Tennis'' and created_at > now() - interval ''2 days'' and odds ~ ''^[+-]?[0-9]+$'' and odds::numeric >= 251 and tier not in (''Trap'',''Skip'')',
 NULL),

('The frozen cohort (529 rows, resolved_at 2026-08-09 12:13:08.323644-06) is untouchable. No automated sweep may re-flip any of them.', '2026-08-09',
 'skill directives in performance review and data model; per row owner approval protocol',
 'select ''frozen cohort count drifted'' as violation where (select count(*) from ai_suggestions where resolved_at = ''2026-08-09 12:13:08.323644-06'') <> 529',
 NULL),

('No ledger modifications to picks with game_date before 2026-07-01. Grades never auto re-flip; regrades only via the allow_regrade transaction plus a cron_job_logs entry.', '2026-08-09',
 'app.allow_regrade guard; protocol in skills',
 NULL,
 'The regrade trigger is the hard enforcement; the date floor is protocol.'),

('Every model weight change goes through sport_dials AND model_weight_changes with evidence. No hardcoded weight edits without a dial row.', '2026-09-08',
 'dial board architecture; this check',
 'select d.sport, d.dial, d.updated_at from sport_dials d where d.updated_at > now() - interval ''7 days'' and not exists (select 1 from model_weight_changes m where m.changed_at between d.updated_at - interval ''1 hour'' and d.updated_at + interval ''1 hour'')',
 'Seed migrations are the one legitimate bulk write; log them once as a batch.'),

('Dial moves require the three test counterfactual (rescues the targeted losers, improves the sport whole replayed record, holds on shadow reads) and stay damped to 25 percent per step unless a reading repeats across consecutive Mondays.', '2026-09-08',
 'performance review skill section 3e; owner approval on specific numbers',
 NULL,
 NULL),

('When the formula changes how claims are generated, the band calibration is a new regime: reset the affected maps to identity and advance the fit floor. Never grade a new model by an old model''s measurements.', '2026-09-08',
 'protocol; applied 2026-09-02 (anchor) and 2026-09-08 (rubric)',
 NULL,
 NULL),

('A muted market re-enters production only on measured shadow or band evidence clearing juice break even on a real sample, and every re-entry is judged weekly against both its published and shadow record until the owner calls it settled.', '2026-08-10',
 'market_shadow_calibration; weekly review re-entry section',
 NULL,
 NULL),

('Every scheduled analyst files to agent_reports. No analysis that reports only to the owner''s eyes; the blackboard is the shared memory.', '2026-09-08',
 'this check; agent skills end with a filing step',
 'select ''ops-check has not filed in 36h'' as violation where not exists (select 1 from agent_reports where agent = ''ops-check'' and created_at > now() - interval ''36 hours'') union all select ''calibration-review has not filed in 8 days'' where not exists (select 1 from agent_reports where agent = ''calibration-review'' and created_at > now() - interval ''8 days'')',
 NULL),

('Release date is pushed back until a few weeks of football prove functional. The NFL go-live (2026-09-10) is a model go-live feeding the internal record, not a marketing launch. Flip moneyline and spread only; totals stay in shadow.', '2026-09-02',
 'decision record; build queue item',
 NULL,
 'Totals scope decided 2026-09-07 review, agreed 2026-09-08. Retire the flip scope clause after the flip; the release gate stands until the owner lifts it.'),

('Only the code shipping session changes code or data. Analysis agents are read only apart from their own blackboard row.', '2026-08-24',
 'agent skill definitions; git history is the audit trail',
 NULL,
 'Verified 2026-09-03: every main commit is an owner merged PR from this session.');
