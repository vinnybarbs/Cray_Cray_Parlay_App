-- Write-once settlement. Once a pick is graded (actual_outcome leaves
-- 'pending'), its outcome and resolved_at are immutable. The August 9
-- incident happened because a repair job could rewrite settled rows;
-- this makes that impossible without an explicit, per-transaction
-- override:  SET LOCAL app.allow_regrade = 'on';
-- The override is deliberate friction: it cannot be left on globally,
-- it dies with the transaction, and using it is the audit trail.
create or replace function public.enforce_settlement_write_once()
returns trigger
language plpgsql
as $fn$
begin
  if old.actual_outcome is distinct from 'pending'
     and (new.actual_outcome is distinct from old.actual_outcome
          or new.resolved_at is distinct from old.resolved_at)
     and coalesce(current_setting('app.allow_regrade', true), '') <> 'on'
  then
    raise exception 'ai_suggestions row % is settled (%): settlement is write-once. For an approved correction run SET LOCAL app.allow_regrade = ''on'' inside the same transaction.',
      old.id, old.actual_outcome;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_settlement_write_once on public.ai_suggestions;
create trigger trg_settlement_write_once
  before update on public.ai_suggestions
  for each row execute function public.enforce_settlement_write_once();
