-- The dedupe unique index counted VOIDED rows, so a voided pick held its
-- (matchup, market, pick, day) slot forever and blocked the same tuple
-- from ever publishing live again. That broke the alt-eviction path on
-- 2026-08-31: when the headline pick moves onto a market an alt
-- spotlight row occupies, the pipeline voids the redundant alt and
-- retries the headline write, which only works if voiding actually
-- frees the slot. Voided rows are excluded from every product surface
-- and every record, so they have no business enforcing uniqueness.
DROP INDEX IF EXISTS idx_ai_suggestions_dedupe;
CREATE UNIQUE INDEX idx_ai_suggestions_dedupe
  ON public.ai_suggestions
  USING btree (home_team, away_team, bet_type, pick,
    COALESCE((point)::text, 'null'::text), immutable_date(game_date))
  WHERE voided_at IS NULL;
