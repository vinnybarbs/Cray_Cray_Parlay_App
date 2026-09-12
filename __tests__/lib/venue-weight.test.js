// MLB venue up-weight, learning loop stage two (2026-08-31): venue's
// attribution slope cleared the promotion gate two consecutive Mondays
// (7.37 on n=129, then 4.54 on n=252), so MLB's delta weight moved one
// max step, 0.25 to 0.3125. Every other sport stays at 0.25, and the
// White Sox / Royals safety rails (±4pp cap, confidence taper) hold for
// everyone.

const { EdgeCalculator } = require('../../lib/services/edge-calculator');

describe('_venueSplitImpact per-sport weight', () => {
  const calc = new EdgeCalculator({});
  // 20+ game sample: taper is 1.0, so the weight reads directly.
  const delta = 0.10;
  const games = 25;

  test('MLB carries the stage two up-weight', () => {
    expect(calc._venueSplitImpact(delta, games, 'MLB')).toBeCloseTo(0.10 * 0.3125, 6);
  });

  test('other sports keep the original weight', () => {
    expect(calc._venueSplitImpact(delta, games, 'NFL')).toBeCloseTo(0.10 * 0.25, 6);
    expect(calc._venueSplitImpact(delta, games, 'NBA')).toBeCloseTo(0.10 * 0.25, 6);
    expect(calc._venueSplitImpact(delta, games)).toBeCloseTo(0.10 * 0.25, 6);
  });

  test('the ±4pp cap still binds above the up-weight', () => {
    expect(calc._venueSplitImpact(0.30, games, 'MLB')).toBeCloseTo(0.04, 6);
    expect(calc._venueSplitImpact(-0.30, games, 'MLB')).toBeCloseTo(-0.04, 6);
  });

  test('the confidence taper still applies under the up-weight', () => {
    // 10 games: confidence (10-5)/15 = 1/3.
    expect(calc._venueSplitImpact(delta, 10, 'MLB')).toBeCloseTo(0.10 * 0.3125 / 3, 6);
    expect(calc._venueSplitImpact(delta, 4, 'MLB')).toBe(0);
  });
});

// 2026-09-12: venue splits are centered on the league's own home and
// road bump. Raw, every MLB club is about 2.8pp better at home than
// overall, so "strong at home" and "weak on road" re-added home field on
// nearly every anchored read (257 of 364 replayed picks home).
describe('_venueSplitAdjustments centered on the league norm', () => {
  const calc = new EdgeCalculator({});
  // An average club: 81-81 overall, 45-36 at home (55.6%), 36-45 on the road (44.4%).
  const home = { record: '81-81', home_record: '45-36', away_record: '36-45' };
  const away = { record: '81-81', home_record: '45-36', away_record: '36-45' };
  const league = { home: 0.0556, road: -0.0556, teams: 30 };

  test('raw (uncentered) the average matchup argues home twice', () => {
    const adj = calc._venueSplitAdjustments(home, away, 'MLB', 'H', 'A', null, { home: 0, road: 0 });
    expect(adj.map(a => a.factor)).toEqual(['H strong at home', 'A weak on road']);
    expect(adj.every(a => a.impact > 0)).toBe(true);
  });

  test('centered on the league norm the average matchup argues nothing', () => {
    const adj = calc._venueSplitAdjustments(home, away, 'MLB', 'H', 'A', null, league);
    expect(adj).toEqual([]);
  });

  test('centered, only the excess over the norm argues', () => {
    // 54-27 at home is 66.7%, 11pp over the norm after centering.
    const strong = { record: '90-72', home_record: '54-27', away_record: '36-45' };
    const adj = calc._venueSplitAdjustments(strong, away, 'MLB', 'H', 'A', null, league);
    expect(adj.length).toBe(1);
    expect(adj[0].factor).toBe('H strong at home');
    expect(adj[0].detail).toContain('league norm +5.6pp removed');
    expect(adj[0].impact).toBeCloseTo(((54 / 81 - 90 / 162) - 0.0556) * 0.3125, 4);
  });

  test('the league bump is the mean over qualifying teams, zero under ten teams', () => {
    const rows = Array.from({ length: 12 }, () => ({ record: '81-81', home_record: '45-36', away_record: '36-45' }));
    const bump = calc._leagueVenueBumpFromRows(rows, 'MLB');
    expect(bump.teams).toBe(12);
    expect(bump.home).toBeCloseTo(45 / 81 - 0.5, 6);
    expect(bump.road).toBeCloseTo(36 / 81 - 0.5, 6);
    expect(calc._leagueVenueBumpFromRows(rows.slice(0, 5), 'MLB')).toEqual({ home: 0, road: 0, teams: 5 });
  });

  test('getLeagueVenueBump reads the sport standings and fails soft', async () => {
    const rows = Array.from({ length: 12 }, () => ({ record: '81-81', home_record: '45-36', away_record: '36-45' }));
    const sb = { from: () => ({ select: () => ({ eq: async () => ({ data: rows }) }) }) };
    const c = new EdgeCalculator(sb);
    const bump = await c.getLeagueVenueBump('MLB');
    expect(bump.home).toBeCloseTo(45 / 81 - 0.5, 6);
    const broken = new EdgeCalculator({ from: () => { throw new Error('down'); } });
    expect(await broken.getLeagueVenueBump('MLB')).toEqual({ home: 0, road: 0, teams: 0 });
  });
});
