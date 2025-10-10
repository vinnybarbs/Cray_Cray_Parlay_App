/**
 * Shared Constants
 * Centralized configuration to avoid duplication across files
 */

const SPORT_SLUGS = {
  NFL: 'americanfootball_nfl',
  NBA: 'basketball_nba',
  MLB: 'baseball_mlb',
  NHL: 'icehockey_nhl',
  Soccer: 'soccer_epl',
  NCAAF: 'americanfootball_ncaaf',
  'PGA/Golf': 'golf_pga',
  Tennis: 'tennis_atp',
  UFC: 'mma_ufc',
};

// Valid market keys per The Odds API documentation
// https://the-odds-api.com/sports-odds-data/betting-markets.html
const MARKET_MAPPING = {
  // User-selectable bet types
  'Moneyline/Spread': ['h2h', 'spreads'],
  'Totals (O/U)': ['totals'],
  'Player Props': [
    // NFL/Football player props
    'player_pass_yds', 'player_pass_tds', 'player_pass_completions', 'player_pass_attempts',
    'player_rush_yds', 'player_rush_tds', 'player_rush_attempts',
    'player_receptions', 'player_reception_yds', 'player_reception_tds',
    // Basketball player props
    'player_points', 'player_rebounds', 'player_assists', 'player_threes',
    // Hockey player props  
    'player_shots_on_goal', 'player_goals',
    // Baseball player props
    'batter_hits', 'batter_home_runs', 'pitcher_strikeouts'
  ],
  'TD Props': [
    // Valid touchdown markets per API docs
    'player_pass_tds',        // Pass TDs (Over/Under)
    'player_rush_tds',        // Rush TDs (Over/Under) 
    'player_reception_tds',   // Reception TDs (Over/Under)
    'player_anytime_td',      // Anytime TD Scorer (Yes/No)
    'player_1st_td',          // 1st TD Scorer (Yes/No)
    'player_last_td'          // Last TD Scorer (Yes/No)
  ],
  'Team Props': ['team_totals'],
  // Internal keys for smart auto-expansion (not user-selectable)
  '_player_props': [
    'player_pass_yds', 'player_rush_yds', 'player_receptions', 'player_reception_yds',
    'player_pass_tds', 'player_anytime_td'
  ],
  '_team_props': ['team_totals'],
};

const BOOKMAKER_MAPPING = {
  DraftKings: 'draftkings',
  FanDuel: 'fanduel',
  MGM: 'mgm',
  Caesars: 'caesars',
  Bet365: 'bet365',
};

const RISK_LEVEL_DEFINITIONS = {
  Low: "High probability to hit, heavy favorites, +200 to +400 odds.",
  Medium: "Balanced value favorites with moderate props, +400 to +600 odds.",
  High: "Value underdogs and high-variance outcomes, +600+ odds.",
};

module.exports = {
  SPORT_SLUGS,
  MARKET_MAPPING,
  BOOKMAKER_MAPPING,
  RISK_LEVEL_DEFINITIONS
};
