/**
 * Odds API /scores resolver
 *
 * Why this exists: ai_suggestions and parlay_legs are populated from Odds API
 * odds endpoints, so their team names use Odds API's vocabulary ("CF Montreal",
 * "Atlanta United FC", "Bryce Logan", etc.). Resolving game outcomes via ESPN
 * or game_results requires fuzzy matching across vocabularies — that's where
 * settlement was breaking (diacritics, "FC" vs "United" suffixes, sparse UFC
 * scoreboards, nested ATP shape).
 *
 * The Odds API /scores endpoint returns the SAME team names that produced the
 * suggestion. Exact match works.
 *
 * Docs: https://the-odds-api.com/liveapi/guides/v4/#get-scores
 */

const { logger } = require('../../shared/logger');

// Display sport (as stored in ai_suggestions.sport / parlay_legs.sport)
//   → Odds API sport_key(s).
// Tennis is dynamic (tournament keys rotate) — resolved against odds_cache.
const STATIC_SPORT_KEYS = {
  NBA: ['basketball_nba'],
  NCAAB: ['basketball_ncaab'],
  NFL: ['americanfootball_nfl'],
  NCAAF: ['americanfootball_ncaaf'],
  MLB: ['baseball_mlb'],
  NHL: ['icehockey_nhl'],
  EPL: ['soccer_epl'],
  MLS: ['soccer_usa_mls'],
  UFC: ['mma_mixed_martial_arts'],
};

const norm = (s) => (s || '').toString().trim().toLowerCase();

class OddsApiScores {
  constructor(supabase) {
    this.apiKey = process.env.ODDS_API_KEY;
    this.supabase = supabase;
    this.cacheByKey = new Map();    // sport_key -> {at, scores[]}
    this.tennisKeysCache = null;     // {at, keys[]}
    this.CACHE_TTL_MS = 10 * 60 * 1000;
    this.DAYS_FROM = 3;              // /scores supports up to 3 days back for completed games
  }

  async resolveSportKeys(displaySport) {
    if (!displaySport) return [];
    if (STATIC_SPORT_KEYS[displaySport]) return STATIC_SPORT_KEYS[displaySport];

    if (displaySport === 'Tennis') {
      if (this.tennisKeysCache && Date.now() - this.tennisKeysCache.at < this.CACHE_TTL_MS) {
        return this.tennisKeysCache.keys;
      }
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await this.supabase
        .from('odds_cache')
        .select('sport')
        .like('sport', 'tennis_%')
        .gt('commence_time', since);
      if (error) {
        logger.warn('OddsApiScores: failed to resolve tennis keys', { error: error.message });
        return [];
      }
      const keys = [...new Set((data || []).map(r => r.sport))];
      this.tennisKeysCache = { at: Date.now(), keys };
      return keys;
    }
    return [];
  }

  async fetchScoresForKey(sportKey) {
    if (!this.apiKey) return [];
    const cached = this.cacheByKey.get(sportKey);
    if (cached && Date.now() - cached.at < this.CACHE_TTL_MS) return cached.scores;

    const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/scores/?daysFrom=${this.DAYS_FROM}&apiKey=${this.apiKey}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        logger.warn(`OddsApi /scores ${sportKey} -> ${res.status}`);
        this.cacheByKey.set(sportKey, { at: Date.now(), scores: [] });
        return [];
      }
      const data = await res.json();
      const scores = Array.isArray(data) ? data : [];
      this.cacheByKey.set(sportKey, { at: Date.now(), scores });
      return scores;
    } catch (err) {
      logger.warn(`OddsApi /scores ${sportKey} fetch failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Find the completed game for the given suggestion/leg.
   * Returns { homeScore, awayScore, status:'completed', source:'odds_api' } or null.
   */
  async findGameResult({ sport, home_team, away_team, game_date }) {
    if (!this.apiKey || !sport || !home_team || !away_team) return null;

    const keys = await this.resolveSportKeys(sport);
    if (!keys.length) return null;

    const targetTime = game_date ? new Date(game_date).getTime() : null;
    const sH = norm(home_team);
    const sA = norm(away_team);

    for (const key of keys) {
      const scores = await this.fetchScoresForKey(key);
      for (const game of scores) {
        if (!game.completed) continue;
        const gH = norm(game.home_team);
        const gA = norm(game.away_team);

        const directMatch = gH === sH && gA === sA;
        const swappedMatch = gH === sA && gA === sH;
        if (!directMatch && !swappedMatch) continue;

        // Date sanity (Odds API may include several days; pick the one closest to suggestion)
        if (targetTime && game.commence_time) {
          const diff = Math.abs(new Date(game.commence_time).getTime() - targetTime);
          if (diff > 36 * 60 * 60 * 1000) continue;
        }

        const scoreFor = (teamName) => {
          const row = (game.scores || []).find(x => norm(x.name) === norm(teamName));
          if (!row) return NaN;
          return parseInt(row.score, 10);
        };
        const homeScore = scoreFor(game.home_team);
        const awayScore = scoreFor(game.away_team);
        if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) continue;

        // If swapped, return scores from suggestion's perspective.
        const reversed = swappedMatch && !directMatch;
        return {
          homeScore: reversed ? awayScore : homeScore,
          awayScore: reversed ? homeScore : awayScore,
          status: 'completed',
          source: 'odds_api',
        };
      }
    }
    return null;
  }
}

module.exports = OddsApiScores;
