-- The dial search applies its own moves, bounded (owner 2026-10-11,
-- decision card "Auto, bounded"). Three pieces:
--
--   1. dial_search_moves: one row per move the weekly dial search applied,
--      with the value before and after, the evidence, and a six week
--      sunset. At the sunset the search replays the weeks since the move
--      against the old value and keeps or reverts it.
--   2. file_replay_candidates() also returns the variants that passed the
--      three tests (key passed), so the caller can apply the best one.
--      Patched in place from the live definition, nothing else changes.
--   3. Directive 8 amended to name the automatic path.

create table if not exists public.dial_search_moves (
  id bigserial primary key,
  sport text not null,
  dial text not null,
  before_value numeric,
  after_value numeric not null,
  applied_at timestamptz not null default now(),
  sunset_on date not null,
  confirm_run text,
  evidence jsonb,
  status text not null default 'applied' check (status in ('applied', 'kept', 'reverted')),
  resolved_at timestamptz,
  resolve_run text,
  resolve_evidence jsonb
);
create index if not exists dial_search_moves_open on public.dial_search_moves (status, sunset_on);
alter table public.dial_search_moves enable row level security;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.file_replay_candidates(text, jsonb)'::regprocedure) into v_def;
  if position('v_passed' in v_def) > 0 then
    return;
  end if;
  if position('  considered int := 0;' in v_def) = 0
     or position(E'    if v_passes then\n' in v_def) = 0
     or position($q$'base', jsonb_build_object('won', base.won, 'lost', base.lost, 'units', round(base.units, 1)));$q$ in v_def) = 0 then
    raise exception 'file_replay_candidates has changed shape, patch by hand';
  end if;
  v_def := replace(v_def, '  considered int := 0;', E'  considered int := 0;\n  v_passed jsonb := ''[]''::jsonb;');
  v_def := replace(v_def, E'    if v_passes then\n',
    E'    if v_passes then\n      v_passed := v_passed || jsonb_build_array(jsonb_build_object(''name'', v.formula, ''delta_units'', round(v.units - base.units, 2), ''won'', v.won, ''lost'', v.lost, ''units'', round(v.units, 2), ''fixes'', v_fixes, ''breaks'', v_breaks));\n');
  v_def := replace(v_def,
    $q$'base', jsonb_build_object('won', base.won, 'lost', base.lost, 'units', round(base.units, 1)));$q$,
    $q$'base', jsonb_build_object('won', base.won, 'lost', base.lost, 'units', round(base.units, 1)), 'passed', v_passed);$q$);
  execute v_def;
end $$;

update public.directives
   set directive = 'Dial moves require the three test counterfactual (rescues the targeted losers, improves the sport whole replayed record, holds on shadow reads) and stay damped to 25 percent per step unless a reading repeats across consecutive Mondays. Amended 2026-10-11 (owner, "Auto, bounded"): the weekly dial search applies its own moves. Per sport per week it applies at most the one best move that passed the three tests out of sample, one 25 percent step, with a model_weight_changes row (source dial-search-auto) and a dial_search_moves row carrying a six week sunset. At the sunset it replays the weeks since the move against the old value and reverts the move when the old value did at least as well. A dial with an open move is not searched again until its sunset resolves. Every other dial move still needs the owner.',
       enforcement = 'lib/replay/dial-search.js applyBestMove and resolveSunsets; cron weekly-dial-search (apply=1); performance review skill section 3e; owner approval on every move outside the dial search',
       check_sql = 'select m.sport, m.component, m.changed_at from model_weight_changes m where m.source = ''dial-search-auto'' and m.changed_at > now() - interval ''8 days'' and not exists (select 1 from dial_search_moves d where d.sport = m.sport and m.component like d.dial || ''%'' and d.applied_at between m.changed_at - interval ''1 hour'' and m.changed_at + interval ''1 hour'')',
       updated_at = now()
 where id = 8;
