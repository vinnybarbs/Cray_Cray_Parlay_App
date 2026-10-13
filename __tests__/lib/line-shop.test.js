const { parsePick, shopSide, shopProp, attachShop } = require('../../lib/services/line-shop.js');

// Real odds_cache rows, Hurricanes at Capitals 2026-10-13, trimmed.
const ROWS = [
  { bookmaker: 'betmgm', market_type: 'h2h', outcomes: [{ name: 'Carolina Hurricanes', price: -160 }, { name: 'Washington Capitals', price: 135 }] },
  { bookmaker: 'betrivers', market_type: 'h2h', outcomes: [{ name: 'Carolina Hurricanes', price: -152 }, { name: 'Washington Capitals', price: 128 }] },
  { bookmaker: 'draftkings', market_type: 'h2h', outcomes: [{ name: 'Carolina Hurricanes', price: -162 }, { name: 'Washington Capitals', price: 136 }] },
  { bookmaker: 'bovada', market_type: 'h2h', outcomes: [{ name: 'Carolina Hurricanes', price: -110 }, { name: 'Washington Capitals', price: -110 }] },
  { bookmaker: 'draftkings', market_type: 'spreads', outcomes: [{ name: 'Carolina Hurricanes', point: -1.5, price: 160 }, { name: 'Washington Capitals', point: 1.5, price: -192 }] },
  { bookmaker: 'fanduel', market_type: 'spreads', outcomes: [{ name: 'Carolina Hurricanes', point: -1.5, price: 148 }, { name: 'Washington Capitals', point: 1.5, price: -188 }] },
  { bookmaker: 'betmgm', market_type: 'totals', outcomes: [{ name: 'Over', point: 6, price: -120 }, { name: 'Under', point: 6, price: 100 }] },
  { bookmaker: 'draftkings', market_type: 'totals', outcomes: [{ name: 'Over', point: 6.5, price: 105 }, { name: 'Under', point: 6.5, price: -125 }] },
  { bookmaker: 'fanatics', market_type: 'totals', outcomes: [{ name: 'Over', point: 6.5, price: 105 }, { name: 'Under', point: 6.5, price: -125 }] },
];

describe('parsePick', () => {
  test('reads the three digest pick shapes', () => {
    expect(parsePick('Carolina Hurricanes ML -162', 'Moneyline')).toEqual({ market: 'h2h', name: 'Carolina Hurricanes', point: null });
    expect(parsePick('Washington Capitals +1.5', 'Spread')).toEqual({ market: 'spreads', name: 'Washington Capitals', point: 1.5 });
    expect(parsePick('Over 6.5', 'Total')).toEqual({ market: 'totals', name: 'Over', point: 6.5 });
    expect(parsePick('something odd', 'Prop')).toBeNull();
  });
});

describe('shopSide', () => {
  test('moneyline: best price is the cheapest favorite, other books ignored', () => {
    const s = shopSide(ROWS, parsePick('Carolina Hurricanes ML -162', 'Moneyline'));
    expect(s.books.map(b => b.key)).toEqual(['draftkings', 'betmgm', 'betrivers']);
    expect(s.best).toEqual({ keys: ['betrivers'], names: ['BetRivers'], price: -152 });
    expect(s.marketPct).toBeGreaterThan(57);
    expect(s.marketPct).toBeLessThan(60);
  });

  test('spread: matches the pick line and its opposite for no-vig', () => {
    const s = shopSide(ROWS, parsePick('Carolina Hurricanes -1.5', 'Spread'));
    expect(s.best.price).toBe(160);
    expect(s.best.names).toEqual(['DraftKings']);
    expect(s.marketPct).toBeGreaterThan(30);
    expect(s.marketPct).toBeLessThan(45);
  });

  test('total: a book on a different line is left out, ties share best', () => {
    const s = shopSide(ROWS, parsePick('Over 6.5', 'Total'));
    expect(s.books.map(b => b.key)).toEqual(['draftkings', 'fanatics']);
    expect(s.best.keys).toEqual(['draftkings', 'fanatics']);
  });

  test('one book quoting is not a shop', () => {
    expect(shopSide(ROWS.slice(0, 1), parsePick('Carolina Hurricanes ML -162', 'Moneyline'))).toBeNull();
  });
});

describe('shopProp', () => {
  const when = '2026-10-19T17:00:00Z';
  const rows = [
    { bookmaker: 'draftkings', player_key: 'a b', market: 'player_receptions', line: '4.5', over_price: -120, under_price: -105, commence_time: when },
    { bookmaker: 'fanduel', player_key: 'a b', market: 'player_receptions', line: '4.5', over_price: -110, under_price: -115, commence_time: when },
    { bookmaker: 'fanduel', player_key: 'a b', market: 'player_receptions', line: '5.5', over_price: 120, under_price: -150, commence_time: when },
    { bookmaker: 'bovada', player_key: 'a b', market: 'player_receptions', line: '4.5', over_price: 100, under_price: -130, commence_time: when },
  ];
  test('same line only, the five books only', () => {
    const s = shopProp(rows, { playerKey: 'a b', market: 'player_receptions', line: 4.5, side: 'over', commence_time: when });
    expect(s.books).toEqual([
      { key: 'draftkings', name: 'DraftKings', price: -120 },
      { key: 'fanduel', name: 'FanDuel', price: -110 },
    ]);
    expect(s.best.names).toEqual(['FanDuel']);
  });
});

describe('attachShop', () => {
  test('one odds_cache read, shop lands on each pick', async () => {
    const calls = [];
    const q = {
      select() { return q; },
      in(col, vals) { calls.push([col, vals]); return q; },
      then(resolve) { resolve({ data: ROWS.map(r => ({ ...r, external_game_id: 'e1' })), error: null }); },
    };
    const supabase = { from: (t) => { calls.push(['from', t]); return q; } };
    const picks = [{ odds_event_id: 'e1', pick: 'Over 6.5', bet_type: 'Total' }, { pick: 'No event' }];
    await attachShop(supabase, picks);
    expect(calls[0]).toEqual(['from', 'odds_cache']);
    expect(picks[0].shop.books).toHaveLength(2);
    expect(picks[1].shop).toBeUndefined();
  });

  test('a failed read leaves picks alone', async () => {
    const supabase = { from: () => { throw new Error('down'); } };
    const picks = [{ odds_event_id: 'e1', pick: 'Over 6.5', bet_type: 'Total' }];
    await expect(attachShop(supabase, picks)).resolves.toBe(picks);
    expect(picks[0].shop).toBeUndefined();
  });
});
