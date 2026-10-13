-- Short narration for each shown prop read (owner 2026-10-12: the prop
-- card's explanation expands into a few sentences in the same voice as
-- the game research). Written by api/cron/narrate-nfl-props.js after
-- each read run. narration_side and narration_line record what the text
-- argued for, so a read that flips side or moves its line is narrated
-- again and stale text is never shown against a new line.
alter table public.prop_reads
  add column if not exists narration text,
  add column if not exists narration_side text,
  add column if not exists narration_line numeric,
  add column if not exists narration_model text,
  add column if not exists narrated_at timestamptz;
