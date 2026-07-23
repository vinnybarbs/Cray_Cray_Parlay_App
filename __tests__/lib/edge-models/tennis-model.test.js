// __tests__/lib/edge-models/tennis-model.test.js
//
// Pure math tests for the tennis edge model. No network, no Supabase.

'use strict';

const tm = require('../../../lib/services/edge-models/tennis-model');

const {
  calculateTennisEdge,
  booksFromOddsRows,
  americanToProb,
  devigMultiplicative,
  devigPower,
  median,
  consensusFromBooks,
  eloWinProb,
  effectiveElo,
  setProbFromBo3,
  bo5FromSetProb,
  bestOfAdjust,
  fatiguePenalty,
  MAX_EDGE,
} = tm;

describe('americanToProb', () => {
  test('negative prices', () => {
    expect(americanToProb(-180)).toBeCloseTo(180 / 280, 6);
    expect(americanToProb(-110)).toBeCloseTo(110 / 210, 6);
  });

  test('positive prices', () => {
    expect(americanToProb(150)).toBeCloseTo(0.4, 6);
    expect(americanToProb(100)).toBeCloseTo(0.5, 6);
  });

  test('junk input returns null', () => {
    expect(americanToProb(null)).toBeNull();
    expect(americanToProb('abc')).toBeNull();
    expect(americanToProb(0)).toBeNull();
  });
});

describe('devig', () => {
  test('multiplicative devig of a symmetric market is 50/50', () => {
    const p = americanToProb(-110);
    const fair = devigMultiplicative(p, p);
    expect(fair.home).toBeCloseTo(0.5, 6);
    expect(fair.home + fair.away).toBeCloseTo(1, 10);
  });

  test('multiplicative devig preserves the ratio', () => {
    const rawHome = americanToProb(-200); // 0.6667
    const rawAway = americanToProb(160);  // 0.3846
    const fair = devigMultiplicative(rawHome, rawAway);
    expect(fair.home / fair.away).toBeCloseTo(rawHome / rawAway, 6);
    expect(fair.home + fair.away).toBeCloseTo(1, 10);
  });

  test('power devig of a symmetric market is 50/50', () => {
    const p = americanToProb(-110);
    const fair = devigPower(p, p);
    expect(fair.home).toBeCloseTo(0.5, 6);
    expect(fair.home + fair.away).toBeCloseTo(1, 10);
  });

  test('power devig sums to 1 on a lopsided market', () => {
    const fair = devigPower(americanToProb(-529), americanToProb(384));
    expect(fair.home + fair.away).toBeCloseTo(1, 8);
    expect(fair.home).toBeGreaterThan(0.5);
  });

  test('power devig gives the longshot less than multiplicative does', () => {
    // Favorite-longshot correction: more of the vig comes off the longshot.
    const rawHome = americanToProb(-529);
    const rawAway = americanToProb(384);
    const power = devigPower(rawHome, rawAway);
    const mult = devigMultiplicative(rawHome, rawAway);
    expect(power.away).toBeLessThan(mult.away);
    expect(power.home).toBeGreaterThan(mult.home);
  });

  test('devig returns null on missing prices', () => {
    expect(devigMultiplicative(null, 0.5)).toBeNull();
    expect(devigPower(null, 0.5)).toBeNull();
  });
});

describe('median', () => {
  test('odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBeCloseTo(2.5, 10);
    expect(median([])).toBeNull();
  });
});

describe('consensusFromBooks', () => {
  const books = [
    { bookmaker: 'draftkings', home_price: -150, away_price: 130 },
    { bookmaker: 'fanduel', home_price: -145, away_price: 125 },
    { bookmaker: 'caesars', home_price: -160, away_price: 135 },
  ];

  test('uses the median fair probability across books', () => {
    const c = consensusFromBooks(books, { devigMethod: 'multiplicative' });
    expect(c.booksUsed).toBe(3);
    const fairs = books
      .map((b) => devigMultiplicative(americanToProb(b.home_price), americanToProb(b.away_price)).home)
      .sort((a, b) => a - b);
    expect(c.homeProb).toBeCloseTo(fairs[1], 10);
    expect(c.homeProb + c.awayProb).toBeCloseTo(1, 10);
  });

  test('skips books missing a side', () => {
    const c = consensusFromBooks([
      { bookmaker: 'draftkings', home_price: -150, away_price: null },
      { bookmaker: 'fanduel', home_price: -145, away_price: 125 },
    ]);
    expect(c.booksUsed).toBe(1);
    expect(c.perBook[0].bookmaker).toBe('fanduel');
  });

  test('returns null when no book is usable', () => {
    expect(consensusFromBooks([])).toBeNull();
    expect(consensusFromBooks([{ bookmaker: 'x', home_price: null, away_price: null }])).toBeNull();
  });
});

describe('Elo math', () => {
  test('equal ratings give 0.5', () => {
    expect(eloWinProb(1800, 1800)).toBeCloseTo(0.5, 10);
  });

  test('a 100 point gap gives about 64 percent', () => {
    expect(eloWinProb(1900, 1800)).toBeCloseTo(0.64, 2);
    expect(eloWinProb(1800, 1900)).toBeCloseTo(0.36, 2);
  });

  test('effectiveElo blends overall and surface ratings evenly by default', () => {
    expect(effectiveElo({ elo: 2000, surfaceElo: 1900 })).toBeCloseTo(1950, 6);
  });

  test('effectiveElo falls back to overall when surface is missing', () => {
    expect(effectiveElo({ elo: 2000, surfaceElo: null })).toBe(2000);
    expect(effectiveElo(null)).toBeNull();
  });
});

describe('best-of format transform', () => {
  test('set prob inversion round-trips through the best-of-3 formula', () => {
    for (const m of [0.3, 0.5, 0.6, 0.85]) {
      const s = setProbFromBo3(m);
      expect(s * s * (3 - 2 * s)).toBeCloseTo(m, 6);
    }
  });

  test('coin flip stays a coin flip in any format', () => {
    expect(bestOfAdjust(0.5, 5)).toBeCloseTo(0.5, 6);
    expect(bestOfAdjust(0.5, 3)).toBeCloseTo(0.5, 10);
  });

  test('best of 5 amplifies the favorite and shrinks the underdog', () => {
    expect(bestOfAdjust(0.7, 5)).toBeGreaterThan(0.7);
    expect(bestOfAdjust(0.3, 5)).toBeLessThan(0.3);
  });

  test('best of 3 is a pass-through', () => {
    expect(bestOfAdjust(0.7, 3)).toBe(0.7);
  });

  test('bo5FromSetProb bounds', () => {
    expect(bo5FromSetProb(0)).toBe(0);
    expect(bo5FromSetProb(1)).toBeCloseTo(1, 10);
  });
});

describe('fatiguePenalty', () => {
  test('no penalty inside the free allowance or when data is missing', () => {
    expect(fatiguePenalty(3)).toBe(0);
    expect(fatiguePenalty(4)).toBe(0);
    expect(fatiguePenalty(null)).toBe(0);
    expect(fatiguePenalty(undefined)).toBe(0);
  });

  test('scales past the allowance and caps', () => {
    expect(fatiguePenalty(6)).toBeCloseTo(0.01, 10);
    expect(fatiguePenalty(20)).toBeCloseTo(0.02, 10);
  });
});

describe('booksFromOddsRows', () => {
  test('extracts h2h prices per bookmaker and skips other markets', () => {
    const rows = [
      {
        bookmaker: 'draftkings',
        market_type: 'h2h',
        outcomes: [
          { name: 'Jannik Sinner', price: -529 },
          { name: 'Alexander Zverev', price: 384 },
        ],
      },
      {
        bookmaker: 'fanduel',
        market_type: 'h2h',
        outcomes: [
          { name: 'Jannik Sinner', price: -510 },
          { name: 'Alexander Zverev', price: 395 },
        ],
      },
      { bookmaker: 'draftkings', market_type: 'totals', outcomes: [{ name: 'Over', price: -110, point: 38.5 }] },
      { bookmaker: 'caesars', market_type: 'h2h', outcomes: [{ name: 'Jannik Sinner', price: -520 }] },
    ];
    const books = booksFromOddsRows(rows, 'Jannik Sinner', 'Alexander Zverev');
    expect(books).toHaveLength(2);
    expect(books[0]).toEqual({ bookmaker: 'draftkings', home_price: -529, away_price: 384 });
    expect(books[1].bookmaker).toBe('fanduel');
  });

  test('handles junk input', () => {
    expect(booksFromOddsRows(null, 'A', 'B')).toEqual([]);
  });
});

describe('calculateTennisEdge, market-only baseline', () => {
  const context = (books) => ({
    home_player: 'Player A',
    away_player: 'Player B',
    books,
  });

  test('returns null with no usable books', async () => {
    expect(await calculateTennisEdge(context([]))).toBeNull();
    expect(await calculateTennisEdge(null)).toBeNull();
    expect(await calculateTennisEdge({ home_player: 'A', away_player: 'B' })).toBeNull();
  });

  test('single book yields zero edge, model equals the bet book', async () => {
    const result = await calculateTennisEdge(
      context([{ bookmaker: 'draftkings', home_price: -150, away_price: 130 }])
    );
    expect(result).not.toBeNull();
    expect(result.edges.home_ml).toBeCloseTo(0, 6);
    expect(result.edges.away_ml).toBeCloseTo(0, 6);
    expect(result.homeWinProb).toBeCloseTo(result.impliedHomeProb, 4);
    expect(result.confidence).toBe('low');
  });

  test('bet book off consensus produces a positive edge on the cheap side', async () => {
    // DraftKings prices the home side cheaper than the other two books.
    const result = await calculateTennisEdge(
      context([
        { bookmaker: 'fanduel', home_price: -150, away_price: 130 },
        { bookmaker: 'caesars', home_price: -145, away_price: 125 },
        { bookmaker: 'draftkings', home_price: -120, away_price: 100 },
      ]),
      { devigMethod: 'multiplicative' }
    );
    expect(result.edges.home_ml).toBeGreaterThan(0);
    expect(result.edges.away_ml).toBeCloseTo(-result.edges.home_ml, 4);
    expect(result.edgeSide).toBe('home');
    expect(result.dataQuality.betBookmaker).toBe('draftkings');
    expect(result.dataQuality.booksUsed).toBe(3);
  });

  test('edge sign convention: positive means value, negative means trap', async () => {
    // DraftKings overprices home relative to consensus, so home is the trap.
    const result = await calculateTennisEdge(
      context([
        { bookmaker: 'fanduel', home_price: -120, away_price: 100 },
        { bookmaker: 'caesars', home_price: -125, away_price: 105 },
        { bookmaker: 'draftkings', home_price: -170, away_price: 145 },
      ]),
      { devigMethod: 'multiplicative' }
    );
    expect(result.edges.home_ml).toBeLessThan(0);
    expect(result.edges.away_ml).toBeGreaterThan(0);
  });

  test('spread and total slots exist and stay null in phase 1', async () => {
    const result = await calculateTennisEdge(
      context([{ bookmaker: 'draftkings', home_price: -150, away_price: 130 }])
    );
    expect(result.edges.home_spread).toBeNull();
    expect(result.edges.away_spread).toBeNull();
    expect(result.edges.over).toBeNull();
    expect(result.edges.under).toBeNull();
  });

  test('calibration multiplier scales edges and the cap holds', async () => {
    const books = [
      { bookmaker: 'fanduel', home_price: -150, away_price: 130 },
      { bookmaker: 'draftkings', home_price: -110, away_price: -110 },
    ];
    const base = await calculateTennisEdge(context(books), { devigMethod: 'multiplicative' });
    const scaled = await calculateTennisEdge(context(books), {
      devigMethod: 'multiplicative',
      calibrationMultiplier: 0.5,
    });
    // Precision 3 because stored edges are rounded to 4 decimals.
    expect(scaled.edges.home_ml).toBeCloseTo(base.edges.home_ml * 0.5, 3);
    // Raw edges are stored uncalibrated.
    expect(scaled.edgesRaw.home_ml).toBeCloseTo(base.edgesRaw.home_ml, 4);

    const capped = await calculateTennisEdge(context(books), {
      devigMethod: 'multiplicative',
      calibrationMultiplier: 100,
    });
    expect(Math.abs(capped.edges.home_ml)).toBeLessThanOrEqual(MAX_EDGE);
  });
});

describe('calculateTennisEdge, Elo blend', () => {
  const books = [
    { bookmaker: 'draftkings', home_price: -150, away_price: 130 },
    { bookmaker: 'fanduel', home_price: -150, away_price: 130 },
  ];

  const makeProvider = (map) => ({
    getRating: async ({ name }) => map[name] || null,
  });

  test('ratings for both players pull the model toward Elo', async () => {
    const marketOnly = await calculateTennisEdge({
      home_player: 'A', away_player: 'B', books,
    });
    const withElo = await calculateTennisEdge(
      { home_player: 'A', away_player: 'B', books, surface: 'clay', tour: 'atp' },
      {
        ratings: makeProvider({
          A: { elo: 2100, surfaceElo: 2150 },
          B: { elo: 1900, surfaceElo: 1850 },
        }),
      }
    );
    // Elo says A is a much bigger favorite than the market does.
    expect(withElo.homeWinProb).toBeGreaterThan(marketOnly.homeWinProb);
    expect(withElo.edges.home_ml).toBeGreaterThan(0);
    expect(withElo.dataQuality.hasRatings).toBe(true);
    expect(withElo.dataQuality.hasSurfaceRatings).toBe(true);
    expect(withElo.factors.elo).not.toBeNull();
  });

  test('missing ratings degrade cleanly to the market-only result', async () => {
    const marketOnly = await calculateTennisEdge({ home_player: 'A', away_player: 'B', books });
    const oneMissing = await calculateTennisEdge(
      { home_player: 'A', away_player: 'B', books },
      { ratings: makeProvider({ A: { elo: 2100, surfaceElo: null } }) }
    );
    expect(oneMissing.homeWinProb).toBeCloseTo(marketOnly.homeWinProb, 6);
    expect(oneMissing.dataQuality.hasRatings).toBe(false);
    expect(oneMissing.factors.elo).toBeNull();
  });

  test('a throwing provider never breaks the baseline', async () => {
    const result = await calculateTennisEdge(
      { home_player: 'A', away_player: 'B', books },
      { ratings: { getRating: () => { throw new Error('ratings service down'); } } }
    );
    expect(result).not.toBeNull();
    expect(result.dataQuality.hasRatings).toBe(false);
  });

  test('best of 5 moves the Elo favorite further than best of 3', async () => {
    const provider = makeProvider({
      A: { elo: 2100, surfaceElo: null },
      B: { elo: 1900, surfaceElo: null },
    });
    const bo3 = await calculateTennisEdge(
      { home_player: 'A', away_player: 'B', books, best_of: 3 },
      { ratings: provider }
    );
    const bo5 = await calculateTennisEdge(
      { home_player: 'A', away_player: 'B', books, best_of: 5 },
      { ratings: provider }
    );
    expect(bo5.homeWinProb).toBeGreaterThan(bo3.homeWinProb);
    expect(bo5.factors.bestOf).toBe(5);
  });

  test('fatigue on the favorite trims the Elo signal', async () => {
    const fresh = await calculateTennisEdge(
      { home_player: 'A', away_player: 'B', books },
      {
        ratings: makeProvider({
          A: { elo: 2100, surfaceElo: null, matchesLast14: 2 },
          B: { elo: 1900, surfaceElo: null, matchesLast14: 2 },
        }),
      }
    );
    const tired = await calculateTennisEdge(
      { home_player: 'A', away_player: 'B', books },
      {
        ratings: makeProvider({
          A: { elo: 2100, surfaceElo: null, matchesLast14: 9 },
          B: { elo: 1900, surfaceElo: null, matchesLast14: 2 },
        }),
      }
    );
    expect(tired.homeWinProb).toBeLessThan(fresh.homeWinProb);
    expect(tired.adjustments.some((a) => a.factor.startsWith('Fatigue'))).toBe(true);
  });
});

describe('compatibility with the existing edge pipeline', () => {
  test('pickBestSide from edge-calculator reads the tennis result unchanged', async () => {
    const { EdgeCalculator } = require('../../../lib/services/edge-calculator');
    const calc = new EdgeCalculator(null); // pickBestSide never touches supabase

    const result = await calculateTennisEdge(
      {
        home_player: 'A',
        away_player: 'B',
        books: [
          { bookmaker: 'fanduel', home_price: -170, away_price: 145 },
          { bookmaker: 'caesars', home_price: -165, away_price: 140 },
          { bookmaker: 'draftkings', home_price: -125, away_price: 105 },
        ],
      },
      { devigMethod: 'multiplicative' }
    );

    const best = calc.pickBestSide(result);
    expect(best).not.toBeNull();
    expect(best.side).toBe('home_ml');
    expect(best.signedEdge).toBeCloseTo(result.edges.home_ml, 6);
  });

  test('edgeTier from pick-grader maps the tennis edge to a tier', async () => {
    const { edgeTier } = require('../../../lib/services/pick-grader');
    const result = await calculateTennisEdge({
      home_player: 'A',
      away_player: 'B',
      books: [{ bookmaker: 'draftkings', home_price: -150, away_price: 130 }],
    });
    // Zero edge falls in the Skip band, exactly what a lone-book match deserves.
    expect(edgeTier(result.edges.home_ml * 100)).toBe('Skip');
  });
});
