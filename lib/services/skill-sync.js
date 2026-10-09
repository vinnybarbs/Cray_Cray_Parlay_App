/**
 * Skill sync: the repo comes to the routines through Supabase.
 *
 * The cloud routines cannot attach a repository, but every one of them
 * has the Supabase connector, so each .claude/skills/<name>/SKILL.md is
 * upserted into the `skills` table at every server start (Railway
 * deploys main on every merge, so the deploy is the sync) and on
 * demand through /cron/sync-skills. Routines read their skill from the
 * table. The repo stays the only place a skill is edited; the table is
 * a mechanically derived copy with a content hash so drift is visible.
 * Fail-soft: a sync failure logs and never blocks the server.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { supabase } = require('../middleware/supabaseAuth.js');
const { logger } = require('../../shared/logger');

const SKILLS_DIR = path.join(__dirname, '..', '..', '.claude', 'skills');
// AGENTS.md is the top line every session and routine reads first
// (owner 2026-09-28): goals, the four state tables, the skills index,
// the never list. It syncs as its own row so a routine loads it by name
// before its skill, exactly like the skills, and is edited only in the
// repo (directive 15).
const AGENTS_FILE = path.join(__dirname, '..', '..', 'AGENTS.md');
const AGENTS_ROW = 'AGENTS.md';
// The routine briefs (owner 2026-10-09, the Aloe arrangement): one file
// per cloud routine under agents/, holding the complete brief. Each
// routine's prompt is one line that loads its brief from the skills
// table as row agents/<file>, so the repo is the only place a brief is
// edited and a merge is live at the next firing. The README is the
// arrangement itself and syncs too.
const BRIEFS_DIR = path.join(__dirname, '..', '..', 'agents');
const BRIEF_PREFIX = 'agents/';

function row(name, content) {
  return {
    name,
    content,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    bytes: Buffer.byteLength(content, 'utf8'),
  };
}

function readSkills(dir = SKILLS_DIR, agentsFile = AGENTS_FILE, briefsDir = BRIEFS_DIR) {
  const out = [];
  if (agentsFile && fs.existsSync(agentsFile)) {
    out.push(row(AGENTS_ROW, fs.readFileSync(agentsFile, 'utf8')));
  }
  const rest = [];
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      rest.push(row(entry.name, fs.readFileSync(file, 'utf8')));
    }
  }
  if (briefsDir && fs.existsSync(briefsDir)) {
    for (const entry of fs.readdirSync(briefsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      rest.push(row(BRIEF_PREFIX + entry.name, fs.readFileSync(path.join(briefsDir, entry.name), 'utf8')));
    }
  }
  rest.sort((a, b) => a.name.localeCompare(b.name));
  return out.concat(rest);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function syncSkills({ source = 'server-start', retries = 0 } = {}) {
  const skills = readSkills();
  if (skills.length === 0) {
    logger.warn('Skill sync found no skills to sync', { dir: SKILLS_DIR });
    return { synced: 0, names: [], error: 'no skills found' };
  }
  const now = new Date().toISOString();
  const rows = skills.map(s => ({ ...s, synced_at: now, synced_from: source }));
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { error } = await supabase.from('skills').upsert(rows, { onConflict: 'name' });
      if (error) throw error;
      logger.info('Skills synced to Supabase', { count: rows.length, source, attempt });
      return { synced: rows.length, names: rows.map(r => r.name), error: null };
    } catch (err) {
      lastError = err;
      logger.error('Skill sync failed', { error: err.message, source, attempt });
      if (attempt < retries) await sleep(2000 * (attempt + 1));
    }
  }
  return { synced: 0, names: [], error: lastError ? lastError.message : 'unknown' };
}

/**
 * The deploy witness: one cron_job_logs row per server start carrying
 * the Railway commit sha, so which build is serving is readable from
 * the database alone. Retries like the sync, fail-soft like the sync.
 */
async function recordServerStart() {
  const details = {
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    branch: process.env.RAILWAY_GIT_BRANCH || null,
    deployment: process.env.RAILWAY_DEPLOYMENT_ID || null,
    node_env: process.env.NODE_ENV || 'development',
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { error } = await supabase.from('cron_job_logs').insert({
        job_name: 'server-start', status: 'completed', details: JSON.stringify(details),
      });
      if (error) throw error;
      return details;
    } catch (err) {
      logger.error('Server start witness failed', { error: err.message, attempt });
      await sleep(2000 * (attempt + 1));
    }
  }
  return details;
}

module.exports = { readSkills, syncSkills, recordServerStart, SKILLS_DIR, BRIEFS_DIR, BRIEF_PREFIX };
