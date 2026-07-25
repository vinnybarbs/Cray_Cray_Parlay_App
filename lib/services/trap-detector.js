// Trap Detector
//
// A Trap is NOT the mirror of our pick. It is a side that a casual bettor
// would be drawn to on surface signals (the lure) while the model prices it
// at -2pp or worse (the math). Both conditions must hold:
//
//   trap = lureScore >= LURE_MIN  AND  side edge <= -2pp
//
// A side that is merely overpriced but that nobody would be tempted by is
// just a bad bet, not a trap, and gets no callout. This is what makes trap
// tiles carry information instead of restating the pick backwards.
//
// Lure signals are built only from data we actually have (odds, records,
// streaks, form). We have no public betting percentages, so the lure is a
// proxy for square attention: chalk, hot streaks, home teams, juicy dogs,
// and Overs on high totals. Weights live in one table below so they can be
// recalibrated against settled trap outcomes once enough accumulate.
// Design notes: docs/models/trap-detector.md

const LURE_MIN = 25;
const TRAP_EDGE_MAX_PP = -2; // unified Trap boundary (commit 04895b1)

// Sport median totals, used to judge whether an Over sits on a high line
// that draws square money. Rough medians are fine, the signal is coarse.
const SPORT_MEDIAN_TOTAL = {
  MLB: 8.5, NBA: 224.5, NFL: 44.5, NHL: 6, NCAAB: 140.5, NCAAF: 55.5,
};

function impliedProbFromAmerican(price) {
  if (price == null || Number.isNaN(Number(price))) return null;
  const n = Number(price);
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

// "W5" / "L3" / "Won 4" style strings from standings or rank context.
function parseStreak(streak) {
  if (!streak || typeof streak !== 'string') return null;
  const m = streak.trim().match(/^(W|L|Won|Lost)\s*(\d+)/i);
  if (!m) return null;
  const dir = m[1][0].toUpperCase() === 'W' ? 'W' : 'L';
  return { dir, len: parseInt(m[2], 10) };
}

// "8-2" style last-10 record strings.
function parseLastN(rec) {
  if (!rec || typeof rec !== 'string') return null;
  const m = rec.trim().match(/^(\d+)\s*-\s*(\d+)/);
  if (!m) return null;
  return { wins: parseInt(m[1], 10), losses: parseInt(m[2], 10) };
}

// Per-side lure signals. Each returns { key, label, pts } or null.
function teamSideSignals({ isHome, teamName, mlPrice, record, form, standing }) {
  const signals = [];

  // Chalk: implied ML prob 60%+ pulls square money regardless of price.
  const p = impliedProbFromAmerican(mlPrice);
  if (p != null && p >= 0.6) {
    const pts = Math.min(30, Math.round(15 + (p - 0.6) * 150));
    signals.push({ key: 'chalk', pts, label: `heavy favorite (${Math.round(p * 100)}% implied)` });
  }

  // Hot streak: recency bias is the classic trap fuel.
  const st = parseStreak(standing?.streak);
  if (st && st.dir === 'W' && st.len >= 3) {
    const pts = st.len >= 5 ? 20 : st.len === 4 ? 15 : 10;
    signals.push({ key: 'streak', pts, label: `won ${st.len} straight` });
  }

  // Hot form: strong last-10 (or last-5 win pct when last-10 is absent).
  const l10 = parseLastN(standing?.last_10);
  if (l10 && l10.wins >= 7) {
    signals.push({ key: 'form', pts: l10.wins >= 8 ? 20 : 15, label: `${l10.wins}-${l10.losses} last 10` });
  } else if (!l10 && form?.winPct != null && form.winPct >= 0.7) {
    signals.push({ key: 'form', pts: 10, label: 'hot recent form' });
  }

  // Home team: the default square lean.
  if (isHome) signals.push({ key: 'home', pts: 8, label: 'home side' });

  // Juicy dog: a winning team at plus money reads like free value.
  if (mlPrice != null && Number(mlPrice) >= 100 && Number(mlPrice) <= 200
      && record?.winPct != null && record.winPct >= 0.5) {
    signals.push({ key: 'juicy_dog', pts: 15, label: `winning team at ${formatPlus(mlPrice)}` });
  }

  return signals;
}

function totalSideSignals({ side, sport, totalPoint }) {
  if (side !== 'over') return []; // squares bet Overs, Unders carry no lure
  const signals = [{ key: 'over', pts: 15, label: 'Over (the public side)' }];
  const median = SPORT_MEDIAN_TOTAL[sport];
  if (median != null && totalPoint != null && Number(totalPoint) > median) {
    signals.push({ key: 'high_total', pts: 10, label: `high total for ${sport} (${totalPoint})` });
  }
  return signals;
}

function formatPlus(price) {
  const n = Number(price);
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Detect traps for one game, independent of pick selection.
 *
 * @param {object} args
 * @param {object} args.edgeData   EdgeCalculator result (edges, factors)
 * @param {object} args.oddsCtx    extractOddsContext() output
 * @param {object} args.game       { home_team, away_team, ... }
 * @param {string} args.sport      display sport name ("MLB", "NBA", ...)
 * @param {object} [args.rankCtx]  { home_streak, away_streak } fallback streaks
 * @returns {Array<{side, edge_pp, lure_score, signals}>} strongest first
 */
function detectTraps({ edgeData, oddsCtx, game, sport, rankCtx }) {
  if (!edgeData?.edges) return [];
  const f = edgeData.factors || {};
  const standings = f.standings || {};
  const homeStanding = withStreakFallback(standings.home, rankCtx?.home_streak);
  const awayStanding = withStreakFallback(standings.away, rankCtx?.away_streak);

  const sideCtx = {
    home_ml:     { team: 'home' }, away_ml:     { team: 'away' },
    home_spread: { team: 'home' }, away_spread: { team: 'away' },
    over: { total: true }, under: { total: true },
  };

  const traps = [];
  for (const [side, edgeVal] of Object.entries(edgeData.edges)) {
    if (edgeVal == null) continue;
    const edgePp = Math.round(edgeVal * 1000) / 10;
    if (edgePp > TRAP_EDGE_MAX_PP) continue;

    const ctx = sideCtx[side];
    if (!ctx) continue; // draw and exotic sides: no lure model yet

    let signals;
    if (ctx.total) {
      signals = totalSideSignals({ side, sport, totalPoint: oddsCtx?.total });
    } else {
      const isHome = ctx.team === 'home';
      signals = teamSideSignals({
        isHome,
        teamName: isHome ? game.home_team : game.away_team,
        mlPrice: isHome ? oddsCtx?.ml_home : oddsCtx?.ml_away,
        record: isHome ? f.homeRecord : f.awayRecord,
        form: isHome ? f.homeRecentForm : f.awayRecentForm,
        standing: isHome ? homeStanding : awayStanding,
      });
    }

    const lureScore = signals.reduce((s, x) => s + x.pts, 0);
    if (lureScore < LURE_MIN) continue;

    traps.push({ side, edge_pp: edgePp, lure_score: lureScore, signals });
  }

  // Strongest trap first: most lure, then most negative edge.
  traps.sort((a, b) => (b.lure_score - a.lure_score) || (a.edge_pp - b.edge_pp));
  return traps;
}

function withStreakFallback(standing, streak) {
  if (standing?.streak || !streak) return standing || null;
  return { ...(standing || {}), streak };
}

module.exports = { detectTraps, LURE_MIN, TRAP_EDGE_MAX_PP };
