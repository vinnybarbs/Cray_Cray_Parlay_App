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
  EPL: 0.080,
  MLS: 0.070,
  UFC: 0.000,
  Tennis: 0.000
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
  soccer_epl: 'EPL',
  soccer_usa_mls: 'MLS',
  mma_mixed_martial_arts: 'UFC',
  tennis_atp_monte_carlo_masters: 'Tennis',
  tennis_atp_madrid_open: 'Tennis',
  tennis_atp_italian_open: 'Tennis',
  tennis_atp_french_open: 'Tennis',
  tennis_atp_wimbledon: 'Tennis',
  tennis_atp_us_open: 'Tennis',
  tennis_atp_aus_open_singles: 'Tennis',
  tennis_wta_madrid_open: 'Tennis',
  tennis_wta_italian_open: 'Tennis',
  tennis_wta_french_open: 'Tennis',
  tennis_wta_wimbledon: 'Tennis',
  tennis_wta_us_open: 'Tennis',
  tennis_wta_aus_open_singles: 'Tennis'
};

// Sanitize a team name for use inside a PostgREST .or() filter value.
// ilike is case-insensitive; we strip chars that break the filter syntax.
// Apostrophes (Hawai'i) are fine — supabase-js URL-encodes them.
function sanitizeTeamName(name) {
  if (!name) return '';
  return String(name).replace(/[(),]/g, '').trim();
}

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

    // ESPN-sourced richness: record, streak, last_10, home/away splits, playoff seed.
    // Populated by sync-standings cron; fact-sheet PR #8. Safe to be NULL for any
    // team — each adjustment skips cleanly when fields are missing.
    const [homeStandings, awayStandings] = await Promise.all([
      this.getStandingsSnapshot(game.home_team, sportName),
      this.getStandingsSnapshot(game.away_team, sportName)
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

    // Snapshot the pre-adjustment baseline so we can enforce an aggregate
    // cap on how far signal-stacking can move the probability (see step 5).
    const baseHomeWinProb = homeWinProb;

    // ------------------------------------------------------------------
    // 4. Adjustments
    // ------------------------------------------------------------------
    const adjustments = [];

    // 4a. Recent form divergence — prefer ESPN's last_10 (sport-correct,
    //     larger window, already parsed). Fall back to last-5 from game_results
    //     when last_10 is missing (off-season sports, pre-Railway-deploy, etc).
    const homeFormData = this._resolveFormData(homeStandings, homeForm, sportName);
    const awayFormData = this._resolveFormData(awayStandings, awayForm, sportName);

    const homeFormAdj = this._recentFormAdjustment(homeRecord, homeFormData);
    const awayFormAdj = this._recentFormAdjustment(awayRecord, awayFormData);

    if (Math.abs(homeFormAdj) > 0) {
      homeWinProb += homeFormAdj;
      adjustments.push({
        factor: `${homeFormAdj > 0 ? 'Strong' : 'Poor'} recent form (${game.home_team})`,
        impact: homeFormAdj,
        detail: homeFormData ? `${homeFormData.label} (${homeFormData.source})` : 'season avg divergence'
      });
    }
    if (Math.abs(awayFormAdj) > 0) {
      homeWinProb -= awayFormAdj; // away team's form impacts home win prob inversely
      adjustments.push({
        factor: `${awayFormAdj > 0 ? 'Strong' : 'Poor'} recent form (${game.away_team})`,
        impact: -awayFormAdj,
        detail: awayFormData ? `${awayFormData.label} (${awayFormData.source})` : 'season avg divergence'
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

    // ------------------------------------------------------------------
    // 4e. Venue split — home team's home_record vs overall, away team's
    //     away_record vs overall. Half-weighted against overall delta to
    //     avoid double-counting with the flat homeAdvantage in 4c.
    // ------------------------------------------------------------------
    const venueAdjs = this._venueSplitAdjustments(homeStandings, awayStandings, sportName, game.home_team, game.away_team);
    for (const vAdj of venueAdjs) {
      homeWinProb += vAdj.impact;
      adjustments.push({ factor: vAdj.factor, impact: vAdj.impact, detail: vAdj.detail });
    }

    // ------------------------------------------------------------------
    // 4f. Streak momentum — small nudge only. Streaks 3-10 games long get
    //     ±0.5-2.5% based on length. Very long streaks (10+) capped —
    //     market has likely already priced them in.
    // ------------------------------------------------------------------
    const homeStreakAdj = this._streakAdjustment(homeStandings?.streak);
    if (Math.abs(homeStreakAdj) > 0) {
      homeWinProb += homeStreakAdj;
      adjustments.push({
        factor: `${game.home_team} ${homeStandings.streak} streak`,
        impact: homeStreakAdj,
        detail: 'Streak momentum (small nudge, market may price longer streaks)'
      });
    }
    const awayStreakAdj = this._streakAdjustment(awayStandings?.streak);
    if (Math.abs(awayStreakAdj) > 0) {
      homeWinProb -= awayStreakAdj;
      adjustments.push({
        factor: `${game.away_team} ${awayStandings.streak} streak`,
        impact: -awayStreakAdj,
        detail: 'Streak momentum (small nudge, market may price longer streaks)'
      });
    }

    // ------------------------------------------------------------------
    // 4g. Playoff seed prior — only applies in postseason when both teams
    //     have a seed from ESPN. Lower seed number = higher seed = slight
    //     favorite tilt.
    // ------------------------------------------------------------------
    const seedAdj = this._playoffSeedAdjustment(homeStandings?.playoff_seed, awayStandings?.playoff_seed);
    if (Math.abs(seedAdj) > 0) {
      homeWinProb += seedAdj;
      adjustments.push({
        factor: seedAdj > 0 ? 'Home higher playoff seed' : 'Away higher playoff seed',
        impact: seedAdj,
        detail: `Seeds — home #${homeStandings.playoff_seed}, away #${awayStandings.playoff_seed}`
      });
    }

    // ATS context (informational — doesn't adjust probability but surfaced
    // in the returned factors for the LLM/tile). Previously this block was
    // silently throwing because it referenced an undefined `sport` var and
    // tried to assign onto a `factors` object that didn't exist yet in scope.
    let homeATS = null, awayATS = null;
    try {
      const ATSTracker = require('./ats-tracker');
      const atsTracker = new ATSTracker(this.supabase);
      [homeATS, awayATS] = await Promise.all([
        atsTracker.getTeamATS(game.home_team, sportName, 20),
        atsTracker.getTeamATS(game.away_team, sportName, 20)
      ]);
    } catch (e) { /* ATS data optional */ }

    // ------------------------------------------------------------------
    // 5. Aggregate-cap on accumulated signal swing.
    //    Individual adjustments are already capped (venue ±6%, streak ±2.5%,
    //    seed ±4%, form ±5%, injury ±10%, SOS variable, home advantage 3%).
    //    But a "strong-at-home + cold-opponent + hot-streak + injury edge"
    //    pile-up could move probability ~17%+ before the [0.02, 0.98] clamp.
    //    Cap the *net* movement from the pre-adjustment baseline at ±15%.
    // ------------------------------------------------------------------
    const MAX_NET_ADJUSTMENT = 0.15;
    const netDelta = homeWinProb - baseHomeWinProb;
    if (Math.abs(netDelta) > MAX_NET_ADJUSTMENT) {
      const scaleFactor = MAX_NET_ADJUSTMENT / Math.abs(netDelta);
      homeWinProb = baseHomeWinProb + netDelta * scaleFactor;
      adjustments.push({
        factor: 'Aggregate cap applied',
        impact: 0,
        detail: `Net signal swing was ${(netDelta * 100).toFixed(1)}% — scaled by ${scaleFactor.toFixed(2)} to enforce ±${(MAX_NET_ADJUSTMENT * 100).toFixed(0)}% cap`
      });
    }

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
        injuryImpact: parseFloat((homeInjuryImpact - awayInjuryImpact).toFixed(3)),
        ats: {
          home: homeATS ? { record: homeATS.ats, last5: homeATS.last5ATS, coverPct: homeATS.coverPct } : null,
          away: awayATS ? { record: awayATS.ats, last5: awayATS.last5ATS, coverPct: awayATS.coverPct } : null
        },
        standings: {
          home: homeStandings ? {
            record: homeStandings.record,
            streak: homeStandings.streak,
            last_10: homeStandings.last_10,
            home_record: homeStandings.home_record,
            away_record: homeStandings.away_record,
            playoff_seed: homeStandings.playoff_seed
          } : null,
          away: awayStandings ? {
            record: awayStandings.record,
            streak: awayStandings.streak,
            last_10: awayStandings.last_10,
            home_record: awayStandings.home_record,
            away_record: awayStandings.away_record,
            playoff_seed: awayStandings.playoff_seed
          } : null
        }
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
   * Uses the FULL team name for matching to avoid mascot collisions (e.g., "Sox"
   * matching both Red Sox and White Sox; "Rangers" matching NY Rangers and Texas
   * Rangers across sports). Full-name match may miss game_results rows that
   * store abbreviations — that's a data-source fix in Spec 2, not here.
   */
  async getTeamRecord(teamName, sportName, limit = 20) {
    try {
      const q = sanitizeTeamName(teamName);
      if (!q) return null;
      const qLower = q.toLowerCase();

      const { data, error } = await this.supabase
        .from('game_results')
        .select('home_team_name, away_team_name, home_score, away_score, date')
        .eq('status', 'final')
        .eq('sport', sportName)
        .or(`home_team_name.ilike.%${q}%,away_team_name.ilike.%${q}%`)
        .order('date', { ascending: false })
        .limit(limit);

      if (error || !data || data.length === 0) return null;

      let wins = 0, losses = 0, pointDiffTotal = 0;
      for (const g of data) {
        const isHome = g.home_team_name.toLowerCase().includes(qLower);
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
   * Same full-team-name match rationale as getTeamRecord.
   */
  async getRecentForm(teamName, sportName, limit = 5) {
    try {
      const q = sanitizeTeamName(teamName);
      if (!q) return null;
      const qLower = q.toLowerCase();

      const { data, error } = await this.supabase
        .from('game_results')
        .select('home_team_name, away_team_name, home_score, away_score, date')
        .eq('status', 'final')
        .eq('sport', sportName)
        .or(`home_team_name.ilike.%${q}%,away_team_name.ilike.%${q}%`)
        .order('date', { ascending: false })
        .limit(limit);

      if (error || !data || data.length === 0) return null;

      let wins = 0, losses = 0;
      const results = [];
      for (const g of data) {
        const isHome = g.home_team_name.toLowerCase().includes(qLower);
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
   * Uses full opponent team names (not mascots) for the same collision-avoidance
   * reason as getTeamRecord.
   */
  async _getScheduleStrength(teamName, sportName) {
    try {
      const q = sanitizeTeamName(teamName);
      if (!q) return null;
      const qLower = q.toLowerCase();

      // Step 1: Get the 20 most recent games and collect full opponent team names
      const { data, error } = await this.supabase
        .from('game_results')
        .select('home_team_name, away_team_name, home_score, away_score')
        .eq('status', 'final')
        .eq('sport', sportName)
        .or(`home_team_name.ilike.%${q}%,away_team_name.ilike.%${q}%`)
        .order('date', { ascending: false })
        .limit(20);

      if (error || !data || data.length < MIN_GAMES_FOR_CONFIDENCE) return null;

      // Collect unique FULL opponent names (not mascots — prevents cross-team collisions)
      const oppNames = new Set();
      for (const g of data) {
        const isHome = g.home_team_name.toLowerCase().includes(qLower);
        const opp = isHome ? g.away_team_name : g.home_team_name;
        if (opp) oppNames.add(sanitizeTeamName(opp));
      }

      if (oppNames.size === 0) return null;

      // Step 2: For each opponent, get their win% (batch via OR filter on full names)
      const orFilter = [...oppNames]
        .map(n => `home_team_name.ilike.%${n}%,away_team_name.ilike.%${n}%`)
        .join(',');

      const { data: oppGames } = await this.supabase
        .from('game_results')
        .select('home_team_name, away_team_name, home_score, away_score')
        .eq('status', 'final')
        .eq('sport', sportName)
        .or(orFilter)
        .limit(400); // broad fetch; we'll segment below

      if (!oppGames || oppGames.length === 0) return null;

      // Build win% per opponent (matched on full name)
      const oppRecords = {};
      for (const opp of oppNames) {
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
   * Uses full team name for matching (news_cache.team_name is stored as the
   * full team display name).
   */
  async getInjuryImpact(teamName, sportName) {
    try {
      const q = sanitizeTeamName(teamName);
      if (!q) return 0;
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      const { data } = await this.supabase
        .from('news_cache')
        .select('summary')
        .eq('search_type', 'injuries')
        .ilike('team_name', `%${q}%`)
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
   * Map a calc result to a 0-10 edge_score for tile display.
   *
   * Replaces the prior LLM-vibes edge_score (GPT-4o-mini was free-form picking
   * a number 1-10 with no rubric — see project_llm_in_digest_tile.md). The
   * deterministic score honors the fact-sheet philosophy: every metric on the
   * site should be traceable to math.
   *
   * Formula: clamp(0, 10, edgePercent + confidenceBonus)
   *   - edgePercent is in % points: e.g., 7.5 means our calc disagreed with
   *     the market-implied probability by 7.5 percentage points
   *   - confidence high → +0.5, medium → 0, low → −1.0
   *
   * Calibration intuition:
   *   < 2pp  → 1-2/10  (skip — likely market noise)
   *   2-4pp  → 3-4/10  (lean — only with confidence)
   *   4-6pp  → 5-6/10  (good play)
   *   6-8pp  → 7-8/10  (strong play)
   *   8+pp   → 9-10/10 (rare; high conviction)
   *
   * Returns null if edgeData lacks an edgePercent (e.g., missing market lines).
   * In that case caller should fall back to the LLM-supplied score (legacy path).
   */
  edgeScoreFromCalc(edgeData) {
    if (!edgeData || edgeData.edgePercent == null) return null;
    const conf = edgeData.confidence || 'medium';
    const confBonus = conf === 'high' ? 0.5 : conf === 'low' ? -1.0 : 0;
    const raw = edgeData.edgePercent + confBonus;
    return parseFloat(Math.max(0, Math.min(10, raw)).toFixed(2));
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
   *
   * Threshold depends on which window fed `recentForm`:
   *   * `espn_last_10`         — 10-game window vs 20-game season ⇒ 50% overlap.
   *                              Bump threshold to 0.20 so we're not just
   *                              comparing "last 10" to "last 20."
   *   * `game_results_last_5`  — 5-game vs 20-game ⇒ 25% overlap. Original
   *                              0.15 threshold is correct here.
   */
  _recentFormAdjustment(seasonRecord, recentForm) {
    if (!seasonRecord || !recentForm) return 0;
    if (seasonRecord.gamesPlayed < MIN_GAMES_FOR_CONFIDENCE) return 0;

    const divergence = recentForm.winPct - seasonRecord.winPct;
    const threshold = recentForm.source === 'espn_last_10' ? 0.20 : 0.15;

    if (Math.abs(divergence) < threshold) return 0;

    // Scale: threshold-(threshold+0.15) → 3%, beyond → 5%
    const magnitude = Math.abs(divergence) > (threshold + 0.15) ? 0.05 : 0.03;
    return divergence > 0 ? magnitude : -magnitude;
  }

  /**
   * Resolve a team's recent-form stats into a unified {winPct, label, source}.
   *
   * Order of preference:
   *   1. ESPN `last_10` from current_standings — sport-correct parsing via
   *      _parseRecord, 10-game window, one fewer DB query.
   *   2. game_results-derived last-5 from getRecentForm — fallback when
   *      last_10 is NULL (off-season NFL/NCAAF, pre-Railway-deploy state,
   *      or team-name drift).
   *   3. null — no form data.
   *
   * Returns an object compatible with _recentFormAdjustment's second arg.
   */
  _resolveFormData(standings, fallbackForm, sport) {
    if (standings?.last_10) {
      const parsed = this._parseRecord(standings.last_10, sport);
      if (parsed && parsed.totalGames >= 3) {
        return {
          winPct: parsed.winPct,
          label: `last 10: ${standings.last_10}`,
          source: 'espn_last_10'
        };
      }
    }
    if (fallbackForm && typeof fallbackForm.winPct === 'number') {
      return {
        winPct: fallbackForm.winPct,
        label: `last 5: ${fallbackForm.last5}`,
        source: 'game_results_last_5'
      };
    }
    return null;
  }

  /**
   * Fetch ESPN-sourced standings snapshot for a team. Returns null if the team
   * isn't in current_standings (off-season NFL/NCAAF, or name-join drift).
   * Populated by sync-standings cron; includes the sport-aware `record` string
   * from team_latest_record via the view.
   */
  async getStandingsSnapshot(teamName, sport) {
    const q = sanitizeTeamName(teamName);
    if (!q) return null;
    const { data } = await this.supabase
      .from('current_standings')
      .select('team_name, sport, record, streak, last_10, home_record, away_record, playoff_seed, win_percentage')
      .eq('sport', sport)
      .ilike('team_name', `%${q}%`)
      .limit(1);
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  }

  /**
   * Parse an ESPN record string into {wins, losses, totalGames, winPct}.
   * Handles 2-tuple W-L (NBA/MLB/NFL/NCAAB), 3-tuple W-L-OT (NHL), and
   * 3-tuple W-D-L (EPL/MLS). Returns null for unparseable input.
   */
  _parseRecord(recordStr, sport) {
    if (!recordStr || typeof recordStr !== 'string') return null;
    const parts = recordStr.split('-').map(p => parseInt(p, 10));
    if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) return null;

    if (parts.length === 2) {
      const [w, l] = parts;
      const total = w + l;
      return { wins: w, losses: l, totalGames: total, winPct: total > 0 ? w / total : 0.5 };
    }
    // 3-tuple — interpretation depends on sport
    if (sport === 'EPL' || sport === 'MLS') {
      // W-D-L soccer. Use points-weighted win% (win=3, draw=1, loss=0) normalized
      // to [0, 1]: (3w + d) / (3 * total_games).
      const [w, d, l] = parts;
      const total = w + d + l;
      return { wins: w, draws: d, losses: l, totalGames: total,
        winPct: total > 0 ? (3 * w + d) / (3 * total) : 0.5 };
    }
    // NHL W-L-OT (overtime losses still count as losses for win%)
    const [w, l, ot] = parts;
    const total = w + l + ot;
    return { wins: w, losses: l + ot, otLosses: ot, totalGames: total,
      winPct: total > 0 ? w / total : 0.5 };
  }

  /**
   * Venue split adjustments — compares home team's home_record vs overall and
   * away team's away_record vs overall. Half-weighted against the delta to avoid
   * double-counting with the flat HOME_ADVANTAGE bonus. Capped at ±6%.
   *
   * Returns an array of adjustment objects (0-2 entries) to append to the flow.
   */
  _venueSplitAdjustments(homeStandings, awayStandings, sport, homeTeamName, awayTeamName) {
    const out = [];

    if (homeStandings?.home_record && homeStandings?.record) {
      const overall = this._parseRecord(homeStandings.record, sport);
      const atHome = this._parseRecord(homeStandings.home_record, sport);
      if (overall && atHome && overall.totalGames >= 10 && atHome.totalGames >= 5) {
        const delta = atHome.winPct - overall.winPct;
        const impact = Math.max(-0.06, Math.min(0.06, delta * 0.5));
        if (Math.abs(impact) >= 0.005) {
          out.push({
            impact, // positive delta → home team better at home → boost home
            factor: impact > 0 ? `${homeTeamName} strong at home` : `${homeTeamName} weak at home`,
            detail: `Home: ${homeStandings.home_record} (${(atHome.winPct * 100).toFixed(1)}%) vs overall ${(overall.winPct * 100).toFixed(1)}%`
          });
        }
      }
    }

    if (awayStandings?.away_record && awayStandings?.record) {
      const overall = this._parseRecord(awayStandings.record, sport);
      const onRoad = this._parseRecord(awayStandings.away_record, sport);
      if (overall && onRoad && overall.totalGames >= 10 && onRoad.totalGames >= 5) {
        const delta = onRoad.winPct - overall.winPct;
        const impact = Math.max(-0.06, Math.min(0.06, delta * 0.5));
        if (Math.abs(impact) >= 0.005) {
          // Away team stronger on the road → reduces home win prob
          out.push({
            impact: -impact,
            factor: impact > 0 ? `${awayTeamName} strong on road` : `${awayTeamName} weak on road`,
            detail: `Road: ${awayStandings.away_record} (${(onRoad.winPct * 100).toFixed(1)}%) vs overall ${(overall.winPct * 100).toFixed(1)}%`
          });
        }
      }
    }

    return out;
  }

  /**
   * Streak momentum — small probability nudge based on ESPN's streak string
   * ("W5" or "L2"). Active only for streaks of 3+ games; capped at ±2.5%.
   * Research consensus: streaks carry mild predictive value up to ~10 games;
   * beyond that the market usually prices it in. We err conservative.
   */
  _streakAdjustment(streakStr) {
    if (!streakStr || typeof streakStr !== 'string') return 0;
    const m = streakStr.match(/^([WL])(\d+)$/i);
    if (!m) return 0;
    const dir = m[1].toUpperCase();
    const len = Math.min(parseInt(m[2], 10), 10); // clamp effective length
    if (len < 3) return 0;
    // 3 games = 0.5%, 10 games = 2.5%
    const magnitude = 0.005 + (len - 3) * 0.00286;
    return dir === 'W' ? magnitude : -magnitude;
  }

  /**
   * Playoff seed prior — applies only when BOTH teams have an ESPN playoff_seed
   * (so regular-season games are no-ops). Lower seed # = higher seeding.
   * Scales at 0.5% per seed-number differential, capped at ±4%.
   *
   * Note: this is a prior for single-game, not series outcome. Series probabilities
   * are much more lopsided; a single game between 1 and 8 seeds is still ~65/35, not 95/5.
   */
  _playoffSeedAdjustment(homeSeed, awaySeed) {
    if (homeSeed == null || awaySeed == null) return 0;
    // Higher seed # = worse team. Home advantage if away has higher seed number.
    const diff = awaySeed - homeSeed;
    return Math.max(-0.04, Math.min(0.04, diff * 0.005));
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
