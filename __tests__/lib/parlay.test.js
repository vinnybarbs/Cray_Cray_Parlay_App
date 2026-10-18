const { decimalOdds, americanOdds, legFromGame, parlayMath, fmtChance } = require('../../src/lib/parlay');
const { parlayItems, parlayLegKey, groupTracked, parlayStatus, splitUnits, gameItem } = require('../../src/lib/trackedKeys');

const NOW = Date.parse('2026-10-18T18:00:00Z');
const hoursFromNow = (h) => new Date(NOW + h * 3600e3).toISOString();

const game = (over = {}) => ({
  game_key: 'nfl_bears_lions',
  sport: 'NFL',
  home_team: 'Lions',
  away_team: 'Bears',
  game_date: hoursFromNow(3),
  recommended_side: 'away_spread',
  spread_away_price: -110,
  spread_home_price: -110,
  published_pick: { pick: 'Bears +6.5', bet_type: 'spread', odds: -110, edge_pp: 5, tier: 'Play', outcome: 'pending' },
  ...over,
});

describe('parlay odds math', () => {
  it('converts American and decimal both ways', () => {
    expect(decimalOdds(-110)).toBeCloseTo(1.9091, 4);
    expect(decimalOdds(150)).toBe(2.5);
    expect(decimalOdds(0)).toBeNull();
    expect(decimalOdds('abc')).toBeNull();
    expect(americanOdds(2.5)).toBe(150);
    expect(americanOdds(1.5)).toBe(-200);
  });

  it('two -110 legs pay +264 and break even at 27.4%', () => {
    const legs = [legFromGame(game()), legFromGame(game({ game_key: 'nfl_b' }))];
    const m = parlayMath(legs, 10);
    expect(m.legs).toBe(2);
    expect(m.odds).toBe(264);
    expect(m.payout).toBeCloseTo(36.45, 2);
    expect(m.profit).toBeCloseTo(26.45, 2);
    expect(m.breakEvenPct).toBeCloseTo(27.44, 1);
    // No-vig 50% each for the book, 55% each for us.
    expect(m.bookPct).toBeCloseTo(25, 5);
    expect(m.ourPct).toBeCloseTo(30.25, 5);
  });

  it('leaves the chances blank when a leg has none', () => {
    const m = parlayMath([legFromGame(game()), { odds: 120, book: null, ours: null }], 10);
    expect(m.odds).not.toBeNull();
    expect(m.bookPct).toBeNull();
    expect(m.ourPct).toBeNull();
  });

  it('a bad stake pays nothing instead of NaN', () => {
    expect(parlayMath([legFromGame(game())], '').payout).toBe(0);
  });

  it('formats long shots with a decimal', () => {
    expect(fmtChance(4.27)).toBe('4.3%');
    expect(fmtChance(27.44)).toBe('27%');
    expect(fmtChance(0.01)).toBe('0.1%');
    expect(fmtChance(null)).toBeNull();
  });
});

describe('legFromGame', () => {
  it('takes only a published, priced, not started, ungraded pick', () => {
    expect(legFromGame(game())).toMatchObject({ id: 'nfl_bears_lions', pick: 'Bears +6.5', odds: -110 });
    expect(legFromGame(game({ published_pick: null }))).toBeNull();
    expect(legFromGame(game({ in_progress: true }))).toBeNull();
    expect(legFromGame(game({ locked: true }))).toBeNull();
    expect(legFromGame(game({ published_pick: { pick: 'x', odds: null } }))).toBeNull();
    expect(legFromGame(game({ published_pick: { pick: 'x', odds: -110, outcome: 'won' } }))).toBeNull();
  });
});

describe('parlays on the Tracked tab', () => {
  const g1 = game();
  const g2 = game({ game_key: 'nfl_b', home_team: 'Packers', away_team: 'Vikings', game_date: hoursFromNow(-1), published_pick: { pick: 'Vikings ML', odds: 120 } });
  const legs = [gameItem(g1, g1.game_key, g1.published_pick), gameItem(g2, g2.game_key, g2.published_pick)];
  const parlay = parlayItems('p1', legs, { odds: 264, book_pct: 25, our_pct: 30.3 });

  it('keys each leg under the parlay so the same pick can also be tracked alone', () => {
    expect(parlay[0].key).toBe(parlayLegKey('p1', legs[0].key));
    expect(parlay[0].key).not.toBe(legs[0].key);
    expect(parlay[1].parlay).toMatchObject({ id: 'p1', size: 2, odds: 264, leg: 1 });
  });

  it('groups legs into one unit next to single bets', () => {
    const units = groupTracked([legs[0], parlay[1], parlay[0]]);
    expect(units.map(u => u.type)).toEqual(['single', 'parlay']);
    expect(units[1].legs.map(l => l.parlay.leg)).toEqual([0, 1]);
  });

  it('a parlay is lost on any lost leg, won when all are in', () => {
    expect(parlayStatus(['won', 'lost', null]).state).toBe('lost');
    expect(parlayStatus(['won', null]).state).toBe('open');
    expect(parlayStatus(['won', 'push']).state).toBe('won');
    expect(parlayStatus(['push', 'push']).state).toBe('push');
  });

  it('sits in progress while any leg is live', () => {
    const s = splitUnits([...parlay, legs[0]], () => ({}), NOW);
    expect(s.live.map(u => u.type)).toEqual(['parlay']);
    expect(s.upcoming.map(u => u.type)).toEqual(['single']);
  });
});
