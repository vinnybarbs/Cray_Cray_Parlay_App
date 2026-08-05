-- Change gate for pre-analyze narration (August 2026 cost audit).
-- Stores a sha256 of every input the narration prompt is built from
-- (odds, records, news, intel, trends, player stats, computed edge, math
-- pick, trap calls). When a stale game's hash matches, pre-analyze extends
-- expires_at instead of paying for an identical re-narration. The audit
-- found games re-narrated up to 18 times with unchanged inputs (MLS
-- averaged 16.5 versions per game over Aug 1-5).

alter table public.game_analysis
  add column if not exists context_hash text;
