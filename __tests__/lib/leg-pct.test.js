// Owner 2026-10-13: a Sundell -550 Leg tile showed "We say 19%, Book 19%",
// the underdog's numbers. The Leg chip prices the favorite.
const path = require('path');
const fs = require('fs');

function loadTiers() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'tiers.js'), 'utf8')
    .replace(/^export /gm, '');
  const m = { exports: {} };
  new Function('module', src + '\nmodule.exports = { legPct };')(m);
  return m.exports;
}

const { legPct } = loadTiers();

describe('legPct', () => {
  it('prices the high probability side, not the recommended one', () => {
    const game = { calc_home_prob: 0.19, calc_away_prob: 0.81, moneyline_home: 390, moneyline_away: -550, recommended_side: 'home_ml' };
    expect(legPct(game)).toEqual({ book: 81, ours: 81 });
  });

  it('is null without a probability or a price', () => {
    expect(legPct({ calc_home_prob: null, calc_away_prob: null })).toBeNull();
    expect(legPct({ calc_home_prob: 0.7, calc_away_prob: 0.3 })).toBeNull();
  });
});
