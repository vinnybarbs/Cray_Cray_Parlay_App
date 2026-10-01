// Owner 2026-10-01: run line traps and juicy dog traps to shadow where the
// dial board says so. The split is pure and the default is open.

const { splitShadowTraps } = require('../../lib/services/trap-detector');

const traps = [
  { side: 'home_ml', edge_pp: -3.1, lure_score: 48, signals: [{ key: 'chalk', pts: 30 }, { key: 'home', pts: 8 }, { key: 'streak', pts: 10 }] },
  { side: 'away_spread', edge_pp: -2.4, lure_score: 35, signals: [{ key: 'form', pts: 20 }, { key: 'streak', pts: 15 }] },
  { side: 'away_ml', edge_pp: -2.2, lure_score: 33, signals: [{ key: 'juicy_dog', pts: 15 }, { key: 'form', pts: 18 }] },
];

test('both dials at 0 send run line and juicy dog traps to shadow with a reason, the chalk trap stays live', () => {
  const { live, shadow } = splitShadowTraps(traps, { spread: 0, juicy_dog: 0 });
  expect(live.map(t => t.side)).toEqual(['home_ml']);
  expect(shadow.map(t => [t.side, t.shadow_reason])).toEqual([
    ['away_spread', 'trap_publish_spread 0'],
    ['away_ml', 'trap_publish_juicy_dog 0'],
  ]);
  expect(shadow.every(t => t.shadow === true)).toBe(true);
  expect(traps[1].shadow).toBeUndefined();
});

test('missing or open dials publish everything, each dial works alone, empty input is harmless', () => {
  expect(splitShadowTraps(traps, {}).live).toHaveLength(3);
  expect(splitShadowTraps(traps, { spread: 1, juicy_dog: 1 }).shadow).toHaveLength(0);
  expect(splitShadowTraps(traps, { spread: 0 }).shadow.map(t => t.side)).toEqual(['away_spread']);
  expect(splitShadowTraps(traps, { juicy_dog: 0 }).shadow.map(t => t.side)).toEqual(['away_ml']);
  expect(splitShadowTraps(undefined, { spread: 0 })).toEqual({ live: [], shadow: [] });
});
