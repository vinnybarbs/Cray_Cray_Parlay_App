/**
 * Pick grader — single source of truth for turning an EdgeCalculator result
 * into UI-ready pick text and into annotations on a list of odds rows.
 *
 * Used by:
 *   - api/cron/pre-analyze-games.js  (digest tiles)
 *   - lib/agents/analyst-agent.js    (full parlay generator)
 *   - api/chat-picks.js              (Degenny chatbot)
 *
 * Centralizing it here means a pick's math grade looks identical no matter
 * which surface the user hits. Previously each path had its own logic and
 * the LLM was allowed to wander.
 */

'use strict';

function formatAmericanOdds(price) {
  if (price == null || Number.isNaN(Number(price))) return null;
  const n = Number(price);
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Build the canonical pick text (e.g. "Los Angeles Lakers +10.5", "OKC ML -500",
 * "Over 211.5") from a side identifier plus the oddsContext we already extract
 * elsewhere. Returns null if the underlying market isn't available.
 */
function buildPickText(side, oddsCtx, game) {
  if (!side || !oddsCtx || !game) return null;
  switch (side) {
    case 'home_ml': {
      const price = formatAmericanOdds(oddsCtx.ml_home);
      return price ? `${game.home_team} ML ${price}` : `${game.home_team} ML`;
    }
    case 'away_ml': {
      const price = formatAmericanOdds(oddsCtx.ml_away);
      return price ? `${game.away_team} ML ${price}` : `${game.away_team} ML`;
    }
    case 'home_spread': {
      if (oddsCtx.spread == null) return null;
      const sign = oddsCtx.spread >= 0 ? '+' : '';
      return `${game.home_team} ${sign}${oddsCtx.spread}`;
    }
    case 'away_spread': {
      if (oddsCtx.spread == null) return null;
      const awaySpread = -oddsCtx.spread;
      const sign = awaySpread >= 0 ? '+' : '';
      return `${game.away_team} ${sign}${awaySpread}`;
    }
    case 'over':
      return oddsCtx.total != null ? `Over ${oddsCtx.total}` : null;
    case 'under':
      return oddsCtx.total != null ? `Under ${oddsCtx.total}` : null;
    default:
      return null;
  }
}

function resolveOddsForSide(oddsCtx, side) {
  switch (side) {
    case 'home_spread': return oddsCtx.spread_home_odds;
    case 'away_spread': return oddsCtx.spread_away_odds;
    case 'over':        return oddsCtx.over_odds;
    case 'under':       return oddsCtx.under_odds;
    case 'home_ml':     return oddsCtx.ml_home;
    case 'away_ml':     return oddsCtx.ml_away;
    default:            return null;
  }
}

/**
 * Map an existing pick from the parlay menu (or odds_cache outcome) to its
 * canonical side identifier so we can grade it against an `edges` dict.
 *
 *   { betType: 'Spread', pick: 'Los Angeles Lakers', point: 10.5, homeTeam, awayTeam }
 *     -> 'home_spread'   (Lakers IS the home team, line is +10.5 — that's
 *                         the home cover side)
 *
 * Returns null when we can't map (e.g., player props, unknown bet types).
 */
function sideForPick(pick, game) {
  if (!pick || !game) return null;
  const bt = (pick.betType || '').toLowerCase();
  const pickText = (pick.pick || '').toString();
  const home = game.home_team || game.homeTeam;
  const away = game.away_team || game.awayTeam;

  if (bt.includes('player') || bt.includes('prop')) return null; // not in edges dict yet

  if (bt === 'moneyline' || bt === 'h2h') {
    if (home && pickText.toLowerCase().includes(home.toLowerCase())) return 'home_ml';
    if (away && pickText.toLowerCase().includes(away.toLowerCase())) return 'away_ml';
    return null;
  }

  if (bt === 'spread' || bt === 'spreads') {
    if (home && pickText.toLowerCase().includes(home.toLowerCase())) return 'home_spread';
    if (away && pickText.toLowerCase().includes(away.toLowerCase())) return 'away_spread';
    return null;
  }

  if (bt === 'total' || bt === 'totals' || bt === 'totals (o/u)' || bt === 'over/under') {
    if (pickText.toLowerCase().includes('over')) return 'over';
    if (pickText.toLowerCase().includes('under')) return 'under';
    return null;
  }

  return null;
}

/**
 * Annotate a picks list with per-side math edges. Mutates+returns the array.
 * Each pick gains:
 *   - side: canonical side string ('home_ml', 'away_spread', etc.) or null
 *   - signedEdge: number (signed) or null — positive = model value
 *   - edgePp: signedEdge * 100 rounded to 1 decimal, or null
 *   - isMathPick: true when this pick matches the math-recommended side
 *
 * `edges` is the per-side object stored in game_analysis.edges.
 * `mathRecommendedSide` is the winner from edgeCalculator.pickBestSide (or null).
 */
function annotatePicksWithEdges(picks, game, edges, mathRecommendedSide = null) {
  if (!Array.isArray(picks)) return picks;
  for (const pick of picks) {
    const side = sideForPick(pick, game);
    pick.side = side;
    const signed = side && edges ? edges[side] : null;
    pick.signedEdge = signed != null ? signed : null;
    pick.edgePp = signed != null ? Math.round(signed * 1000) / 10 : null;
    pick.isMathPick = !!(side && mathRecommendedSide && side === mathRecommendedSide);
  }
  return picks;
}

/**
 * Format edge for human/LLM display: "+12.4pp" or "-3.1pp" or "N/A".
 */
function formatEdge(signedEdge) {
  if (signedEdge == null) return 'N/A';
  const pp = signedEdge * 100;
  return `${pp >= 0 ? '+' : ''}${pp.toFixed(1)}pp`;
}

module.exports = {
  buildPickText,
  formatAmericanOdds,
  resolveOddsForSide,
  sideForPick,
  annotatePicksWithEdges,
  formatEdge,
};
