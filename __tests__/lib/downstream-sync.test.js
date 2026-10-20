// Directive 29 (owner 2026-10-20): the briefs, skills and directives
// follow downstream changes every day. The database half lives in
// supabase/migrations/20261020040000_downstream_sync.sql. These pin the
// repo half: every path a doc names exists, the deploy sync prunes a
// deleted brief's row and never wipes the table, the server's inventory
// lists files and routes, and a directive change formats for Discord
// with its undo call.

const fs = require('fs');
const path = require('path');
const { readSkills, orphanRows } = require('../../lib/services/skill-sync');
const { listRepoFiles, listRoutes, REPO_ROOT } = require('../../lib/services/system-inventory');
const { formatDirectiveChange } = require('../../api/cron/discord-directive-changes');

const PATH_RE = /((?:lib|api|src|__tests__|supabase|agents|scripts|shared|\.claude)\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:js|jsx|ts|tsx|sql|md))/g;
const MIGRATION = path.join(REPO_ROOT, 'supabase', 'migrations', '20261020040000_downstream_sync.sql');

describe('every repo path a brief, skill or AGENTS.md names exists', () => {
  const docs = readSkills();
  test.each(docs.map(d => [d.name, d.content]))('%s', (name, content) => {
    const dead = [...content.matchAll(PATH_RE)].map(m => m[1])
      .filter(p => !fs.existsSync(path.join(REPO_ROOT, p)));
    expect(dead).toEqual([]);
  });

  test('the SQL dead_path finding uses the same path pattern', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain(`'${PATH_RE.source.replace(/\\\//g, '/')}'`);
  });
});

describe('orphanRows', () => {
  test('a row whose file is gone is pruned', () => {
    const current = ['AGENTS.md', 'agents/README.md', 'agents/exec-assistant.md', 'traphawk-ship', 'traphawk-ops-check'];
    expect(orphanRows([...current, 'agents/daily-build.md'], current)).toEqual(['agents/daily-build.md']);
  });

  test('a thin or empty read never wipes the table', () => {
    expect(orphanRows(['a', 'b', 'c'], [])).toEqual([]);
    expect(orphanRows(['a', 'b', 'c'], ['a'])).toEqual([]);
    expect(orphanRows(['a'], null)).toEqual([]);
  });

  test('the live repo read is big enough to prune', () => {
    expect(readSkills().length).toBeGreaterThanOrEqual(5);
  });
});

describe('system inventory', () => {
  test('lists the repo files the docs point at, never node_modules', () => {
    const files = listRepoFiles();
    expect(files).toContain('agents/downstream-sync.md');
    expect(files).toContain('.claude/skills/traphawk-ship/SKILL.md');
    expect(files).toContain('AGENTS.md');
    expect(files).toContain('server.js');
    expect(files.some(f => f.startsWith('node_modules/') || f.includes('/node_modules/'))).toBe(false);
  });

  test('lists routes as METHOD path from an Express style stack', () => {
    const app = { router: { stack: [
      { route: { path: '/cron/sync-skills', methods: { post: true } } },
      { route: { path: '/api/digest', methods: { get: true } } },
      { name: 'jsonParser' },
    ] } };
    expect(listRoutes(app)).toEqual(['GET /api/digest', 'POST /cron/sync-skills']);
    expect(listRoutes(null)).toEqual([]);
  });

  test('server.js registers the directive change poster and records the inventory', () => {
    const server = fs.readFileSync(path.join(REPO_ROOT, 'server.js'), 'utf8');
    expect(server).toContain("app.post('/cron/discord-directive-changes'");
    expect(server).toContain('recordCodeInventory(supabase, { app })');
  });
});

describe('the downstream sync brief', () => {
  const brief = fs.readFileSync(path.join(REPO_ROOT, 'agents', 'downstream-sync.md'), 'utf8');
  const exec = fs.readFileSync(path.join(REPO_ROOT, 'agents', 'exec-assistant.md'), 'utf8');

  test('the exec assistant runs it every morning', () => {
    expect(exec).toContain('agents/downstream-sync.md');
    expect(exec).toContain('directive 29');
  });

  test('it edits directives only through the guarded function and never loosens one', () => {
    expect(brief).toContain('downstream_update_directive');
    expect(brief).toContain('revert_directive_change');
    expect(brief).toMatch(/never do: loosen a rule, expire or revive a directive, or add one/);
  });
});

describe('formatDirectiveChange', () => {
  test('an update shows before, after, why and the undo call', () => {
    const e = formatDirectiveChange({
      id: 41, directive_id: 6, op: 'update', source: 'downstream-sync',
      reason: 'PR 280 renamed the guard trigger.',
      changed_fields: ['enforcement'],
      before: { enforcement: 'old guard' }, after: { enforcement: 'new guard' },
    });
    expect(e.title).toBe('📜 Directive 6 updated by the downstream sync');
    expect(e.description).toBe('PR 280 renamed the guard trigger.');
    expect(e.fields).toEqual([
      { name: 'Enforcement before', value: 'old guard' },
      { name: 'Enforcement now', value: 'new guard' },
    ]);
    expect(e.footer.text).toBe('Undo with select revert_directive_change(41)');
    expect(JSON.stringify(e)).not.toMatch(/https?:\/\//);
  });

  test('an insert shows the rule and a long change stays under the Discord cap', () => {
    const long = 'x'.repeat(5000);
    const ins = formatDirectiveChange({ id: 1, directive_id: 29, op: 'insert', source: 'migration 20261020040000_downstream_sync', changed_fields: ['directive'], after: { directive: 'Nothing downstream drifts.' } });
    expect(ins.title).toBe('📜 Directive 29 added by a migration');
    expect(ins.fields[0]).toEqual({ name: 'Rule', value: 'Nothing downstream drifts.' });
    const big = formatDirectiveChange({ id: 2, directive_id: 8, op: 'update', source: 'manual', reason: long,
      changed_fields: ['directive', 'enforcement', 'check_sql', 'notes'],
      before: { directive: long, enforcement: long, check_sql: long, notes: long },
      after: { directive: long, enforcement: long, check_sql: long, notes: long } });
    const chars = big.title.length + big.description.length + big.footer.text.length
      + big.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    expect(chars).toBeLessThan(6000);
    expect(big.fields[big.fields.length - 1]).toEqual({ name: 'Also changed', value: 'Notes' });
  });
});
