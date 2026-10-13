// Line shopping (build_queue 105, owner 2026-10-13: "pick your book"
// means line shopping). For a published pick, the price every book we
// store offers on that exact side and line, the best of them, and the
// whole market's no-vig probability. Names the book, never links to it
// (directive 27). The read itself never changes here: this is display.

// The five books the owner named, in the order the chips show them.
const SHOP_BOOKS = ['draftkings', 'fanduel', 'betmgm', 'betrivers', 'fanatics'];
const BOOK_NAME = {
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
  betmgm: 'BetMGM',
  betrivers: 'BetRivers',
  fanatics: 'Fanatics',
};
// Fewer than this many books quoting the line is not a shop.
const MIN_BOOKS = 2;

function rawImplied(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || Math.abs(n) < 100) return null;
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

// What a 1 unit stake returns in profit. Higher is a better price.
function payout(american) {
  const n = Number(american);
  return n > 0 ? n / 100 : 100 / -n;
}

const samePoint = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-9;

/**
 * The odds_cache side a published pick names. Pick text is written by
 * the digest as "Team ML -150", "Team +1.5" or "Over 6.5". Null when the
 * text does not parse. Pure.
 */
function parsePick(pick, betType) {
  const text = String(pick || '').trim();
  const type = String(betType || '').toLowerCase();
  let m;
  if (type === 'total' || /^(over|under)\s/i.test(text)) {
    m = text.match(/^(over|under)\s+(\d+(?:\.\d+)?)/i);
    if (!m) return null;
    const side = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    return { market: 'totals', name: side, point: Number(m[2]) };
  }
  if (type === 'moneyline' || /\sML(\s|$)/.test(text)) {
    m = text.match(/^(.+?)\s+ML(?:\s|$)/);
    return m ? { market: 'h2h', name: m[1].trim(), point: null } : null;
  }
  if (type === 'spread') {
    m = text.match(/^(.+?)\s+([+-]\d+(?:\.\d+)?)(?:\s|$)/);
    return m ? { market: 'spreads', name: m[1].trim(), point: Number(m[2]) } : null;
  }
  return null;
}

/**
 * Shop one parsed side across odds_cache rows for its game, one row per
 * (book, market). Returns { books, best, marketPct } or null when fewer
 * than MIN_BOOKS of the five quote that exact side and line.
 *  books: [{ key, name, price }] in SHOP_BOOKS order
 *  best:  { keys, names, price } (ties share the best price)
 *  marketPct: the side's no-vig probability averaged across those books,
 *             one decimal, so a card can set it next to "Book says". Pure.
 */
function shopSide(rows, parsed) {
  if (!parsed) return null;
  const byBook = new Map();
  for (const r of rows || []) {
    if (r.market_type !== parsed.market || !SHOP_BOOKS.includes(r.bookmaker)) continue;
    const outs = Array.isArray(r.outcomes) ? r.outcomes : [];
    const own = outs.find(o => o && o.name === parsed.name
      && (parsed.point == null || samePoint(o.point, parsed.point)));
    const price = own ? Number(own.price) : null;
    const p = rawImplied(price);
    if (p == null) continue;
    // No-vig: this side's implied over the book's whole market at this
    // line (two way for spreads and totals, three way where a draw is
    // offered). A side without its opposite quoted counts no probability.
    const peers = parsed.market === 'h2h'
      ? outs
      : outs.filter(o => o && (o === own || (o.name !== parsed.name
        && samePoint(o.point, parsed.market === 'totals' ? parsed.point : -parsed.point))));
    const total = peers.reduce((s, o) => s + (rawImplied(o.price) || 0), 0);
    const noVig = peers.length >= 2 && total > p ? p / total : null;
    byBook.set(r.bookmaker, { price, noVig });
  }
  if (byBook.size < MIN_BOOKS) return null;
  const books = SHOP_BOOKS.filter(k => byBook.has(k)).map(k => ({ key: k, name: BOOK_NAME[k], price: byBook.get(k).price }));
  const bestPay = Math.max(...books.map(b => payout(b.price)));
  const top = books.filter(b => Math.abs(payout(b.price) - bestPay) < 1e-9);
  const probs = [...byBook.values()].map(v => v.noVig).filter(v => v != null);
  return {
    books,
    best: { keys: top.map(b => b.key), names: top.map(b => b.name), price: top[0].price },
    marketPct: probs.length > 0 ? Math.round((probs.reduce((a, b) => a + b, 0) / probs.length) * 1000) / 10 : null,
  };
}

/**
 * Attach `shop` to every pick in `picks` that carries odds_event_id,
 * pick and bet_type, with one odds_cache read for all of them. A failed
 * read leaves the picks untouched: the shop is never load bearing.
 */
async function attachShop(supabase, picks) {
  const list = (picks || []).filter(p => p && p.odds_event_id && p.pick);
  const ids = [...new Set(list.map(p => p.odds_event_id))];
  if (ids.length === 0) return picks;
  try {
    const rows = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase
        .from('odds_cache')
        .select('external_game_id, bookmaker, market_type, outcomes')
        .in('external_game_id', ids.slice(i, i + 200))
        .in('bookmaker', SHOP_BOOKS);
      if (error) return picks;
      rows.push(...(data || []));
    }
    const byEvent = new Map();
    for (const r of rows) {
      if (!byEvent.has(r.external_game_id)) byEvent.set(r.external_game_id, []);
      byEvent.get(r.external_game_id).push(r);
    }
    for (const p of list) {
      p.shop = shopSide(byEvent.get(p.odds_event_id), parsePick(p.pick, p.bet_type));
    }
  } catch (_) {
    return picks;
  }
  return picks;
}

/**
 * Shop a prop read across the five books at the read's own line, from
 * player_props rows for the same player, market and kickoff. Same shape
 * as shopSide; no market percent (the read's own anchor already is the
 * consensus). Pure.
 */
function shopProp(rows, read) {
  if (!read || read.line == null) return null;
  const isTd = read.market === 'player_anytime_td';
  const byBook = new Map();
  for (const r of rows || []) {
    if (!SHOP_BOOKS.includes(r.bookmaker) || r.player_key !== read.playerKey || r.market !== read.market) continue;
    if (read.commence_time && r.commence_time
      && new Date(r.commence_time).getTime() !== new Date(read.commence_time).getTime()) continue;
    if (!isTd && !samePoint(r.line, read.line)) continue;
    const price = Number(isTd ? r.yes_price : read.side === 'over' ? r.over_price : r.under_price);
    if (rawImplied(price) == null) continue;
    byBook.set(r.bookmaker, price);
  }
  if (byBook.size < MIN_BOOKS) return null;
  const books = SHOP_BOOKS.filter(k => byBook.has(k)).map(k => ({ key: k, name: BOOK_NAME[k], price: byBook.get(k) }));
  const bestPay = Math.max(...books.map(b => payout(b.price)));
  const top = books.filter(b => Math.abs(payout(b.price) - bestPay) < 1e-9);
  return { books, best: { keys: top.map(b => b.key), names: top.map(b => b.name), price: top[0].price }, marketPct: null };
}

module.exports = { SHOP_BOOKS, BOOK_NAME, parsePick, shopSide, shopProp, attachShop };
