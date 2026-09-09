-- Skills in the database (owner principle 2026-09-09: everything looks
-- at the repo or Supabase and runs only the updated skills). The cloud
-- routines cannot attach a repository, but they all have Supabase, so
-- the repo comes to them: every Railway deploy of main (and the
-- /cron/sync-skills endpoint) upserts each .claude/skills/*/SKILL.md
-- into this table, and the routines read their skill from here. The
-- deploy is the sync. .claude/skills stays the only place a skill is
-- edited; this table is a mechanically derived copy with a content
-- hash so drift is detectable, never a place to write by hand.
CREATE TABLE IF NOT EXISTS skills (
  name text PRIMARY KEY,
  content text NOT NULL,
  sha256 text NOT NULL,
  bytes integer NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  synced_from text
);
COMMENT ON TABLE skills IS
  'Derived copy of .claude/skills/*/SKILL.md, upserted at every server start and by /cron/sync-skills. Read by the cloud routines. Never edited by hand; the repo is the source.';

INSERT INTO directives (directive, decided_on, enforcement, check_sql, notes) VALUES
('Skills are edited only in the repo under .claude/skills. Every deploy syncs them into the skills table, and the cloud routines read their skill from that table, never from an account copy. Nothing about a skill is ever typed into the desktop app or the routines UI.', '2026-09-09',
 'lib/services/skill-sync.js at server start and /cron/sync-skills; routine prompts read from the skills table; this check',
 'select name, synced_at from skills where synced_at < now() - interval ''14 days'' union all select ''missing: '' || s as name, null from unnest(array[''traphawk-ops-check'',''traphawk-performance-review'',''traphawk-cost-audit'',''traphawk-data-model'',''traphawk-ship'',''traphawk-status-board'']) s where s not in (select name from skills)',
 'A synced_at older than 14 days means no deploy has run, which is itself worth a look. The desktop project reads the same files from its folder.');
