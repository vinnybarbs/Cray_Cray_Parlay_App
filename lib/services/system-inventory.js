/**
 * System inventory: the server's half of the downstream sync (directive 29).
 *
 * The database records its own kinds (cron jobs, tables, functions,
 * dials) in system_inventory. Only the server knows the deployed repo
 * tree and the routes it serves, so at every start it sends both lists
 * through record_code_inventory and then runs refresh_system_inventory,
 * which diffs everything against the briefs, skills and directives and
 * keeps downstream_drift_log current. A path a directive names that is
 * no longer in the tree, or a skills row whose file is gone, shows up
 * there the same morning. Fail-soft: a failure logs and never blocks
 * the server.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../../shared/logger');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-ssr', 'coverage', '.vercel', 'build']);
const FILE_EXT = /\.(js|jsx|ts|tsx|sql|md|json)$/;

/** Every source and doc file under the repo root, as repo relative paths. */
function listRepoFiles(root = REPO_ROOT) {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      } else if (e.isFile() && FILE_EXT.test(e.name)) {
        out.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
  };
  walk(root, '');
  return out.sort();
}

/** "METHOD /path" for every route the app registered (Express 4 and 5). */
function listRoutes(app) {
  const router = app && (app.router || app._router);
  const stack = (router && router.stack) || [];
  const out = new Set();
  for (const layer of stack) {
    const route = layer && layer.route;
    if (!route || typeof route.path !== 'string') continue;
    const methods = Object.keys(route.methods || {}).filter(m => route.methods[m] && m !== '_all');
    for (const m of methods.length ? methods : ['all']) out.add(`${m.toUpperCase()} ${route.path}`);
  }
  return [...out].sort();
}

async function recordCodeInventory(supabase, { app = null, root = REPO_ROOT } = {}) {
  const result = { files: null, routes: null, refresh: null, error: null };
  try {
    const files = listRepoFiles(root);
    const routes = listRoutes(app);
    if (files.length) {
      const { data, error } = await supabase.rpc('record_code_inventory', { p_kind: 'file', p_names: files });
      if (error) throw error;
      result.files = data;
    }
    if (routes.length) {
      const { data, error } = await supabase.rpc('record_code_inventory', { p_kind: 'route', p_names: routes });
      if (error) throw error;
      result.routes = data;
    }
    const { data, error } = await supabase.rpc('refresh_system_inventory');
    if (error) throw error;
    result.refresh = data;
    logger.info('System inventory recorded', { files: files.length, routes: routes.length });
  } catch (err) {
    result.error = err.message;
    logger.error('System inventory failed', { error: err.message });
  }
  return result;
}

module.exports = { listRepoFiles, listRoutes, recordCodeInventory, REPO_ROOT };
