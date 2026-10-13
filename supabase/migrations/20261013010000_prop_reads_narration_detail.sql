-- The longer write-up behind "Read more" on a prop card (owner
-- 2026-10-13: "the analysis needs more than why we like it with a few
-- lines"). Written in the same call as the short narration, so it moves
-- with it whenever the side or line changes.
alter table public.prop_reads add column if not exists narration_detail text;
