-- Ops check 2026-09-11 findings two and three on directive 16. The
-- check_sql reached two days behind the PR 144 deploy and returned two
-- correct-for-their-era rows, and it required edge_pp_raw >= 2 so a
-- sub-gate raw read lifted over the publish floor by a multiplier above
-- one was invisible to it. Anchor the window at the deploy instant, and
-- read every published bet-tier row at a railed price for its marker:
-- since PR 149 the marker lands even when the claim already sits at the
-- Lean floor and nothing comes off.
UPDATE directives SET updated_at = now(),
  check_sql = 'select id, sport, tier, odds, edge_pp, edge_pp_raw from ai_suggestions where voided_at is null and session_id like ''auto_digest%'' and created_at > ''2026-09-11 09:30:00-06'' and odds ~ ''^[+-]?[0-9]+$'' and tier in (''Sharp Take'',''Strong Play'',''Play'',''Lean'') and ((odds::numeric <= -150 and reasoning not like ''%Chalk price:%'') or (odds::numeric >= 300 and reasoning not like ''%Longshot price:%''))'
WHERE id = 16;

UPDATE build_queue SET updated_at = now(), status = 'open', priority = 'high',
  detail = detail || ' 2026-09-11 ops check (sixteenth report) named a SECOND churning input with the PR 138 tally: pitchers moves on the overnight runs (6 of 9 at 03:46, 6 of 6 at 00:46) alongside odds in every run. Quantizing odds gets part of the way; the shipping session also inspects what in the probable pitcher fingerprint moves overnight on an unchanged matchup. Odds quantization values still await the owner ruling.'
WHERE id = 17;

INSERT INTO build_queue (title, detail, priority, status) VALUES
  ('NCAAB standings upsert rejects 10 of 365 rows on every run', 'sync-standings reads found 365 upserted 355 consistently (ops check 09-09 through 09-11). Zero impact out of season; one look before the November tip off. Every other sport upserts whole.', 'low', 'open'),
  ('capture_closing_lines fires 1 in 6 to 10 of its 15 minute slots with no log row', 'Ops check 09-11: 9 distinct capture minutes across 09-10 and 18 on 09-09 against 96 slots, and the job writes no cron_job_logs row, so silence cannot be told from a dead job (the run_settlement principle). Log every fire, then read the fire rate.', 'medium', 'open');
