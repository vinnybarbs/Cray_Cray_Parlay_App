// __tests__/lib/edge-models/ufc-model.test.js
//
// Pure math tests for the UFC fight edge model. No network, no Supabase.
// Covers devig, consensus, the ratings blend, edge sign conventions, and
// heavy favorite behavior.

'use strict';

const {
  computeUfcEdge,
  americanToProb,
  devigTwoWay,
  consensusFairProb,
  eloWinProbability,
  ratingsWeight,
  blendProbabilities,
  extractBookPairs,
  median,
  MAX_EDGE,
} = require('../../../lib/services/edge-models/ufc-model');

// Real shapes from odds_cache (fighters in home_team and away_team, one h2h
// row per bookmaker).
const FIGHT = {
  home_team: 'Umar Nurmagomedov',
  away_team: 'Song Yadong',
  books: [
    {
      bookmaker: 'fanduel',
      outcomes: [
        { name: 'Song Yadong', price: 350 },
        { name: 'Umar Nurmagomedov', price: -520 },
      ],
    },
    {
      bookmaker: 'draftkings',
      outcomes: [
        { name: 'Song Yadong', price: 360 },
        { name: 'Umar Nurmagomedov', price: -470 },
      ],
    },
  ],
};

describe('americanToProb', () => {
  test('negative price', () => {
    expect(americanToProb(-180)).toBeCloseTo(180 / 280, 6);
  });

  test('positive price', () => {
    expect(americanToProb(150)).toBeCloseTo(0.4, 6);
  });

  test('rejects invalid American prices', () => {
    expect(americanToProb(0)).toBeNull();
    expect(americanToProb(50)).toBeNull();
    expect(americanToProb(-99)).toBeNull();
    expect(americanToProb('junk')).toBeNull();
    expect(americanToProb(null)).toBeNull();
  });

  test('accepts numeric strings', () => {
    expect(americanToProb('-110')).toBeCloseTo(110 / 210, 6);
  });
});

describe('devigTwoWay', () => {
  test('symmetric juice devigs to a coin flip', () => {
    const d = devigTwoWay(-110, -110);
    expect(d.probA).toBeCloseTo(0.5, 6);
    expect(d.probB).toBeCloseTo(0.5, 6);
    expect(d.overround).toBeCloseTo(2 * (110 / 210) - 1, 6);
  });

  test('heavy favorite pair sums to 1 and keeps ordering', () => {
    const d = devigTwoWay(-520, 350);
    const rawFav = 520 / 620;
    const rawDog = 100 / 450;
    expect(d.probA).toBeCloseTo(rawFav / (rawFav + rawDog), 6);
    expect(d.probA + d.probB).toBeCloseTo(1, 10);
    expect(d.probA).toBeGreaterThan(0.75);
    expect(d.probA).toBeLessThan(rawFav); // devig removes juice from the favorite
  });

  test('null when a side is missing or invalid', () => {
    expect(devigTwoWay(-110, null)).toBeNull();
    expect(devigTwoWay(undefined, 200)).toBeNull();
    expect(devigTwoWay(-110, 10)).toBeNull();
  });
});

describe('median', () => {
  test('odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  test('empty input', () => {
    expect(median([])).toBeNull();
  });
});

describe('consensusFairProb', () => {
  test('median across books, complementary sides', () => {
    const pairs = [
      { bookmaker: 'fanduel', homePrice: -520, awayPrice: 350 },
      { bookmaker: 'draftkings', homePrice: -470, awayPrice: 360 },
    ];
    const c = consensusFairProb(pairs);
    const fd = devigTwoWay(-520, 350).probA;
    const dk = devigTwoWay(-470, 360).probA;
    expect(c.books).toBe(2);
    expect(c.homeFair).toBeCloseTo((fd + dk) / 2, 6);
    expect(c.homeFair + c.awayFair).toBeCloseTo(1, 10);
  });

  test('skips broken books instead of failing', () => {
    const pairs = [
      { bookmaker: 'dead', homePrice: null, awayPrice: 200 },
      { bookmaker: 'draftkings', homePrice: -180, awayPrice: 150 },
    ];
    const c = consensusFairProb(pairs);
    expect(c.books).toBe(1);
    expect(c.perBook[0].bookmaker).toBe('draftkings');
  });

  test('null when no book has a valid pair', () => {
    expect(consensusFairProb([])).toBeNull();
    expect(consensusFairProb([{ bookmaker: 'x', homePrice: null, awayPrice: null }])).toBeNull();
  });
});

describe('eloWinProbability', () => {
  test('equal ratings is a coin flip', () => {
    expect(eloWinProbability(1500, 1500)).toBeCloseTo(0.5, 10);
  });

  test('400 point gap is about 10 to 1', () => {
    expect(eloWinProbability(1900, 1500)).toBeCloseTo(10 / 11, 6);
  });

  test('symmetry', () => {
    const p = eloWinProbability(1620, 1480);
    const q = eloWinProbability(1480, 1620);
    expect(p + q).toBeCloseTo(1, 10);
  });

  test('null on garbage input', () => {
    expect(eloWinProbability(null, 1500)).toBeNull();
    expect(eloWinProbability(1500, 'x')).toBeNull();
  });
});

describe('ratingsWeight', () => {
  test('zero under the fight floor', () => {
    expect(ratingsWeight(2, 20)).toBe(0);
    expect(ratingsWeight(0, 0)).toBe(0);
  });

  test('ramps with the smaller sample and caps', () => {
    expect(ratingsWeight(4, 10)).toBeCloseTo(0.2, 10);
    expect(ratingsWeight(30, 30)).toBeCloseTo(0.35, 10);
  });
});

describe('blendProbabilities', () => {
  test('weight zero returns the market prior', () => {
    expect(blendProbabilities(0.62, 0.9, 0)).toBe(0.62);
    expect(blendProbabilities(0.62, null, 0.3)).toBe(0.62);
  });

  test('convex combination', () => {
    expect(blendProbabilities(0.6, 0.8, 0.25)).toBeCloseTo(0.65, 10);
  });
});

describe('extractBookPairs', () => {
  test('reads odds_cache style book rows with name matching', () => {
    const pairs = extractBookPairs(FIGHT);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ bookmaker: 'fanduel', homePrice: -520, awayPrice: 350 });
    expect(pairs[1]).toEqual({ bookmaker: 'draftkings', homePrice: -470, awayPrice: 360 });
  });

  test('falls back to the single book markets.h2h shape', () => {
    const pairs = extractBookPairs({
      home_team: 'Dustin Jacoby',
      away_team: 'Muhammad Said',
      markets: {
        h2h: [
          { name: 'Dustin Jacoby', price: -180 },
          { name: 'Muhammad Said', price: 150 },
        ],
      },
    });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].homePrice).toBe(-180);
  });

  test('drops books that do not price both named fighters', () => {
    const pairs = extractBookPairs({
      home_team: 'A',
      away_team: 'B',
      books: [{ bookmaker: 'dk', outcomes: [{ name: 'A', price: -150 }] }],
    });
    expect(pairs).toHaveLength(0);
  });
});

describe('computeUfcEdge, market only baseline', () => {
  test('returns the EdgeCalculator compatible shape', async () => {
    const result = await computeUfcEdge(FIGHT);
    expect(result).not.toBeNull();
    expect(Object.keys(result.edges).sort()).toEqual(
      ['away_ml', 'away_spread', 'home_ml', 'home_spread', 'over', 'under'].sort()
    );
    expect(result.edges.home_spread).toBeNull();
    expect(result.edges.away_spread).toBeNull();
    expect(result.edges.over).toBeNull();
    expect(result.edges.under).toBeNull();
    expect(result.homeWinProb + result.awayWinProb).toBeCloseTo(1, 6);
    expect(result.impliedHomeProb + result.impliedAwayProb).toBeCloseTo(1, 6);
    expect(Array.isArray(result.adjustments)).toBe(true);
    expect(['low', 'medium', 'high']).toContain(result.confidence);
    expect(result.modelMargin).toBeNull();
  });

  test('model prob is the cross book consensus and implied is the reference book', async () => {
    const result = await computeUfcEdge(FIGHT);
    const fd = devigTwoWay(-520, 350).probA;
    const dk = devigTwoWay(-470, 360).probA;
    expect(result.homeWinProb).toBeCloseTo((fd + dk) / 2, 3);
    // DraftKings is the default reference book.
    expect(result.impliedHomeProb).toBeCloseTo(dk, 3);
    expect(result.factors.marketConsensus.referenceBook).toBe('draftkings');
  });

  test('per side edges are equal magnitude and opposite sign', async () => {
    const result = await computeUfcEdge(FIGHT);
    expect(result.edges.home_ml).toBeCloseTo(-result.edges.away_ml, 6);
    expect(result.edgesRaw.home_ml).toBeCloseTo(-result.edgesRaw.away_ml, 6);
  });

  test('heavy favorite: market only edges stay small and probs stay sane', async () => {
    const result = await computeUfcEdge(FIGHT);
    expect(result.homeWinProb).toBeGreaterThan(0.7);
    expect(result.homeWinProb).toBeLessThan(0.9);
    // Two books close together cannot manufacture a publishable 2pp edge.
    expect(Math.abs(result.edges.home_ml)).toBeLessThan(0.02);
    expect(result.confidence).toBe('low');
    expect(result.dataQuality.hasRatings).toBe(false);
  });

  test('legacy edge scalars follow the larger magnitude side', async () => {
    const result = await computeUfcEdge(FIGHT);
    const bigger =
      Math.abs(result.edges.home_ml) >= Math.abs(result.edges.away_ml)
        ? result.edges.home_ml
        : result.edges.away_ml;
    expect(result.edge).toBeCloseTo(bigger, 6);
    expect(result.edgePercent).toBeCloseTo(Math.abs(bigger) * 100, 4);
    if (result.edge === result.edges.home_ml) {
      expect(result.edgeSide).toBe(result.edge >= 0 ? 'home' : 'away');
    }
  });

  test('null when no book prices both sides', async () => {
    expect(await computeUfcEdge({ home_team: 'A', away_team: 'B', books: [] })).toBeNull();
    expect(await computeUfcEdge({ home_team: 'A', away_team: 'B' })).toBeNull();
    expect(await computeUfcEdge(null)).toBeNull();
  });
});

describe('computeUfcEdge, ratings blend', () => {
  const provider = (map) => ({
    getFighter: async (name) => map[name] || null,
  });

  test('ratings above market push a positive home edge', async () => {
    const ratings = provider({
      'Umar Nurmagomedov': { rating: 1900, fights: 10 },
      'Song Yadong': { rating: 1500, fights: 12 },
    });
    const result = await computeUfcEdge(FIGHT, { ratings });
    // Elo says about 0.909, market consensus is about 0.80, so the blend
    // sits above the market and home shows value.
    expect(result.dataQuality.hasRatings).toBe(true);
    expect(result.factors.ratings.weight).toBeCloseTo(0.35, 6);
    expect(result.edges.home_ml).toBeGreaterThan(0.02);
    expect(result.edges.away_ml).toBeLessThan(-0.02);
    expect(result.edgeSide).toBe('home');
    expect(result.adjustments).toHaveLength(1);
    expect(result.confidence).toBe('medium');
  });

  test('ratings below market push value to the underdog side', async () => {
    const ratings = provider({
      'Umar Nurmagomedov': { rating: 1500, fights: 10 },
      'Song Yadong': { rating: 1600, fights: 12 },
    });
    const result = await computeUfcEdge(FIGHT, { ratings });
    expect(result.edges.away_ml).toBeGreaterThan(0);
    expect(result.edges.home_ml).toBeLessThan(0);
    expect(result.edgeSide).toBe('away');
  });

  test('thin samples zero the blend weight', async () => {
    const ratings = provider({
      'Umar Nurmagomedov': { rating: 1900, fights: 2 },
      'Song Yadong': { rating: 1500, fights: 12 },
    });
    const result = await computeUfcEdge(FIGHT, { ratings });
    expect(result.dataQuality.hasRatings).toBe(false);
    expect(result.factors.ratings.weight).toBe(0);
    expect(Math.abs(result.edges.home_ml)).toBeLessThan(0.02);
  });

  test('missing fighter falls back to market only', async () => {
    const ratings = provider({
      'Umar Nurmagomedov': { rating: 1900, fights: 10 },
    });
    const result = await computeUfcEdge(FIGHT, { ratings });
    expect(result).not.toBeNull();
    expect(result.factors.ratings).toBeNull();
    expect(result.dataQuality.hasRatings).toBe(false);
  });

  test('provider that throws never breaks the baseline', async () => {
    const ratings = {
      getFighter: async () => {
        throw new Error('ratings backend down');
      },
    };
    const result = await computeUfcEdge(FIGHT, { ratings });
    expect(result).not.toBeNull();
    expect(result.factors.ratings).toBeNull();
  });
});

describe('computeUfcEdge, calibration and caps', () => {
  test('calibration multiplier scales published edges but not raw edges', async () => {
    const ratings = {
      getFighter: async (name) =>
        name === 'Umar Nurmagomedov'
          ? { rating: 1700, fights: 10 }
          : { rating: 1500, fights: 10 },
    };
    const full = await computeUfcEdge(FIGHT, { ratings, calibrationMultiplier: 1 });
    const half = await computeUfcEdge(FIGHT, { ratings, calibrationMultiplier: 0.5 });
    expect(half.edges.home_ml).toBeCloseTo(full.edges.home_ml * 0.5, 3);
    expect(half.edgesRaw.home_ml).toBeCloseTo(full.edgesRaw.home_ml, 6);
  });

  test('published edge is hard capped at MAX_EDGE while raw keeps the full signal', async () => {
    const ratings = {
      getFighter: async (name) =>
        name === 'Song Yadong'
          ? { rating: 2400, fights: 20 }
          : { rating: 1200, fights: 20 },
    };
    const result = await computeUfcEdge(FIGHT, { ratings });
    expect(result.edges.away_ml).toBeCloseTo(MAX_EDGE, 6);
    expect(result.edgesRaw.away_ml).toBeGreaterThan(MAX_EDGE);
    expect(result.edges.home_ml).toBeCloseTo(-MAX_EDGE, 6);
  });

  test('win probability clamp leaves no certainties', async () => {
    const ratings = {
      getFighter: async (name) =>
        name === 'Umar Nurmagomedov'
          ? { rating: 4000, fights: 20 }
          : { rating: 1000, fights: 20 },
    };
    const result = await computeUfcEdge(FIGHT, { ratings });
    expect(result.homeWinProb).toBeLessThanOrEqual(0.98);
    expect(result.awayWinProb).toBeGreaterThanOrEqual(0.02);
  });
});
