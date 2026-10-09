-- 2026-10-09 (owner "go"): the review bundle and pipeline health endpoints
-- are retired. They fed two claude.ai scheduled tasks from before the
-- cloud routines existed (parlay-weekly-model-review, Mondays 08:00 Denver,
-- and a daily 6am sanity check). The bundle served mv_model_accuracy, so
-- the weekly readout the owner received disagreed with the site, which
-- reads mv_public_record only. The read only secrets go with them.
delete from app_config where key in ('report_secret', 'report_secret_2');

insert into build_queue (title, detail, priority, status)
values (
  'Delete the two claude.ai scheduled tasks that read the retired review bundle',
  'OWNER ACTION 2026-10-09. parlay-weekly-model-review (Mondays 08:00 Denver) and the daily 6am sanity check are claude.ai scheduled tasks, not Claude Code Remote routines, so the code session cannot delete them. Their endpoints (/api/review-bundle, /api/pipeline-health) and secrets were retired in PR 200 and their next runs will fail with a 404, which is the intended loud stop. The Monday calibration review (mv_public_record only) and the daily ops check replace them. Delete both in claude.ai and mark this row done.',
  'high', 'open'
);
