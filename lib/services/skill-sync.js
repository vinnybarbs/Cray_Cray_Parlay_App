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

function readSkills(dir = SKILLS_DIR) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    out.push({
      name: entry.name,
      content,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      bytes: Buffer.byteLength(content, 'utf8'),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function syncSkills({ source = 'server-start' } = {}) {
  const skills = readSkills();
  if (skills.length === 0) {
    logger.warn('Skill sync found no skills to sync', { dir: SKILLS_DIR });
    return { synced: 0, names: [], error: 'no skills found' };
  }
  const now = new Date().toISOString();
  const rows = skills.map(s => ({ ...s, synced_at: now, synced_from: source }));
  try {
    const { error } = await supabase.from('skills').upsert(rows, { onConflict: 'name' });
    if (error) throw error;
    logger.info('Skills synced to Supabase', { count: rows.length, source });
    return { synced: rows.length, names: rows.map(r => r.name), error: null };
  } catch (err) {
    logger.error('Skill sync failed', { error: err.message, source });
    return { synced: 0, names: [], error: err.message };
  }
}

module.exports = { readSkills, syncSkills, SKILLS_DIR };
