// The 2026-09-08 anchor-era rubric: the learning loop's first weight
// changes since the market anchor shipped. Form is zeroed (anti-signal
// in every attribution reading), pitcher runs half weight while
// anchored (sign flipped once the market became the base), and the
// spread margin transform only prices half the model's disagreement
// with the market (the amplified 10pp+ tail delivered minus 2.0pp on
// its first anchor-era measurement).

const { EdgeCalculator } = require('../../lib/services/edge-calculator');

describe('_dampedModelMargin', () => {
  const calc = new EdgeCalculator({});
  const sigma = 4.0; // MLB

  test('anchored: only half the probability disagreement prices covers', () => {
    const full = calc._dampedModelMargin(0.62, null, sigma);
    const market = calc._dampedModelMargin(0.55, null, sigma);
    const damped = calc._dampedModelMargin(0.62, 0.55, sigma);
    expect(damped).toBeCloseTo(market + 0.5 * (full - market), 10);
    expect(Math.abs(damped - market)).toBeLessThan(Math.abs(full - market));
  });

  test('agreeing with the market changes nothing', () => {
    const damped = calc._dampedModelMargin(0.58, 0.58, sigma);
    const full = calc._dampedModelMargin(0.58, null, sigma);
    expect(damped).toBeCloseTo(full, 10);
  });

  test('unanchored games keep the full transform', () => {
    const full = calc._dampedModelMargin(0.66, null, sigma);
    expect(calc._dampedModelMargin(0.66, undefined, sigma)).toBeCloseTo(full, 10);
    expect(calc._dampedModelMargin(0.66, NaN, sigma)).toBeCloseTo(full, 10);
  });

  test('damping is symmetric for dogs', () => {
    const dampedFav = calc._dampedModelMargin(0.62, 0.55, sigma);
    const dampedDog = calc._dampedModelMargin(0.38, 0.45, sigma);
    expect(dampedFav).toBeCloseTo(-dampedDog, 10);
  });
});

describe('spread anchored margin (2026-09-10)', () => {
  const calc = new EdgeCalculator({});

  test('a point spread anchors the market margin at the spread, not the moneyline', () => {
    // ND -44.5, sigma 16: the moneyline-derived margin (from a 0.99 prob)
    // sits near 37, the spread says 44.5. Agreeing with the market must
    // return exactly the spread.
    const agree = calc._dampedModelMargin(0.997, 0.997, 16, 0.5, 44.5);
    expect(agree).toBeCloseTo(44.5, 10);
    // A factor stack that disagrees moves off the spread by half its delta.
    const full = calc._dampedModelMargin(0.95, null, 16);
    const marketFromProb = calc._dampedModelMargin(0.997, null, 16);
    const moved = calc._dampedModelMargin(0.95, 0.997, 16, 0.5, 44.5);
    expect(moved).toBeCloseTo(44.5 + 0.5 * (full - marketFromProb), 10);
  });

  test('the final clamp never sits inside the market anchor', () => {
    expect(calc._clampWinProb(0.995, null)).toBeCloseTo(0.98, 10);
    expect(calc._clampWinProb(1.06, 0.9973)).toBeCloseTo(0.9973, 10);
    expect(calc._clampWinProb(0.001, 0.005)).toBeCloseTo(0.005, 10);
    expect(calc._clampWinProb(0.55, 0.62)).toBeCloseTo(0.55, 10);
  });

  test('the spread alone implies a market win probability when no moneyline exists', () => {
    expect(calc._anchorFromSpread(-44.5, 16)).toBeCloseTo(0.9973, 3);
    expect(calc._anchorFromSpread(3, 13.5)).toBeCloseTo(0.412, 2);
    expect(calc._anchorFromSpread(null, 16)).toBeNull();
    expect(calc._anchorFromSpread(-3, 0)).toBeNull();
  });
});

describe('the dial board', () => {
  const calc = new EdgeCalculator({});

  test('sport row overrides pooled row overrides code default', () => {
    const dials = new Map([
      ['__all__|venue_weight', 0.25],
      ['MLB|venue_weight', 0.3125],
      ['__all__|spread_claim_damp', 0.7],
    ]);
    expect(calc._dial(dials, 'MLB', 'venue_weight')).toBe(0.3125);
    expect(calc._dial(dials, 'NFL', 'venue_weight')).toBe(0.25);
    expect(calc._dial(dials, 'MLB', 'spread_claim_damp')).toBe(0.7);
    expect(calc._dial(dials, 'MLB', 'sos_sensitivity')).toBe(0.15);
  });

  test('no table at all serves the shipped defaults', () => {
    expect(calc._dial(null, 'MLB', 'form_weight')).toBe(0);
    expect(calc._dial(null, 'MLB', 'pitcher_anchor_damp')).toBe(0.5);
    expect(calc._dial(null, 'MLB', 'spread_claim_damp')).toBe(0.5);
    expect(calc._dial(null, 'MLB', 'max_net_adjustment')).toBe(0.15);
  });

  test('a dialed venue weight reaches the venue impact', () => {
    const base = calc._venueSplitImpact(0.10, 20, 'NFL');
    const dialed = calc._venueSplitImpact(0.10, 20, 'NFL', 0.35);
    expect(base).toBeCloseTo(0.10 * 0.25, 10);
    expect(dialed).toBeCloseTo(0.10 * 0.35, 10);
  });
});

describe('totals step one (2026-09-11): the book total is the anchor', () => {
  const calc = new EdgeCalculator({});

  test('a full season at damp 1 prices the raw scoring total exactly as before', () => {
    const r = calc._anchoredModelTotal(9.4, 8.5, 1, 140);
    expect(r.modeledTotal).toBeCloseTo(9.4, 10);
    expect(r.confidence).toBe(1);
  });

  test('damp 0.5 prices half the disagreement with the book', () => {
    const r = calc._anchoredModelTotal(60.5, 56.5, 0.5, 12);
    expect(r.modeledTotal).toBeCloseTo(58.5, 10);
  });

  test('a week-2 college total off one game barely moves off the book', () => {
    // Louisville, 56.5 book, scoring model 78 off a single blowout: the
    // old path claimed 35pp raw. Damp 0.5 times confidence 0.2 keeps 10
    // percent of the disagreement.
    const r = calc._anchoredModelTotal(78, 56.5, 0.5, 1);
    expect(r.confidence).toBeCloseTo(0.2, 10);
    expect(r.modeledTotal).toBeCloseTo(56.5 + 0.1 * 21.5, 10);
    expect(calc._anchoredModelTotal(78, 56.5, 0.5, 0).modeledTotal).toBeCloseTo(56.5, 10);
  });

  test('agreeing with the book changes nothing at any damp', () => {
    expect(calc._anchoredModelTotal(50.5, 50.5, 0.3, 2).modeledTotal).toBeCloseTo(50.5, 10);
  });

  test('no book total means no anchor, the scoring total stands', () => {
    expect(calc._anchoredModelTotal(52, null, 0.5, 3).modeledTotal).toBe(52);
  });

  test('the dial default is 1 so an unseeded sport reproduces shipped behavior', () => {
    expect(calc._dial(null, 'MLB', 'total_claim_damp')).toBe(1);
  });
});

describe('home advantage never stacks on the market anchor (2026-09-12)', () => {
  test('an anchored game carries no home advantage adjustment', async () => {
    const { EdgeCalculator } = require('../../lib/services/edge-calculator');
    const calc = new EdgeCalculator({});
    calc._loadDials = async () => null;
    calc.getTeamRecord = async () => null;
    calc.getRecentForm = async () => null;
    calc.getInjuryImpact = async () => 0;
    calc._getScheduleStrength = async () => null;
    calc.getStandingsSnapshot = async (team) => ({ team_name: team, record: '0-0', streak: null, last_10: null, home_record: '0-0', away_record: '0-0', playoff_seed: null, win_percentage: '0.000' });
    calc._getCalibration = async () => ({});
    const game = { sport: 'americanfootball_nfl', home_team: 'Detroit Lions', away_team: 'New Orleans Saints', game_date: '2026-09-13T17:00:00Z',
      markets: { h2h: [{ name: 'Detroit Lions', price: -340 }, { name: 'New Orleans Saints', price: 270 }] } };
    const out = await calc.calculateEdge(game);
    expect(out).not.toBeNull();
    expect((out.factors.adjustments || []).some(a => a.factor === 'Home advantage')).toBe(false);
    expect(out.factors.marketAnchored).toBe(true);
    expect(Math.abs(out.edgesRaw.home_ml)).toBeLessThan(0.005);
  });
});
