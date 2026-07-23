// __tests__/lib/edge-models/soccer-1x2.test.js
// Pure math tests for the three-way 1X2 soccer edge model.

'use strict';

const {
  americanToProb,
  rawImplied,
  devigProportional,
  devigPower,
  devigShin,
  consensusProbs,
  goalModelProbabilities,
  expectedGoalsFromStrengths,
  blendProbabilities,
  fromOddsCacheRows,
  calculateSoccer1x2Edges,
  pickBest1x2Side,
} = require('../../../lib/services/edge-models/soccer-1x2');

// Real MLS rows pulled from odds_cache on 2026-07-23.
const EVEN_BOOK = { bookmaker: 'fanduel', home: 100, draw: 260, away: 250 };       // DC United vs Toronto
const LONGSHOT_BOOK = { bookmaker: 'draftkings', home: -900, draw: 800, away: 2000 }; // LAFC vs RSL
const DRAW_FAV_BOOK = { bookmaker: 'fanduel', home: 400, draw: -175, away: 340 };  // Austin vs Seattle

const sum3 = (p) => p.home + p.draw + p.away;

describe('americanToProb', () => {
  test('converts negative and positive prices', () => {
    expect(americanToProb(-180)).toBeCloseTo(180 / 280, 6);
    expect(americanToProb(150)).toBeCloseTo(100 / 250, 6);
    expect(americanToProb(100)).toBeCloseTo(0.5, 6);
    expect(americanToProb(-100)).toBeCloseTo(0.5, 6);
  });

  test('rejects garbage', () => {
    expect(americanToProb(null)).toBeNull();
    expect(americanToProb('abc')).toBeNull();
    expect(americanToProb(0)).toBeNull();
    expect(americanToProb(50)).toBeNull(); // not a valid American price
  });
});

describe('rawImplied', () => {
  test('three-way booksum carries the overround', () => {
    const r = rawImplied(EVEN_BOOK);
    expect(r).not.toBeNull();
    expect(r.booksum).toBeGreaterThan(1);
    expect(r.overround).toBeCloseTo(r.booksum - 1, 10);
  });

  test('null when any price is missing', () => {
    expect(rawImplied({ home: -110, draw: null, away: 240 })).toBeNull();
  });
});

describe('devigProportional', () => {
  test('sums to 1 and preserves ratios', () => {
    const { raw } = rawImplied(EVEN_BOOK);
    const p = devigProportional(raw);
    expect(sum3(p)).toBeCloseTo(1, 10);
    expect(p.home / p.away).toBeCloseTo(raw.home / raw.away, 10);
    expect(p.home / p.draw).toBeCloseTo(raw.home / raw.draw, 10);
  });
});

describe('devigPower', () => {
  test('sums to 1', () => {
    const { raw } = rawImplied(LONGSHOT_BOOK);
    const p = devigPower(raw);
    expect(sum3(p)).toBeCloseTo(1, 6);
  });

  test('shrinks the longshot harder than proportional', () => {
    const { raw } = rawImplied(LONGSHOT_BOOK);
    const power = devigPower(raw);
    const prop = devigProportional(raw);
    expect(power.away).toBeLessThan(prop.away);   // +2000 longshot
    expect(power.home).toBeGreaterThan(prop.home); // -900 favorite
  });
});

describe('devigShin', () => {
  test('sums to 1 on all three sample books', () => {
    for (const book of [EVEN_BOOK, LONGSHOT_BOOK, DRAW_FAV_BOOK]) {
      const { raw } = rawImplied(book);
      const shin = devigShin(raw);
      expect(shin).not.toBeNull();
      expect(sum3(shin.probs)).toBeCloseTo(1, 6);
      expect(shin.z).toBeGreaterThanOrEqual(0);
      expect(shin.z).toBeLessThan(0.5);
    }
  });

  test('favorite-longshot correction: favorite up, longshot down vs proportional', () => {
    const { raw } = rawImplied(LONGSHOT_BOOK);
    const shin = devigShin(raw);
    const prop = devigProportional(raw);
    expect(shin.probs.home).toBeGreaterThan(prop.home);
    expect(shin.probs.away).toBeLessThan(prop.away);
  });

  test('near-fair book returns near-raw probabilities with z near 0', () => {
    // A synthetic book with almost no margin.
    const fair = { home: 0.45, draw: 0.27, away: 0.28 };
    const shin = devigShin(fair);
    expect(shin.z).toBeCloseTo(0, 3);
    expect(shin.probs.home).toBeCloseTo(0.45, 3);
    expect(shin.probs.draw).toBeCloseTo(0.27, 3);
    expect(shin.probs.away).toBeCloseTo(0.28, 3);
  });

  test('z grows with the overround', () => {
    const lowVig = devigShin({ home: 0.46, draw: 0.28, away: 0.29 });  // 3% overround
    const highVig = devigShin({ home: 0.49, draw: 0.30, away: 0.31 }); // 10% overround
    expect(highVig.z).toBeGreaterThan(lowVig.z);
  });
});

describe('consensusProbs', () => {
  test('median across books, renormalized to 1', () => {
    const books = [
      { bookmaker: 'a', home: 100, draw: 260, away: 250 },
      { bookmaker: 'b', home: 105, draw: 255, away: 245 },
      { bookmaker: 'c', home: -102, draw: 265, away: 255 },
    ];
    const c = consensusProbs(books, 'proportional');
    expect(c.booksUsed).toBe(3);
    expect(sum3(c.probs)).toBeCloseTo(1, 10);
  });

  test('skips incomplete books instead of failing', () => {
    const books = [EVEN_BOOK, { bookmaker: 'broken', home: -110, draw: null, away: 240 }];
    const c = consensusProbs(books, 'shin');
    expect(c.booksUsed).toBe(1);
  });

  test('null when no book is usable', () => {
    expect(consensusProbs([], 'shin')).toBeNull();
    expect(consensusProbs([{ home: null, draw: null, away: null }], 'shin')).toBeNull();
  });
});

describe('goalModelProbabilities', () => {
  test('null when strength data is absent', () => {
    expect(goalModelProbabilities(null)).toBeNull();
    expect(goalModelProbabilities({})).toBeNull();
    expect(goalModelProbabilities({ homeExpectedGoals: 1.4 })).toBeNull();
  });

  test('probabilities sum to 1 and favor the stronger side', () => {
    const p = goalModelProbabilities({ homeExpectedGoals: 1.8, awayExpectedGoals: 1.0 });
    expect(sum3(p)).toBeCloseTo(1, 6);
    expect(p.home).toBeGreaterThan(p.away);
    expect(p.draw).toBeGreaterThan(0.1); // draws are never negligible in soccer
  });

  test('equal expected goals put home and away level', () => {
    const p = goalModelProbabilities({ homeExpectedGoals: 1.3, awayExpectedGoals: 1.3 });
    expect(p.home).toBeCloseTo(p.away, 6);
  });

  test('negative Dixon-Coles rho raises the draw probability', () => {
    const base = goalModelProbabilities({ homeExpectedGoals: 1.3, awayExpectedGoals: 1.1, rho: 0 });
    const dc = goalModelProbabilities({ homeExpectedGoals: 1.3, awayExpectedGoals: 1.1, rho: -0.1 });
    expect(dc.draw).toBeGreaterThan(base.draw);
    expect(sum3(dc)).toBeCloseTo(1, 6);
  });

  test('rating form maps attack and defense to expected goals', () => {
    const strengths = {
      homeAttack: 1.2, homeDefense: 0.9,
      awayAttack: 0.8, awayDefense: 1.1,
      leagueHomeGoals: 1.5, leagueAwayGoals: 1.2,
    };
    const eg = expectedGoalsFromStrengths(strengths);
    expect(eg.homeExpectedGoals).toBeCloseTo(1.2 * 1.1 * 1.5, 10);
    expect(eg.awayExpectedGoals).toBeCloseTo(0.8 * 0.9 * 1.2, 10);
    const p = goalModelProbabilities(strengths);
    expect(sum3(p)).toBeCloseTo(1, 6);
    expect(p.home).toBeGreaterThan(p.away);
  });
});

describe('blendProbabilities', () => {
  const market = { home: 0.40, draw: 0.28, away: 0.32 };
  const model = { home: 0.50, draw: 0.26, away: 0.24 };

  test('passes market through when model is null', () => {
    expect(blendProbabilities(market, null)).toEqual(market);
  });

  test('weighted blend lands between market and model and sums to 1', () => {
    const b = blendProbabilities(market, model, 0.5);
    expect(sum3(b)).toBeCloseTo(1, 10);
    expect(b.home).toBeGreaterThan(market.home);
    expect(b.home).toBeLessThan(model.home);
  });

  test('weight 0 is market, weight 1 is model', () => {
    expect(blendProbabilities(market, model, 0).home).toBeCloseTo(market.home, 10);
    expect(blendProbabilities(market, model, 1).home).toBeCloseTo(model.home, 10);
  });
});

describe('fromOddsCacheRows', () => {
  const rows = [
    {
      bookmaker: 'fanduel', market_type: 'h2h',
      outcomes: [
        { name: 'D.C. United', price: 100 },
        { name: 'Toronto FC', price: 250 },
        { name: 'Draw', price: 260 },
      ],
    },
    {
      bookmaker: 'draftkings', market_type: 'totals',
      outcomes: [{ name: 'Over', price: -110, point: 2.5 }, { name: 'Under', price: -110, point: 2.5 }],
    },
    {
      bookmaker: 'caesars', market_type: 'h2h',
      outcomes: [{ name: 'D.C. United', price: 105 }, { name: 'Toronto FC', price: 245 }],
    },
  ];

  test('maps h2h rows with a Draw outcome and drops the rest', () => {
    const books = fromOddsCacheRows(rows, 'D.C. United', 'Toronto FC');
    expect(books).toHaveLength(1);
    expect(books[0]).toEqual({ bookmaker: 'fanduel', home: 100, draw: 260, away: 250 });
  });

  test('empty input gives empty output', () => {
    expect(fromOddsCacheRows(null, 'A', 'B')).toEqual([]);
  });
});

describe('calculateSoccer1x2Edges', () => {
  test('null when no usable book exists', () => {
    expect(calculateSoccer1x2Edges({ books: [] })).toBeNull();
  });

  test('market-only mode: probabilities sum to 1 and draw is a first-class side', () => {
    const result = calculateSoccer1x2Edges({
      homeTeam: 'D.C. United', awayTeam: 'Toronto FC',
      books: [EVEN_BOOK],
    });
    expect(result).not.toBeNull();
    expect(result.modelSource).toBe('shin_market_only');
    expect(result.homeWinProb + result.drawProb + result.awayWinProb).toBeCloseTo(1, 3);
    expect(result.impliedHomeProb + result.impliedDrawProb + result.impliedAwayProb).toBeCloseTo(1, 3);
    expect(Object.keys(result.edges).sort()).toEqual(['away_ml', 'draw', 'home_ml']);
    expect(result.dataQuality.hasGoalModel).toBe(false);
  });

  test('edge sign convention: model above implied is positive', () => {
    const result = calculateSoccer1x2Edges({
      books: [EVEN_BOOK],
      strengths: { homeExpectedGoals: 2.2, awayExpectedGoals: 0.8 },
    });
    expect(result.modelSource).toBe('shin_goal_blend');
    // A strong goal model tilt toward home must produce a positive home edge
    // and the three signed edges must roughly offset.
    expect(result.edges.home_ml).toBeGreaterThan(0);
    const totalEdge = result.edgesRaw.home_ml + result.edgesRaw.draw + result.edgesRaw.away_ml;
    expect(Math.abs(totalEdge)).toBeLessThan(0.01);
  });

  test('edges are capped at maxEdge', () => {
    const result = calculateSoccer1x2Edges({
      books: [LONGSHOT_BOOK],
      strengths: { homeExpectedGoals: 0.5, awayExpectedGoals: 3.5 },
      options: { modelWeight: 1 },
    });
    for (const side of Object.keys(result.edges)) {
      expect(Math.abs(result.edges[side])).toBeLessThanOrEqual(0.15);
    }
  });

  test('calibration multiplier of 0 zeroes published edges but keeps raw', () => {
    const result = calculateSoccer1x2Edges({
      books: [EVEN_BOOK],
      strengths: { homeExpectedGoals: 2.0, awayExpectedGoals: 0.9 },
      options: { calibrationMultiplier: 0 },
    });
    expect(result.edges.home_ml).toBe(0);
    expect(result.edgesRaw.home_ml).not.toBe(0);
  });

  test('draw can be the recommended side', () => {
    // Goal model that loves the draw: low scoring and negative rho.
    const result = calculateSoccer1x2Edges({
      books: [EVEN_BOOK],
      strengths: { homeExpectedGoals: 0.7, awayExpectedGoals: 0.7, rho: -0.12 },
      options: { modelWeight: 0.8 },
    });
    const best = pickBest1x2Side(result, { minEdgePp: -100 });
    expect(best).not.toBeNull();
    expect(best.side).toBe('draw');
    expect(best.signedEdge).toBeGreaterThan(0);
  });

  test('draw as market favorite flows through cleanly', () => {
    const result = calculateSoccer1x2Edges({ books: [DRAW_FAV_BOOK] });
    expect(result.impliedDrawProb).toBeGreaterThan(result.impliedHomeProb);
    expect(result.impliedDrawProb).toBeGreaterThan(result.impliedAwayProb);
  });

  test('legacy scalars mirror the largest magnitude edge', () => {
    const result = calculateSoccer1x2Edges({
      books: [EVEN_BOOK],
      strengths: { homeExpectedGoals: 2.2, awayExpectedGoals: 0.8 },
    });
    const sideKey = { home: 'home_ml', draw: 'draw', away: 'away_ml' };
    const magnitudes = Object.values(result.edges).map(Math.abs);
    expect(Math.abs(result.edge)).toBeCloseTo(Math.max(...magnitudes), 10);
    expect(result.edges[sideKey[result.edgeSide]]).toBe(result.edge);
    expect(result.edgePercent).toBeCloseTo(Math.abs(result.edge) * 100, 2);
  });
});

describe('pickBest1x2Side', () => {
  test('respects the minimum edge threshold', () => {
    const fake = { edges: { home_ml: 0.015, draw: 0.005, away_ml: -0.02 } };
    expect(pickBest1x2Side(fake, { minEdgePp: 2 })).toBeNull();
    expect(pickBest1x2Side(fake, { minEdgePp: 1 })).toEqual({ side: 'home_ml', signedEdge: 0.015 });
  });

  test('null on empty input', () => {
    expect(pickBest1x2Side(null)).toBeNull();
    expect(pickBest1x2Side({ edges: {} })).toBeNull();
  });
});
