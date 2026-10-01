-- Owner decisions 2026-10-01 on the seven items at the end of the
-- second report (TrapHawk Lookback Engine and Business Plan). Applied to
-- production as owner_decisions_2026_10_01 before this file was written.

insert into public.directives (directive, decided_on, status, enforcement, check_sql, notes) values
  ('No sportsbook affiliation, ever. TrapHawk never places a sportsbook affiliate link, code, CPA or revenue share deal, in any state, on any surface (site, Discord, email, docs). Independence from the books is the product. Tool and data affiliates are a separate question and need an owner call each time.',
   '2026-10-01', 'active',
   'Code review on every PR touching Landing, Digest, Ledger, Discord posters or email. The ops check greps the live landing for sportsbook affiliate parameters.',
   $chk$select 'affiliate language in build_queue or directives', id::text from build_queue where status not in ('done','dismissed') and (title ilike '%affiliate%' or detail ilike '%sportsbook affiliate%') and detail not ilike '%no sportsbook affiliation%'$chk$,
   'Owner 2026-10-01: "No Affiliation ever, that''s our thing." Replaces the 90 day deferral in the second report.');

update public.build_queue set status = 'open', title = 'APPROVED 2026-10-01: ' || title,
  detail = detail || ' OWNER 2026-10-01: YES. Build now, log only.' where id = 68;
update public.build_queue set status = 'open', title = 'APPROVED 2026-10-01: ' || title,
  detail = detail || ' OWNER 2026-10-01: YES. Also approved: the Sunday sweep tests pitcher_anchor_damp toward 1.0 and chalk_penalty_pp 1.5 for MLB:ml.' where id = 69;
update public.build_queue set status = 'deferred',
  detail = detail || ' OWNER 2026-10-01: NOT UNTIL WE PROVE SUCCESS FOR ONE MONTH. Revisit 2026-11-01 on the ledger (per tier at break even plus five, positive CLV). Keep the landing pricing copy honest meanwhile.' where id = 71;
update public.build_queue set status = 'open', title = 'APPROVED 2026-10-01: ' || title where id = 67;
update public.build_queue set detail = detail || ' OWNER 2026-10-01: The Odds API Business tier WAITS. CLV stays against the US consensus close for now.' where id = 65;

insert into public.build_queue (priority, status, title, detail) values
  ('high', 'open', 'APPROVED 2026-10-01: Sunday sweep variants for MLB moneylines: pitcher_anchor_damp 0.75 and 1.0, chalk_penalty_pp 1.5 (MLB:ml only)',
   'Owner 2026-10-01 YES. Evidence: favorites with a pick side starter ERA gap over 1.0 went 62-25 (+13.9u) since 08-01, and heavy favorites with 5pp plus claims went 41-15 (+5.7u), so the chalk rail deducts from the right picks for the wrong reason. The sweep scores each variant on the three tests and the bucket fidelity before any dial moves.'),
  ('high', 'open', 'APPROVED 2026-10-01: injury scout from Opus to Sonnet',
   'Owner 2026-10-01: Sonnet. The scout is prose only today and about a third of LLM spend (about $85 of $259 a month including search).'),
  ('medium', 'deferred', 'Stripe and the paid tier: revisit 2026-11-01 after one month of proven success',
   'Owner 2026-10-01: "NOT UNTIL WE PROVE SUCCESS FOR 1 Month from today." Proof is the ledger: each live tier at its break even plus five, positive CLV, the four MLB shadow gates with 100 picks each and a positive out of sample line. Until then the ledger, the trace and the receipts stay free and the landing pricing copy must not promise a tier that cannot be bought.');

-- UFC out of the leg pool (decision 3): leg_prob_floor 1.01 for UFC, with
-- model_weight_changes row 38 (source owner-approved-2026-10-01), was
-- written the same day.
