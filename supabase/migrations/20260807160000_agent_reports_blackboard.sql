-- Shared blackboard for the digital workers (2026-08-07).
--
-- Scheduled Routines, Cowork chats, and build sessions each start fresh
-- and reported only to Vince, who was the de facto coordinator: the Aug 6
-- calibration review found the MLB spread bug and the finding only
-- traveled because he pasted the file into another session. This table is
-- the same blackboard pattern the production pipeline already uses
-- (cron_job_logs, agent_intel), extended to the agent layer. Every worker
-- files a report at the end of a run and reads recent reports before
-- starting. The daily ops check aggregates the last 24 hours into its
-- brief, and the admin dashboard renders the feed.

create table if not exists public.agent_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  agent text not null,          -- ops-check | calibration-review | cost-audit | build-session | other
  summary text not null,        -- two or three plain sentences, the part other workers read
  findings jsonb                -- optional structured detail
);

create index if not exists idx_agent_reports_created
  on public.agent_reports (created_at desc);

alter table public.agent_reports enable row level security;

drop policy if exists agent_reports_service on public.agent_reports;
create policy agent_reports_service on public.agent_reports
  for all to service_role using (true) with check (true);
