/**
 * Publish markets: which (sport, market) pairs reach the graded record.
 *
 * Until 2026-09-13 publication was a code constant, SHADOW_SPORTS, that
 * shadowed a whole sport. The shadow ledger judges per MARKET (NCAAF
 * moneylines were 40 reads from the go-live bar while NCAAF spreads
 * closed against us), so the gate is now three dials per sport on the
 * dial board, publish_ml, publish_spread, publish_total, 1 or 0. The
 * daily promote_ready_markets() routine flips a dial to 1 the morning a
 * market clears the bar (directive 20); a mute is the market's
 * multiplier at 0 and stays a separate control.
 *
 * Fail-soft is CONSERVATIVE: if the dial board cannot be read, the code
 * mirror of the shadow list still withholds those sports, so a database
 * blip never publishes a shadow sport.
 */

'use strict';

const CODE_SHADOW_SPORTS = new Set(['EPL', 'MLS', 'Soccer', 'World Cup', 'Champions League', 'Copa America', 'Euros', 'NCAAF']);
const MARKETS = ['ml', 'spread', 'total'];
const DIAL_NAMES = MARKETS.map(m => `publish_${m}`);
const TTL_MS = 10 * 60 * 1000;

let _cache = { at: 0, rows: null };

/** 'ml' | 'spread' | 'total' | null for a side key. The soccer draw is a moneyline side. */
function marketOfSide(side) {
  if (side == null) return null;
  const s = String(side);
  if (s === 'home_ml' || s === 'away_ml' || s === 'draw') return 'ml';
  if (s === 'home_spread' || s === 'away_spread') return 'spread';
  if (s === 'over' || s === 'under') return 'total';
  return null;
}

/** Pure: flags for a sport from dial rows, sport row over __all__ over the code default. */
function flagsFromRows(rows, sport) {
  const codeDefault = CODE_SHADOW_SPORTS.has(sport) ? 0 : 1;
  const out = {};
  for (const m of MARKETS) {
    const dial = `publish_${m}`;
    const s = (rows || []).find(r => r.sport === sport && r.dial === dial);
    const a = (rows || []).find(r => r.sport === '__all__' && r.dial === dial);
    const v = s != null ? Number(s.value) : (a != null && !CODE_SHADOW_SPORTS.has(sport) ? Number(a.value) : codeDefault);
    out[m] = Number.isFinite(v) && v >= 1 ? 1 : 0;
  }
  return out;
}

async function loadRows(supabase) {
  if (_cache.rows && Date.now() - _cache.at < TTL_MS) return _cache.rows;
  try {
    const res = await supabase.from('sport_dials').select('sport, dial, value').in('dial', DIAL_NAMES);
    const rows = Array.isArray(res?.data) ? res.data : null;
    if (rows) _cache = { at: Date.now(), rows };
    return rows || _cache.rows || [];
  } catch {
    return _cache.rows || [];
  }
}

/** { ml, spread, total } for a sport, each 1 or 0. */
async function publishFlags(supabase, sport) {
  const rows = await loadRows(supabase);
  return flagsFromRows(rows, sport);
}

/** True when the market of this side reaches the record for this sport. */
async function marketPublishOpen(supabase, sport, side) {
  const market = marketOfSide(side);
  if (!market) return false;
  const flags = await publishFlags(supabase, sport);
  return flags[market] === 1;
}

/** True when no market of the sport publishes (whole-sport shadow). */
async function sportIsShadow(supabase, sport) {
  const flags = await publishFlags(supabase, sport);
  return MARKETS.every(m => flags[m] === 0);
}

/** Flags for every sport that has a row, plus the code shadow list. */
async function publishFlagsAll(supabase) {
  const rows = await loadRows(supabase);
  const sports = new Set([...CODE_SHADOW_SPORTS, ...(rows || []).map(r => r.sport).filter(s => s && s !== '__all__')]);
  const out = {};
  for (const s of sports) out[s] = flagsFromRows(rows, s);
  return out;
}

function _resetCache() { _cache = { at: 0, rows: null }; }

module.exports = { marketOfSide, flagsFromRows, publishFlags, marketPublishOpen, sportIsShadow, publishFlagsAll, _resetCache, CODE_SHADOW_SPORTS, MARKETS };
