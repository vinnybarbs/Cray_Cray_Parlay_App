-- Owner 2026-09-27 pipeline sweep: "make sure everything is consistent
-- with how MLB works." A sport publishes in its regular season, never in
-- preseason. NFL and NCAAF preseason went shadow on 2026-08-10 and the
-- NCAAF week 2 reads off 0-0 records were ruled noise on 2026-09-11. NHL
-- had no dial row at all, so the __all__ publish dials at 1 covered it,
-- and the 09-26 run published five NHL PRESEASON rows for 09-29 (two
-- Leans, a Play total, two spotlight rows) off 0-0 records, three days
-- out. NBA and NCAAB were next in October. Publish dials at 0 for the
-- three winter sports; the owner flips them at each regular season open.
-- The shadow ledger runs meanwhile and promote_ready_markets can flip a
-- market on its own evidence.

insert into public.sport_dials (sport, dial, value) values
  ('NHL', 'publish_ml', 0), ('NHL', 'publish_spread', 0), ('NHL', 'publish_total', 0),
  ('NBA', 'publish_ml', 0), ('NBA', 'publish_spread', 0), ('NBA', 'publish_total', 0),
  ('NCAAB', 'publish_ml', 0), ('NCAAB', 'publish_spread', 0), ('NCAAB', 'publish_total', 0)
on conflict (sport, dial) do update set value = 0, updated_at = now();

insert into public.model_weight_changes (sport, component, before, after, reason, source) values
  ('NHL', 'publish_ml, publish_spread, publish_total: preseason mute',
   jsonb_build_object('publish_ml', 1, 'publish_spread', 1, 'publish_total', 1, 'note', 'no NHL row, the __all__ default at 1 applied'),
   jsonb_build_object('publish_ml', 0, 'publish_spread', 0, 'publish_total', 0),
   'Owner sweep 2026-09-27: every sport publishes by the MLB rule, regular season only. Five NHL preseason rows published 09-26 for 09-29 off 0-0 records (ids 17779 to 17783, voided). Regular season opens 2026-10-06; the owner flips the dials or promote_ready_markets does on shadow evidence.',
   'pipeline-sweep-2026-09-27'),
  ('NBA', 'publish_ml, publish_spread, publish_total: preseason mute',
   jsonb_build_object('publish_ml', 1, 'publish_spread', 1, 'publish_total', 1, 'note', 'no NBA row, the __all__ default at 1 applied'),
   jsonb_build_object('publish_ml', 0, 'publish_spread', 0, 'publish_total', 0),
   'Owner sweep 2026-09-27: preseason is shadow in every sport. NBA preseason starts in early October; nothing published yet.',
   'pipeline-sweep-2026-09-27'),
  ('NCAAB', 'publish_ml, publish_spread, publish_total: preseason mute',
   jsonb_build_object('publish_ml', 1, 'publish_spread', 1, 'publish_total', 1, 'note', 'no NCAAB row, the __all__ default at 1 applied'),
   jsonb_build_object('publish_ml', 0, 'publish_spread', 0, 'publish_total', 0),
   'Owner sweep 2026-09-27: preseason and exhibitions are shadow in every sport. NCAAB opens in November; nothing published yet.',
   'pipeline-sweep-2026-09-27');

-- The five NHL preseason rows already on the board are voided before they
-- can be graded: a preseason read is not a pick, same as the football
-- ruling. Pending rows only, nothing settled is touched, and the
-- cron_job_logs row is the audit trail the hard rules require.
with voided as (
  update public.ai_suggestions
     set voided_at = now(),
         voided_reason = 'NHL preseason read published before the sport had publish dials (owner sweep 2026-09-27). Preseason is shadow in every sport, same as football.'
   where sport = 'NHL'
     and actual_outcome = 'pending'
     and voided_at is null
     and session_id like 'auto_digest%'
     and game_date < '2026-10-06'
  returning id, pick, tier, session_id
)
insert into public.cron_job_logs (job_name, status, details)
select 'manual-void-nhl-preseason', 'completed',
       jsonb_build_object('rows', count(*), 'ids', jsonb_agg(id order by id), 'picks', jsonb_agg(pick order by id),
                          'reason', 'NHL preseason rows voided, owner sweep 2026-09-27, publish dials now 0 for NHL, NBA, NCAAB')::text
  from voided;

insert into public.build_queue (priority, status, title, detail) values
  ('medium', 'open', 'Flip the winter sport publish dials at each regular season open (owner call)',
   'Owner sweep 2026-09-27 muted NHL, NBA and NCAAB (publish_ml, publish_spread, publish_total 0 on sport_dials) because NHL preseason was publishing off 0-0 records. Regular seasons: NHL 2026-10-06, NBA late October, NCAAB early November. Flip each sport to 1 the morning its regular season opens, or let promote_ready_markets flip a market on shadow evidence. Preseason reads stay shadow and graded into the shadow ledger.'),
  ('medium', 'done', 'Published pick headlines the card and the Research modal (owner sweep 2026-09-27)',
   '/api/deep-research now attaches published_pick like /api/digest does, the card prints the published pick text (not the live recommended side) with its tier and price, and both surfaces add a "Live read now" line when the live read no longer agrees. Before this an NFL Lean published three days out showed Lean on the tile and Skip in the modal. Ledger and grading untouched.');
