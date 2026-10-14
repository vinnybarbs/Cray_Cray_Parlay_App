const ss = require('../../lib/services/soccer-strengths.js');

// Seeded generator so the simulated league is the same every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function poisson(lambda, rand) {
  const L = Math.exp(-lambda); let k = 0; let p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}
const NAMES = ['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir', 'Ginkgo', 'Hazel', 'Ironwood', 'Juniper', 'Kapok', 'Larch'];
function simulateLeague({ seasons = 2, seed = 7 } = {}) {
  const rand = rng(seed);
  const truth = [];
  for (let i = 0; i < 12; i++) truth.push({ id: i + 1, name: NAMES[i], attack: (i - 5.5) * 0.06, defense: (5.5 - i) * -0.04 });
  const matches = [];
  let day = new Date('2025-08-01T00:00:00Z');
  for (let s = 0; s < seasons; s++) {
    for (const h of truth) for (const a of truth) {
      if (h === a) continue;
      const lh = Math.exp(Math.log(1.2) + 0.25 + h.attack - a.defense);
      const la = Math.exp(Math.log(1.2) + a.attack - h.defense);
      matches.push({ date: day.toISOString().slice(0, 10), competition: 'EPL', homeId: h.id, awayId: a.id, homeName: h.name, awayName: a.name, homeGoals: poisson(lh, rand), awayGoals: poisson(la, rand) });
      day = new Date(day.getTime() + 86400000 / 3);
    }
  }
  return { truth, matches, end: day.toISOString().slice(0, 10) };
}

describe('soccerTeamKey mirrors the SQL normalizer', () => {
  test('strips suffixes, accents and folds &', () => {
    expect(ss.soccerTeamKey('Brighton & Hove Albion')).toBe('brighton and hove albion');
    expect(ss.soccerTeamKey('CF Montréal')).toBe('montreal');
    expect(ss.soccerTeamKey('Los Angeles FC')).toBe('los angeles');
    expect(ss.soccerTeamKey('1. FC Köln')).toBe('koln');
  });
  test('applies aliases', () => {
    const aliases = new Map([['inter milan', 'internazionale']]);
    expect(ss.soccerTeamKey('Inter Milan', aliases)).toBe('internazionale');
  });
});

describe('fitStrengths', () => {
  const { truth, matches, end } = simulateLeague();
  const fit = ss.fitStrengths(matches, { asOf: end });

  test('recovers the ordering of simulated clubs', () => {
    const net = (t) => t.attack + t.defense;
    const fitted = new Map(fit.teams.map((t) => [t.id, net(t)]));
    // Spearman style check: best and worst true clubs sit at the ends.
    const sorted = [...fit.teams].sort((a, b) => net(b) - net(a)).map((t) => t.id);
    expect(sorted.slice(0, 3)).toContain(12);
    expect(sorted.slice(-3)).toContain(1);
    expect(fitted.get(12)).toBeGreaterThan(fitted.get(1));
    expect(truth.length).toBe(fit.teams.length);
  });

  test('recovers the scoring rate and a positive home edge', () => {
    const c = fit.competitions.EPL;
    expect(Math.exp(c.mu)).toBeGreaterThan(0.9);
    expect(Math.exp(c.mu)).toBeLessThan(1.5);
    expect(c.home).toBeGreaterThan(0.05);
    expect(c.home).toBeLessThan(0.5);
  });

  test('ignores matches on or after asOf', () => {
    const early = ss.fitStrengths(matches, { asOf: '2025-08-02' });
    expect(early.nMatches).toBeLessThan(10);
    expect(ss.fitStrengths(matches, { asOf: '2025-07-01' })).toBeNull();
  });

  test('expectedGoalsFor prices known clubs and refuses unknown or thin ones', () => {
    const idx = ss.indexFit(fit);
    const eg = ss.expectedGoalsFor(idx, 'EPL', 'Larch', 'Alder');
    expect(eg.homeExpectedGoals).toBeGreaterThan(eg.awayExpectedGoals);
    expect(ss.expectedGoalsFor(idx, 'EPL', 'Larch', 'Nobody FC')).toBeNull();
    expect(ss.expectedGoalsFor(idx, 'La Liga', 'Larch', 'Alder')).toBeNull();
    const thin = ss.indexFit(ss.fitStrengths(matches, { asOf: '2025-08-03' }));
    expect(ss.expectedGoalsFor(thin, 'EPL', 'Alder', 'Birch')).toBeNull();
  });
});

describe('scoring and walk-forward', () => {
  test('scorePredictions gives lower log loss to the sharper forecast', () => {
    const items = [
      { market: { home: 0.4, draw: 0.3, away: 0.3 }, model: { home: 0.6, draw: 0.2, away: 0.2 }, outcome: 'home' },
    ];
    const s = ss.scorePredictions(items, [0, 1]);
    expect(s['1'].logLoss).toBeLessThan(s['0'].logLoss);
  });

  test('marketConsensus devigs proportionally across books', () => {
    const m = ss.marketConsensus([{ home: -110, draw: 250, away: 300 }, { home: -120, draw: 260, away: 320 }]);
    expect(m.home + m.draw + m.away).toBeCloseTo(1, 6);
    expect(m.books).toBe(2);
  });

  test('walkForward fits only on earlier weeks and scores priced games', () => {
    const { matches } = simulateLeague();
    const late = matches.slice(-20);
    const priced = late.map((m) => ({ date: m.date, competition: 'EPL', home: m.homeName, away: m.awayName, homeGoals: m.homeGoals, awayGoals: m.awayGoals, books: [{ home: 150, draw: 230, away: 180 }] }));
    const r = ss.walkForward(matches, priced);
    expect(r.n).toBe(20);
    expect(r.scores['0'].n).toBe(20);
    expect(r.scores['1'].logLoss).not.toBeNull();
  });

  test('poolForSport', () => {
    expect(ss.poolForSport('La Liga')).toBe('europe');
    expect(ss.poolForSport('Champions League')).toBe('europe');
    expect(ss.poolForSport('MLS')).toBe('mls');
    expect(ss.poolForSport('NFL')).toBeNull();
  });
});

describe('pre-analyze inputs', () => {
  const soccer1x2 = require('../../lib/services/edge-models/soccer-1x2.js');
  const { matches, end } = simulateLeague();
  const idx = ss.indexFit(ss.fitStrengths(matches, { asOf: end }));
  const current = { pools: { europe: idx }, weights: {}, aliases: new Map() };
  const books = [
    { bookmaker: 'a', home: -150, draw: 280, away: 400 },
    { bookmaker: 'b', home: -145, draw: 275, away: 390 },
    { bookmaker: 'c', home: -155, draw: 290, away: 410 },
  ];

  test('weight defaults to 0 and the claim stays market only', () => {
    const goal = ss.goalInputsFor(current, 'EPL', 'Larch', 'Alder');
    expect(goal.modelWeight).toBe(0);
    expect(goal.strengths).not.toBeNull();
    const r = soccer1x2.calculateSoccer1x2Edges({ homeTeam: 'Larch', awayTeam: 'Alder', books, strengths: goal.strengths, options: { modelWeight: goal.modelWeight } });
    expect(r.modelSource).toBe('market_only');
    expect(r.edges).toEqual({ home_ml: 0, draw: 0, away_ml: 0 });
    expect(r.factors.goalModel.home).toBeGreaterThan(0);
    expect(r.factors.goalModel.homeXg).toBeGreaterThan(0);
    expect(r.confidence).not.toBe('high');
  });

  test('unknown sport or empty model gives no strengths', () => {
    expect(ss.goalInputsFor(current, 'MLS', 'Larch', 'Alder').strengths).toBeNull();
    expect(ss.goalInputsFor(null, 'EPL', 'Larch', 'Alder')).toEqual({ strengths: null, modelWeight: 0 });
  });

  test('loadCurrent fails soft', async () => {
    ss.clearCache();
    const broken = { from: () => { throw new Error('down'); } };
    const v = await ss.loadCurrent(broken);
    expect(v.pools).toEqual({});
    ss.clearCache();
  });
});
