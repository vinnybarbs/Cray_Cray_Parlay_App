// Nothing changes in a vacuum (directive 22): the mirrors that can be
// checked at test time. A server constant and its client or SQL mirror
// must agree, and every dial default must be named in a skill, or the
// build fails before the drift reaches production.

const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function loadTiers() {
  const src = read('src/lib/tiers.js').replace(/^export /gm, '');
  const m = { exports: {} };
  new Function('module', src + '\nmodule.exports = { SHADOW_SPORTS, edgeTier, CHALK_ODDS_FENCE, LONGSHOT_ODDS_FLOOR, DEFAULT_CHALK_PENALTY_PP, DEFAULT_LONGSHOT_PENALTY_PP };')(m);
  return m.exports;
}

const ui = loadTiers();
const publish = require('../../lib/services/publish-markets.js');
const penalties = require('../../lib/services/price-penalties.js');
const grader = require('../../lib/services/pick-grader.js');
const tile = require('../../lib/services/tile-records.js');
const { DIAL_DEFAULTS } = require('../../lib/services/edge-calculator.js');
const propEdge = require('../../lib/services/prop-edge.js');

describe('drift: server constants and their client mirrors agree', () => {
  test('the shadow sport fallback list is the same on the server and the board', () => {
    expect([...publish.CODE_SHADOW_SPORTS].sort()).toEqual([...ui.SHADOW_SPORTS].sort());
  });

  test('the price rail fences and defaults match', () => {
    expect(ui.CHALK_ODDS_FENCE).toBe(penalties.CHALK_ODDS_FENCE);
    expect(ui.LONGSHOT_ODDS_FLOOR).toBe(penalties.LONGSHOT_ODDS_FLOOR);
    expect(ui.DEFAULT_CHALK_PENALTY_PP).toBe(penalties.DEFAULT_CHALK_PENALTY_PP);
    expect(ui.DEFAULT_LONGSHOT_PENALTY_PP).toBe(penalties.DEFAULT_LONGSHOT_PENALTY_PP);
  });

  test('the tier ladder labels agree across every band edge', () => {
    for (const pp of [-5, -2, -1.9, 0, 1.9, 2, 3.9, 4, 6.9, 7, 9.9, 10, 25]) {
      expect(ui.edgeTier(pp).label).toBe(grader.edgeTier(pp));
    }
  });
});

describe('drift: the SQL mirror of the season floors matches tile-records.js', () => {
  test('season_record_floor month and day per sport equal SEASON_FLOOR_MONTH_DAY', () => {
    const sql = read('supabase/migrations/20260912170000_model_sanity_tripwires.sql');
    const pairs = {};
    for (const m of sql.matchAll(/when '([A-Z]+)' then array\[(\d+), (\d+)\]/g)) pairs[m[1]] = [Number(m[2]), Number(m[3])];
    const js = {};
    for (const sport of Object.keys(pairs)) {
      const floor = tile.seasonRecordFloor(sport, new Date(2026, 11, 31));
      js[sport] = [Number(floor.slice(5, 7)), Number(floor.slice(8, 10))];
    }
    expect(Object.keys(pairs).length).toBeGreaterThanOrEqual(8);
    expect(js).toEqual(pairs);
  });
});

describe('drift: every dial default is named in a skill', () => {
  const skills = fs.readdirSync(path.join(root, '.claude', 'skills'))
    .map(d => path.join(root, '.claude', 'skills', d, 'SKILL.md'))
    .filter(fs.existsSync)
    .map(p => fs.readFileSync(p, 'utf8'))
    .join('\n');
  const dials = [
    ...Object.keys(DIAL_DEFAULTS),
    ...Object.keys(propEdge.DIAL_DEFAULTS || {}),
    'chalk_penalty_pp', 'longshot_penalty_pp', 'exposure_guard_pp',
    ...publish.MARKETS.map(m => `publish_${m}`),
  ];
  test.each([...new Set(dials)])('%s is documented', (dial) => {
    expect(skills.includes(dial)).toBe(true);
  });
});
