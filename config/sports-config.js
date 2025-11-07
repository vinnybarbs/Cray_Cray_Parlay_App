/**
 * Sports and markets configuration for odds caching
 */

// Sports to fetch odds for
const SPORTS = [
  'americanfootball_nfl',
  'americanfootball_ncaaf',
  'basketball_nba',
  'icehockey_nhl',
  'soccer_epl'
];

// Only fetch bookmakers available in the app
const BOOKMAKERS = 'draftkings,fanduel,betmgm,caesars';

// Core markets available for all sports
const CORE_MARKETS = 'h2h,spreads,totals';

// Player props by sport (require per-event endpoint)
const PROP_MARKETS = {
  americanfootball_nfl: [
    'player_pass_tds',
    'player_pass_yds',
    'player_pass_completions',
    'player_pass_attempts',
    'player_pass_interceptions',
    'player_rush_yds',
    'player_rush_attempts',
    'player_receptions',
    'player_reception_yds',
    'player_anytime_td'
  ],
  americanfootball_ncaaf: [
    'player_pass_tds',
    'player_pass_yds',
    'player_rush_yds',
    'player_anytime_td'
  ]
};

// Team props
const TEAM_PROPS = 'team_totals';

// API configuration
const API_CONFIG = {
  regions: 'us',
  oddsFormat: 'american',
  dateFormat: 'iso'
};

// Rate limiting
const RATE_LIMITS = {
  betweenSports: 7000, // 7s delay between sports
  betweenProps: 2000,  // 2s delay between prop calls
  maxPropsGames: 20    // Max games to fetch props for
};

module.exports = {
  SPORTS,
  BOOKMAKERS,
  CORE_MARKETS,
  PROP_MARKETS,
  TEAM_PROPS,
  API_CONFIG,
  RATE_LIMITS
};
