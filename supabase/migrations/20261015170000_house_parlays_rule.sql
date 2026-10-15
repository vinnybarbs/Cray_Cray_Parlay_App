-- House parlays keep one record per composition rule (owner 2026-10-15:
-- the gimme plus value slips keep their own record, apart from the old
-- heavy only slips and apart from straight picks). Every row built
-- before the new builder deployed is heavy_only, the builder writes
-- gimme_plus_value from 2026-10-15 on.
alter table public.house_parlays add column if not exists rule text not null default 'heavy_only';
alter table public.house_parlays alter column rule set default 'gimme_plus_value';
create index if not exists house_parlays_rule_status_idx on public.house_parlays (rule, status);
