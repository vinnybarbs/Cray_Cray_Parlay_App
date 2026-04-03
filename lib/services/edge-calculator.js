// lib/services/edge-calculator.js
// Statistical Edge Calculator — computes mathematical win probability from game_results,
// news_cache injuries, and odds data, then compares to the bookmaker's implied probability
// to surface real edges BEFORE the AI analyzes each game.

'use strict';

// ---------------------------------------------------------------------------
// Sport-specific home-court/field advantage (added to home win probability)
// ---------------------------------------------------------------------------
const HOME_ADVANTAGE = {
  NBA: 0.035,
  NCAAB: 0.040,
  NHL: 0.025,
  MLB: 0.030,
  NFL: 0.030,
  NCAAF: 0.030,
  EPL: 0.080
};

// Minimum games required before we trust a team's record
const MIN_GAMES_FOR_CONFIDENCE = 5;

// Map odds_cache sport slugs → display names used in game_results
const SLUG_TO_SPORT = {
  americanfootball_nfl: 'NFL',
  americanfootball_ncaaf: 'NCAAF',
  basketball_nba: 'NBA',
  basketball_ncaab: 'NCAAB',
  icehockey_nhl: 'NHL',
  baseball_mlb: 'MLB',
  soccer_epl: 'EPL'
};

class EdgeCalculator {
  /**
   * @param {import('@supabase/supabase-js').SupabaseClient} supabase
   */
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Calculate the statistical edge for a single game.
   *
   * @param {object} game  — object with home_team, away_team, sport (slug), markets
   * @returns {object|null} edge result object, or null if insufficient data
   */
  async calculateEdge(game) {
    const sportName = SLUG_TO_SPORT[game.sport] || game.sport.toUpperCase();

    // ------------------------------------------------------------------
    // 1. Pull raw data in parallel (all DB calls fire together)
    // ------------------------------------------------------------------
    const [homeRecord, awayRecord, homeForm, awayForm, homeInjuryImpact, awayInjuryImpact] = await Promise.all([
      this.getTeamRecord(game.home_team, sportName, 20),
      this.getTeamRecord(game.away_team, sportName, 20),
      this.getRecentForm(game.home_team, sportName, 5),
      this.getRecentForm(game.away_team, sportName, 5),
      this.getInjuryImpact(game.home_team, sportName),
      this.getInjuryImpact(game.away_team, sportName)
    ]);

    // Schedule strength requires knowing opponents, which is already baked into
    // getTeamRecord, so we compute it afterwards using the result data.
    const [homeSOS, awaySOS] = await Promise.all([
      this._getScheduleStrength(game.home_team, sportName),
      this._getScheduleStrength(game.away_team, sportName)
    ]);

    // ------------------------------------------------------------------
    // 2. Implied probability from moneyline odds
    // ------------------------------------------------------------------
    const mlHome = this._extractMoneyline(game, game.home_team);
    const mlAway = this._extractMoneyline(game, game.away_team);

    let impliedHomeProb = null;
    let impliedAwayProb = null;

    if (mlHome !== null && mlAway !== null) {
      const rawHome = this.impliedProbability(mlHome);
      const rawAway = this.impliedProbability(mlAway);
      // Remove vig — normalise so both sides sum to 1
      const total = rawHome + rawAway;
      impliedHomeProb = rawHome / total;
      impliedAwayProb = rawAway / total;
    }

    // ------------------------------------------------------------------
    // 3. Build base probability (log5 from win%)
    // ------------------------------------------------------------------
    const homeWinPct = homeRecord ? homeRecord.winPct : 0.5;
    const awayWinPct = awayRecord ? awayRecord.winPct : 0.5;

    // Point-differential-based win probability (Pythagorean-style via log5)
    // We derive an "effective" win% from point diff using a linear approximation:
    // ±1 PPG ≈ ±1.5% win% (empirically derived across major sports)
    const homePtDiff = homeRecord ? homeRecord.pointDiffPerGame : 0;
    const awayPtDiff = awayRecord ? awayRecord.pointDiffPerGame : 0;

    const homePtWinPct = this._ptDiffToWinPct(homePtDiff);
    const awayPtWinPct = this._ptDiffToWinPct(awayPtDiff);

    // Blend: 60% point-diff signal, 40% raw W-L record
    const homeBlended = 0.6 * homePtWinPct + 0.4 * homeWinPct;
    const awayBlended = 0.6 * awayPtWinPct + 0.4 * awayWinPct;

    // Head-to-head log5 probability
    let homeWinProb = this.log5(homeBlended, awayBlended);

    // ------------------------------------------------------------------
    // 4. Adjustments
    // ------------------------------------------------------------------
    const adjustments = [];

    // 4a. Recent form divergence
    const homeFormAdj = this._recentFormAdjustment(homeRecord, homeForm);
    const awayFormAdj  = this._recentFormAdjustment(awayRecord, awayForm);

    if (Math.abs(homeFormAdj) > 0) {
      homeWinProb += homeFormAdj;
      adjustments.push({
        factor: `${homeFormAdj > 0 ? 'Strong' : 'Poor'} recent form (${game.home_team})`,
        impact: homeFormAdj,
        detail: homeForm ? `${homeForm.last5} last 5` : 'season avg divergence'
      });
    }
    if (Math.abs(awayFormAdj) > 0) {
      homeWinProb -= awayFormAdj; // away team's form impacts home win prob inversely
      adjustments.push({
        factor: `${awayFormAdj > 0 ? 'Strong' : 'Poor'} recent form (${game.away_team})`,
        impact: -awayFormAdj,
        detail: awayForm ? `${awayForm.last5} last 5` : 'season avg divergence'
      });
    }

    // 4b. Schedule strength
    let sosAdj = 0;
    if (homeSOS !== null && awaySOS !== null) {
      // Positive if home team faced tougher schedule (inflates their record less)
      sosAdj = (homeSOS - awaySOS) * 0.15; // 15% sensitivity
      if (Math.abs(sosAdj) > 0.005) {
        homeWinProb += sosAdj;
        adjustments.push({
          factor: homeSOS > awaySOS ? 'Home team faced tougher schedule' : 'Away team faced tougher schedule',
          impact: sosAdj,
          detail: `Home SOS: ${(homeSOS * 100).toFixed(1)}% | Away SOS: ${(awaySOS * 100).toFixed(1)}%`
        });
      }
    }

    // 4c. Home advantage (sport-specific)
    const homeAdv = HOME_ADVANTAGE[sportName] || 0.03;
    // NCAAB neutral site during tournament (March/April)
    const isNeutralSite = sportName === 'NCAAB' && this._isTournamentTime(game.game_date || game.commence_time);
    const effectiveHomeAdv = isNeutralSite ? 0 : homeAdv;

    homeWinProb += effectiveHomeAdv;
    if (effectiveHomeAdv > 0) {
      adjustments.push({
        factor: 'Home advantage',
        impact: effectiveHomeAdv,
        detail: `${sportName} home advantage: +${(effectiveHomeAdv * 100).toFixed(1)}%`
      });
    }

    // 4d. Injury impact
    if (homeInjuryImpact !== 0) {
      homeWinProb += homeInjuryImpact; // negative = hurts home team
      adjustments.push({
        factor: `Injury impact (${game.home_team})`,
        impact: homeInjuryImpact,
        detail: 'Key player(s) OUT or doubtful'
      });
    }
    if (awayInjuryImpact !== 0) {
      homeWinProb -= awayInjuryImpact; // away team hurt = home team benefits
      adjustments.push({
        factor: `Injury impact (${game.away_team})`,
        impact: -awayInjuryImpact,
        detail: 'Key player(s) OUT or doubtful'
      });
    }

    // ATS context (informational — doesn't adjust probability but included in factors)
    let homeATS = null, awayATS = null;
    try {
      const ATSTracker = require('./ats-tracker');
      const atsTracker = new ATSTracker(this.supabase);
      [homeATS, awayATS] = await Promise.all([
        atsTracker.getTeamATS(game.home_team, sport, 20),
        atsTracker.getTeamATS(game.away_team, sport, 20)
      ]);
      if (homeATS) {
        factors.atsHome = homeATS.ats;
        factors.atsHomeLast5 = homeATS.last5ATS;
      }
      if (awayATS) {
        factors.atsAway = awayATS.ats;
        factors.atsAwayLast5 = awayATS.last5ATS;
      }
    } catch (e) { /* ATS data optional */ }

    // Clamp to [0.02, 0.98] — no certainties
    homeWinProb = Math.max(0.02, Math.min(0.98, homeWinProb));
    const awayWinProb = 1 - homeWinProb;

    // ------------------------------------------------------------------
    // 5. Edge vs implied odds
    // ------------------------------------------------------------------
    let edge = null;
    let edgeSide = null;
    let edgePercent = null;

    if (impliedHomeProb !== null) {
      const homeEdge = homeWinProb - impliedHomeProb;
      const awayEdge = awayWinProb - impliedAwayProb;

      // Pick whichever side has the larger absolute edge
      if (Math.abs(homeEdge) >= Math.abs(awayEdge)) {
        edge = homeEdge;
        edgeSide = homeEdge >= 0 ? 'home' : 'away';
      } else {
        edge = awayEdge;
        edgeSide = awayEdge >= 0 ? 'away' : 'home';
      }
      edgePercent = Math.abs(edge) * 100;
    }

    // ------------------------------------------------------------------
    // 6. Data quality / confidence
    // ------------------------------------------------------------------
    const dataQuality = {
      hasRecords: !!(homeRecord && awayRecord),
      hasPointDiff: !!(homeRecord?.pointDiffPerGame != null && awayRecord?.pointDiffPerGame != null),
      hasRecentForm: !!(homeForm && awayForm),
      hasInjuries: homeInjuryImpact !== 0 || awayInjuryImpact !== 0,
      hasScheduleStrength: homeSOS !== null && awaySOS !== null,
      gamesAnalyzed: (homeRecord?.gamesPlayed || 0) + (awayRecord?.gamesPlayed || 0)
    };

    const qualityScore = Object.values(dataQuality).filter(v => v === true).length;
    const confidence = qualityScore >= 4 ? 'high' : qualityScore >= 2 ? 'medium' : 'low';

    // ------------------------------------------------------------------
    // 7. Assemble result
    // ------------------------------------------------------------------
    return {
      homeWinProb: parseFloat(homeWinProb.toFixed(4)),
      awayWinProb: parseFloat(awayWinProb.toFixed(4)),
      impliedHomeProb: impliedHomeProb !== null ? parseFloat(impliedHomeProb.toFixed(4)) : null,
      impliedAwayProb: impliedAwayProb !== null ? parseFloat(impliedAwayProb.toFixed(4)) : null,
      edge: edge !== null ? parseFloat(edge.toFixed(4)) : null,
      edgeSide,
      edgePercent: edgePercent !== null ? parseFloat(edgePercent.toFixed(2)) : null,
      factors: {
        homeRecord: homeRecord ? { wins: homeRecord.wins, losses: homeRecord.losses, winPct: parseFloat(homeRecord.winPct.toFixed(3)) } : null,
        awayRecord: awayRecord ? { wins: awayRecord.wins, losses: awayRecord.losses, winPct: parseFloat(awayRecord.winPct.toFixed(3)) } : null,
        homePointDiff: homeRecord ? parseFloat(homePtDiff.toFixed(2)) : null,
        awayPointDiff: awayRecord ? parseFloat(awayPtDiff.toFixed(2)) : null,
        homeRecentForm: homeForm ? { last5: homeForm.last5, winPct: parseFloat(homeForm.winPct.toFixed(3)) } : null,
        awayRecentForm: awayForm ? { last5: awayForm.last5, winPct: parseFloat(awayForm.winPct.toFixed(3)) } : null,
        scheduleStrength: (homeSOS !== null && awaySOS !== null) ? {
          home: parseFloat(homeSOS.toFixed(3)),
          away: parseFloat(awaySOS.toFixed(3))
        } : null,
        homeAdvantage: effectiveHomeAdv,
        injuryImpact: parseFloat((homeInjuryImpact - awayInjuryImpact).toFixed(3))
      },
      adjustments,
      confidence,
      dataQuality
    };
  }

  // ---------------------------------------------------------------------------
  // HELPER METHODS — Data fetching
  // ---------------------------------------------------------------------------

  /**
   * Query game_results for a team's last N games and compute record + point diff.
   * Uses mascot (last word of team name) for flexible matching.
   */
  async getTeamRecord(teamName, sportName, limit = 20) {
    try {
      const mascot = teamName.split(' ').slice(-1)[0];

      const { data, error } = await this.supabase
        .from('game_results')
        .select('home_team_name, away_team_name, home_score, away_score, date')
        .eq('status', 'final')
        .eq('sport', sportName)
        .or(`home_team_name.ilike.%${mascot}%,away_team_name.ilike.%${mascot}%`)
        .order('date', { ascending: false })
        .limit(limit);

      if (error || !data || data.length === 0) return null;

      let wins = 0, losses = 0, pointDiffTotal = 0;
      for (const g of data) {
        const isHome = g.home_team_name.toLowerCase().includes(mascot.toLowerCase());
        const teamScore = isHome ? g.home_score : g.away_score;
        const oppScore  = isHome ? g.away_score : g.home_score;
        if (teamScore == null || oppScore == null) continue;
        const diff = teamScore - oppScore;
        pointDiffTotal += diff;
        if (diff > 0) wins++; else losses++;
      }

      const gamesPlayed = wins + losses;
      if (gamesPlayed === 0) return null;

      return {
        wins,
        losses,
        gamesPlayed,
        winPct: wins / gamesPlayed,
        pointDiffPerGame: pointDiffTotal / gamesPlayed
      };
    } catch {
      return null;
    }
  }

  /**
   * Get last N games to compute recent form (W-L string + win%).
   */
  async getRecentForm(teamName, sportName, limit = 5) {
    try {
      const mascot = teamName.split(' ').slice(-1)[0];

      const { data, error } = await this.supabase
        .from('game_results')
        .select('home_team_name, away_team_name, home_score, away_score, date')
        .eq('status', 'final')
        .eq('sport', sportName)
        .or(`home_team_name.ilike.%${mascot}%,away_team_name.ilike.%${mascot}%`)
        .order('date', { ascending: false })
        .limit(limit);

      if (error || !data || data.length === 0) return null;

      let wins = 0, losses = 0;
      const results = [];
      for (const g of data) {
        const isHome = g.home_team_name.toLowerCase().includes(mascot.toLowerCase());
        const teamScore = isHome ? g.home_score : g.away_score;
        const oppScore  = isHome ? g.away_score : g.home_score;
        if (teamScore == null || oppScore == null) continue;
        if (teamScore > oppScore) { wins++; results.push('W'); } else { losses++; results.push('L'); }
      }

      const gamesPlayed = wins + losses;
      if (gamesPlayed === 0) return null;

      return {
        last5: `${wins}-${losses}`,
        results,
        winPct: wins / gamesPlayed
      };
    } catch {
      return null;
    }
  }

  /**
   * Calculate schedule strength: average win% of opponents faced in last 20 games.
   * This is a two-step query — get the opponent names, then look up each one's record.
   */
  async _getScheduleStrength(teamName, sportName) {
    try {
      const mascot = teamName.split(' ').slice(-1)[0];

      // Step 1: Get the 20 most recent games and collect opponent names
      const { data, error } = await this.supabase
        .from('game_results')
        .select('home_team_name, away_team_name, home_score, away_score')
        .eq('status', 'final')
        .eq('sport', sportName)
        .or(`home_team_name.ilike.%${mascot}%,away_team_name.ilike.%${mascot}%`)
        .order('date', { ascending: false })
        .limit(20);

      if (error || !data || data.length < MIN_GAMES_FOR_CONFIDENCE) return null;

      // Collect unique opponent mascots
      const oppMascots = new Set();
      for (const g of data) {
        const isHome = g.home_team_name.toLowerCase().includes(mascot.toLowerCase());
        const opp = isHome ? g.away_team_name : g.home_team_name;
        if (opp) oppMascots.add(opp.split(' ').slice(-1)[0]);
      }

      if (oppMascots.size === 0) return null;

      // Step 2: For each opponent, get their win% (batch via OR filter)
      const orFilter = [...oppMascots]
        .map(m => `home_team_name.ilike.%${m}%,away_team_name.ilike.%${m}%`)
        .join(',');

      const { data: oppGames } = await this.supabase
        .from('game_results')
        .select('home_team_name, away_team_name, home_score, away_score')
        .eq('status', 'final')
        .eq('sport', sportName)
        .or(orFilter)
        .limit(400); // broad fetch; we'll segment below

      if (!oppGames || oppGames.length === 0) return null;

      // Build win% per opponent mascot
      const oppRecords = {};
      for (const opp of oppMascots) {
        const oppLower = opp.toLowerCase();
        const games = oppGames.filter(g =>
          g.home_team_name.toLowerCase().includes(oppLower) ||
          g.away_team_name.toLowerCase().includes(oppLower)
        );
        if (games.length < 3) continue;

        let w = 0, l = 0;
        for (const g of games) {
          const isHome = g.home_team_name.toLowerCase().includes(oppLower);
          const ts = isHome ? g.home_score : g.away_score;
          const os = isHome ? g.away_score : g.home_score;
          if (ts == null || os == null) continue;
          if (ts > os) w++; else l++;
        }
        if (w + l > 0) oppRecords[opp] = w / (w + l);
      }

      const values = Object.values(oppRecords);
      if (values.length === 0) return null;

      return values.reduce((sum, v) => sum + v, 0) / values.length;
    } catch {
      return null;
    }
  }

  /**
   * Look up injury news from news_cache and return a probability impact.
   * Returns a number: 0 if no injuries, negative if key players are out.
   */
  async getInjuryImpact(teamName, sportName) {
    try {
      const mascot = teamName.split(' ').slice(-1)[0];
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      const { data } = await this.supabase
        .from('news_cache')
        .select('summary')
        .eq('search_type', 'injuries')
        .or(`team_name.ilike.%${mascot}%,team_name.ilike.%${teamName}%`)
        .gt('last_updated', since)
        .limit(5);

      if (!data || data.length === 0) return 0;

      const fullText = data.map(d => d.summary || '').join(' ').toLowerCase();

      // Count confirmed absences
      const outMatches = (fullText.match(/\bout\b/g) || []).length;
      const doubtfulMatches = (fullText.match(/\bdoubtful\b/g) || []).length;
      const questionableMatches = (fullText.match(/\bquestionable\b/g) || []).length;

      // Weighted impact: OUT = -5%, doubtful = -3%, questionable = -1%
      // Cap at -10% total (can't account for a whole team being injured)
      const impact = -(
        Math.min(outMatches, 2) * 0.05 +
        Math.min(doubtfulMatches, 2) * 0.03 +
        Math.min(questionableMatches, 2) * 0.01
      );

      return Math.max(-0.10, impact);
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // HELPER METHODS — Math
  // ---------------------------------------------------------------------------

  /**
   * Log5 formula: probability that team A beats team B given their win percentages.
   * Handles edge cases where pA or pB is 0 or 1.
   */
  log5(pA, pB) {
    // Guard against divide-by-zero
    if (pA <= 0) return 0.02;
    if (pA >= 1) return 0.98;
    if (pB <= 0) return 0.98;
    if (pB >= 1) return 0.02;

    const numerator = pA - pA * pB;
    const denominator = pA + pB - 2 * pA * pB;
    if (denominator === 0) return 0.5;
    return numerator / denominator;
  }

  /**
   * Convert American moneyline odds to raw implied probability.
   * -180 → 0.643   |   +150 → 0.400
   */
  impliedProbability(americanOdds) {
    if (americanOdds < 0) {
      return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
    } else {
      return 100 / (americanOdds + 100);
    }
  }

  /**
   * Convert point differential per game to an approximate win percentage.
   * Linear approximation: ±1 PPG ≈ ±1.5% win% from .500 baseline.
   * Clamped to [0.10, 0.90].
   */
  _ptDiffToWinPct(ptDiff) {
    const raw = 0.5 + ptDiff * 0.015;
    return Math.max(0.10, Math.min(0.90, raw));
  }

  /**
   * Compute a recent-form adjustment to the home win probability.
   * If a team's last-5 win% diverges from their season win% by >15%, nudge by 3-5%.
   */
  _recentFormAdjustment(seasonRecord, recentForm) {
    if (!seasonRecord || !recentForm) return 0;
    if (seasonRecord.gamesPlayed < MIN_GAMES_FOR_CONFIDENCE) return 0;

    const divergence = recentForm.winPct - seasonRecord.winPct;

    if (Math.abs(divergence) < 0.15) return 0; // Not meaningful

    // Scale: 15-30% divergence → 3%, >30% divergence → 5%
    const magnitude = Math.abs(divergence) > 0.30 ? 0.05 : 0.03;
    return divergence > 0 ? magnitude : -magnitude;
  }

  /**
   * Extract moneyline for a given team from game.markets (h2h market).
   */
  _extractMoneyline(game, teamName) {
    try {
      const h2h = game.markets?.h2h;
      if (!h2h || !Array.isArray(h2h)) return null;
      const outcome = h2h.find(o => o.name === teamName);
      return outcome ? outcome.price : null;
    } catch {
      return null;
    }
  }

  /**
   * Check if a game date falls in March/April (NCAA Tournament — neutral sites).
   */
  _isTournamentTime(dateStr) {
    if (!dateStr) return false;
    const month = new Date(dateStr).getMonth() + 1; // 1-indexed
    return month === 3 || month === 4;
  }
}

module.exports = { EdgeCalculator };
