// Multi-Sport API-Sports Client
// Extends the existing NFL-only client to support NBA, NHL, MLB, NCAAB
// Each sport uses a different subdomain on api-sports.io

const { logger } = require('../../shared/logger');

const SPORT_CONFIG = {
  NFL: {
    baseUrl: 'https://v1.american-football.api-sports.io',
    host: 'v1.american-football.api-sports.io',
    league: 1,
    seasonFormat: 'year',     // e.g. 2025
    endpoints: {
      games: 'games',
      standings: 'standings',
      teams: 'teams',
      players: 'players',
      injuries: 'injuries',
      teamStats: 'games/statistics/teams',
      playerStats: 'games/statistics/players',
      odds: 'odds'
    }
  },
  NCAAF: {
    baseUrl: 'https://v1.american-football.api-sports.io',
    host: 'v1.american-football.api-sports.io',
    league: 2,
    seasonFormat: 'year',
    endpoints: {
      games: 'games',
      standings: 'standings',
      teams: 'teams',
      players: 'players',
      injuries: 'injuries',
      teamStats: 'games/statistics/teams',
      playerStats: 'games/statistics/players'
    }
  },
  NBA: {
    baseUrl: 'https://v2.nba.api-sports.io',
    host: 'v2.nba.api-sports.io',
    league: 12,              // NBA standard league
    seasonFormat: 'year-year', // e.g. 2025-2026
    endpoints: {
      games: 'games',
      standings: 'standings',
      teams: 'teams',
      players: 'players',
      teamStats: 'games/statistics',    // team stats per game
      playerStats: 'players/statistics', // player season stats
      odds: null  // not available
    }
  },
  NCAAB: {
    // API-Sports doesn't have a dedicated NCAAB basketball API
    // We use ESPN for NCAAB — this is a placeholder for awareness
    baseUrl: null,
    host: null,
    league: null,
    seasonFormat: null,
    endpoints: {}
  },
  NHL: {
    baseUrl: 'https://v1.hockey.api-sports.io',
    host: 'v1.hockey.api-sports.io',
    league: 57,              // NHL league ID
    seasonFormat: 'year',
    endpoints: {
      games: 'games',
      standings: 'standings',
      teams: 'teams',
      players: 'players',
      teamStats: 'games/statistics/teams',
      playerStats: 'games/statistics/players'
    }
  },
  MLB: {
    baseUrl: 'https://v1.baseball.api-sports.io',
    host: 'v1.baseball.api-sports.io',
    league: 1,               // MLB league ID
    seasonFormat: 'year',
    endpoints: {
      games: 'games',
      standings: 'standings',
      teams: 'teams',
      players: 'players',
      teamStats: 'games/statistics',
      playerStats: 'players/statistics'
    }
  }
};

class ApiSportsMulti {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.APISPORTS_API_KEY;
    this.callCount = 0;
    this.dailyLimit = 7500;
  }

  getConfig(sport) {
    const cfg = SPORT_CONFIG[sport.toUpperCase()];
    if (!cfg || !cfg.baseUrl) return null;
    return cfg;
  }

  getCurrentSeason(sport) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const cfg = this.getConfig(sport);
    if (!cfg) return year;

    if (cfg.seasonFormat === 'year-year') {
      // NBA: season 2025-2026 runs Oct 2025 - Jun 2026
      return month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
    }
    // NFL/NHL/MLB: simple year
    if (sport === 'NFL' || sport === 'NCAAF') {
      return month >= 8 ? year : year - 1;
    }
    return year;
  }

  async request(sport, endpoint, params = {}) {
    const cfg = this.getConfig(sport);
    if (!cfg) throw new Error(`No API-Sports config for ${sport}`);

    if (this.callCount >= this.dailyLimit) {
      throw new Error(`API quota exceeded: ${this.callCount}/${this.dailyLimit}`);
    }

    const url = new URL(`${cfg.baseUrl}/${endpoint}`);
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== null) url.searchParams.append(key, val);
    }

    const response = await fetch(url, {
      headers: { 'x-apisports-key': this.apiKey }
    });

    this.callCount++;

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`API-Sports ${sport} ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    if (data.errors && Object.keys(data.errors).length > 0) {
      throw new Error(`API-Sports error: ${JSON.stringify(data.errors)}`);
    }

    return data;
  }

  // ─── GAMES ───

  async getGamesByDate(sport, date) {
    const cfg = this.getConfig(sport);
    if (!cfg) return { response: [] };
    return this.request(sport, cfg.endpoints.games, { league: cfg.league, date });
  }

  async getSeasonGames(sport, season) {
    const cfg = this.getConfig(sport);
    if (!cfg) return { response: [] };
    season = season || this.getCurrentSeason(sport);
    return this.request(sport, cfg.endpoints.games, { league: cfg.league, season });
  }

  // ─── STANDINGS ───

  async getStandings(sport, season) {
    const cfg = this.getConfig(sport);
    if (!cfg) return { response: [] };
    season = season || this.getCurrentSeason(sport);
    return this.request(sport, cfg.endpoints.standings, { league: cfg.league, season });
  }

  // ─── TEAM STATS ───

  async getGameTeamStats(sport, gameId) {
    const cfg = this.getConfig(sport);
    if (!cfg?.endpoints?.teamStats) return { response: [] };

    // NBA uses different param name
    if (sport === 'NBA') {
      return this.request(sport, cfg.endpoints.teamStats, { id: gameId });
    }
    return this.request(sport, cfg.endpoints.teamStats, { game: gameId });
  }

  // ─── PLAYER STATS ───

  async getGamePlayerStats(sport, gameId) {
    const cfg = this.getConfig(sport);
    if (!cfg?.endpoints?.playerStats) return { response: [] };

    if (sport === 'NBA') {
      // NBA player stats are per-season, not per-game on this endpoint
      return this.request(sport, cfg.endpoints.playerStats, { game: gameId });
    }
    return this.request(sport, cfg.endpoints.playerStats, { game: gameId });
  }

  // ─── INJURIES ───

  async getInjuries(sport) {
    const cfg = this.getConfig(sport);
    if (!cfg?.endpoints?.injuries) return { response: [] };
    return this.request(sport, cfg.endpoints.injuries, { league: cfg.league });
  }

  async getTeamInjuries(sport, teamId) {
    const cfg = this.getConfig(sport);
    if (!cfg?.endpoints?.injuries) return { response: [] };
    return this.request(sport, cfg.endpoints.injuries, { team: teamId });
  }

  // ─── TEAMS ───

  async getTeams(sport, season) {
    const cfg = this.getConfig(sport);
    if (!cfg) return { response: [] };
    season = season || this.getCurrentSeason(sport);
    return this.request(sport, cfg.endpoints.teams, { league: cfg.league, season });
  }

  // ─── ODDS (NFL only) ───

  async getOdds(sport, gameId) {
    const cfg = this.getConfig(sport);
    if (!cfg?.endpoints?.odds) return { response: [] };
    return this.request(sport, cfg.endpoints.odds, { game: gameId });
  }

  // ─── UTILITY ───

  getRemainingCalls() { return this.dailyLimit - this.callCount; }
  canMakeCall(n = 1) { return this.callCount + n <= this.dailyLimit; }
  resetCallCounter() { this.callCount = 0; }

  getSupportedSports() {
    return Object.keys(SPORT_CONFIG).filter(s => SPORT_CONFIG[s].baseUrl !== null);
  }
}

module.exports = { ApiSportsMulti, SPORT_CONFIG };
