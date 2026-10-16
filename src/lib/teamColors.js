// Team colors keyed by league and code, for the prop card avatar (owner
// 2026-10-12) and the Board's game tracker (2026-10-16). No logos or
// photos: those are licensed, plain colors with our own initials are
// not. `bg` fills the avatar, `accent` is the ring, picked to stay
// visible on the near black card where a team's main color is navy or
// black. `fg` is the initials color that reads on `bg`.
//
// NFL codes are nflverse codes (Rams are LA). The other leagues use
// ESPN's abbreviations, which is what the scoreboard feed carries.
// Codes repeat across leagues (LA is the Rams and the Kings, TB the
// Buccaneers and the Lightning), so lookups take the sport.

const TEAM_COLORS = {
  ARI: { bg: '#97233F', accent: '#E0435F', fg: '#FFFFFF' },
  ATL: { bg: '#A71930', accent: '#E0263F', fg: '#FFFFFF' },
  BAL: { bg: '#241773', accent: '#9E7C0C', fg: '#FFFFFF' },
  BUF: { bg: '#00338D', accent: '#C60C30', fg: '#FFFFFF' },
  CAR: { bg: '#0085CA', accent: '#0085CA', fg: '#FFFFFF' },
  CHI: { bg: '#0B162A', accent: '#C83803', fg: '#FFFFFF' },
  CIN: { bg: '#FB4F14', accent: '#FB4F14', fg: '#000000' },
  CLE: { bg: '#311D00', accent: '#FF3C00', fg: '#FFFFFF' },
  DAL: { bg: '#003594', accent: '#869397', fg: '#FFFFFF' },
  DEN: { bg: '#FB4F14', accent: '#FB4F14', fg: '#002244' },
  DET: { bg: '#0076B6', accent: '#B0B7BC', fg: '#FFFFFF' },
  GB: { bg: '#203731', accent: '#FFB612', fg: '#FFB612' },
  HOU: { bg: '#03202F', accent: '#A71930', fg: '#FFFFFF' },
  IND: { bg: '#002C5F', accent: '#A2AAAD', fg: '#FFFFFF' },
  JAX: { bg: '#006778', accent: '#D7A22A', fg: '#FFFFFF' },
  KC: { bg: '#E31837', accent: '#FFB81C', fg: '#FFFFFF' },
  LV: { bg: '#000000', accent: '#A5ACAF', fg: '#A5ACAF' },
  LAC: { bg: '#0080C6', accent: '#FFC20E', fg: '#FFFFFF' },
  LA: { bg: '#003594', accent: '#FFA300', fg: '#FFD100' },
  MIA: { bg: '#008E97', accent: '#FC4C02', fg: '#FFFFFF' },
  MIN: { bg: '#4F2683', accent: '#FFC62F', fg: '#FFC62F' },
  NE: { bg: '#002244', accent: '#C60C30', fg: '#FFFFFF' },
  NO: { bg: '#101820', accent: '#D3BC8D', fg: '#D3BC8D' },
  NYG: { bg: '#0B2265', accent: '#A71930', fg: '#FFFFFF' },
  NYJ: { bg: '#125740', accent: '#2E9C6E', fg: '#FFFFFF' },
  PHI: { bg: '#004C54', accent: '#A5ACAF', fg: '#FFFFFF' },
  PIT: { bg: '#101820', accent: '#FFB612', fg: '#FFB612' },
  SF: { bg: '#AA0000', accent: '#B3995D', fg: '#FFFFFF' },
  SEA: { bg: '#002244', accent: '#69BE28', fg: '#69BE28' },
  TB: { bg: '#D50A0A', accent: '#FF7900', fg: '#FFFFFF' },
  TEN: { bg: '#0C2340', accent: '#4B92DB', fg: '#FFFFFF' },
  WAS: { bg: '#5A1414', accent: '#FFB612', fg: '#FFB612' },
}

// Older or alternate NFL codes that show up in feeds.
const ALIASES = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA', WSH: 'WAS', JAC: 'JAX' }

const NBA_COLORS = {
  ATL: { bg: '#C8102E', accent: '#FDB927', fg: '#FFFFFF' },
  BOS: { bg: '#007A33', accent: '#BA9653', fg: '#FFFFFF' },
  BKN: { bg: '#000000', accent: '#9EA1A8', fg: '#FFFFFF' },
  CHA: { bg: '#1D1160', accent: '#00788C', fg: '#FFFFFF' },
  CHI: { bg: '#CE1141', accent: '#CE1141', fg: '#FFFFFF' },
  CLE: { bg: '#6F263D', accent: '#FFB81C', fg: '#FFFFFF' },
  DAL: { bg: '#00538C', accent: '#B8C4CA', fg: '#FFFFFF' },
  DEN: { bg: '#0E2240', accent: '#FEC524', fg: '#FEC524' },
  DET: { bg: '#C8102E', accent: '#1D42BA', fg: '#FFFFFF' },
  GS: { bg: '#1D428A', accent: '#FFC72C', fg: '#FFC72C' },
  HOU: { bg: '#CE1141', accent: '#CE1141', fg: '#FFFFFF' },
  IND: { bg: '#002D62', accent: '#FDBB30', fg: '#FDBB30' },
  LAC: { bg: '#C8102E', accent: '#1D428A', fg: '#FFFFFF' },
  LAL: { bg: '#552583', accent: '#FDB927', fg: '#FDB927' },
  MEM: { bg: '#5D76A9', accent: '#12173F', fg: '#FFFFFF' },
  MIA: { bg: '#98002E', accent: '#F9A01B', fg: '#FFFFFF' },
  MIL: { bg: '#00471B', accent: '#EEE1C6', fg: '#EEE1C6' },
  MIN: { bg: '#0C2340', accent: '#78BE20', fg: '#FFFFFF' },
  NO: { bg: '#0C2340', accent: '#C8102E', fg: '#FFFFFF' },
  NY: { bg: '#006BB6', accent: '#F58426', fg: '#FFFFFF' },
  OKC: { bg: '#007AC1', accent: '#EF3B24', fg: '#FFFFFF' },
  ORL: { bg: '#0077C0', accent: '#C4CED4', fg: '#FFFFFF' },
  PHI: { bg: '#006BB6', accent: '#ED174C', fg: '#FFFFFF' },
  PHX: { bg: '#1D1160', accent: '#E56020', fg: '#FFFFFF' },
  POR: { bg: '#E03A3E', accent: '#E03A3E', fg: '#FFFFFF' },
  SAC: { bg: '#5A2D81', accent: '#63727A', fg: '#FFFFFF' },
  SA: { bg: '#000000', accent: '#C4CED4', fg: '#C4CED4' },
  TOR: { bg: '#CE1141', accent: '#CE1141', fg: '#FFFFFF' },
  UTAH: { bg: '#002B5C', accent: '#F9A01B', fg: '#FFFFFF' },
  WSH: { bg: '#002B5C', accent: '#E31837', fg: '#FFFFFF' },
}

const NHL_COLORS = {
  ANA: { bg: '#F47A38', accent: '#B9975B', fg: '#000000' },
  BOS: { bg: '#000000', accent: '#FFB81C', fg: '#FFB81C' },
  BUF: { bg: '#003087', accent: '#FFB81C', fg: '#FFB81C' },
  CGY: { bg: '#D2001C', accent: '#FAAF19', fg: '#FFFFFF' },
  CAR: { bg: '#CE1126', accent: '#A4A9AD', fg: '#FFFFFF' },
  CHI: { bg: '#CF0A2C', accent: '#CF0A2C', fg: '#FFFFFF' },
  COL: { bg: '#6F263D', accent: '#236192', fg: '#FFFFFF' },
  CBJ: { bg: '#002654', accent: '#CE1126', fg: '#FFFFFF' },
  DAL: { bg: '#006847', accent: '#8F8F8C', fg: '#FFFFFF' },
  DET: { bg: '#CE1126', accent: '#CE1126', fg: '#FFFFFF' },
  EDM: { bg: '#041E42', accent: '#FF4C00', fg: '#FF4C00' },
  FLA: { bg: '#041E42', accent: '#C8102E', fg: '#FFFFFF' },
  LA: { bg: '#111111', accent: '#A2AAAD', fg: '#A2AAAD' },
  MIN: { bg: '#154734', accent: '#A6192E', fg: '#FFFFFF' },
  MTL: { bg: '#AF1E2D', accent: '#192168', fg: '#FFFFFF' },
  NSH: { bg: '#FFB81C', accent: '#041E42', fg: '#041E42' },
  NJ: { bg: '#CE1126', accent: '#000000', fg: '#FFFFFF' },
  NYI: { bg: '#00539B', accent: '#F47D30', fg: '#FFFFFF' },
  NYR: { bg: '#0038A8', accent: '#CE1126', fg: '#FFFFFF' },
  OTT: { bg: '#000000', accent: '#DA1A32', fg: '#DA1A32' },
  PHI: { bg: '#F74902', accent: '#F74902', fg: '#000000' },
  PIT: { bg: '#000000', accent: '#FCB514', fg: '#FCB514' },
  SJ: { bg: '#006D75', accent: '#EA7200', fg: '#FFFFFF' },
  SEA: { bg: '#001628', accent: '#99D9D9', fg: '#99D9D9' },
  STL: { bg: '#002F87', accent: '#FCB514', fg: '#FCB514' },
  TB: { bg: '#002868', accent: '#9EA1A8', fg: '#FFFFFF' },
  TOR: { bg: '#00205B', accent: '#9EA1A8', fg: '#FFFFFF' },
  UTA: { bg: '#71AFE5', accent: '#090909', fg: '#090909' },
  VAN: { bg: '#00205B', accent: '#00843D', fg: '#FFFFFF' },
  VGK: { bg: '#333F42', accent: '#B4975A', fg: '#B4975A' },
  WSH: { bg: '#C8102E', accent: '#041E42', fg: '#FFFFFF' },
  WPG: { bg: '#041E42', accent: '#004C97', fg: '#FFFFFF' },
}

const MLB_COLORS = {
  ARI: { bg: '#A71930', accent: '#E3D4AD', fg: '#FFFFFF' },
  ATL: { bg: '#CE1141', accent: '#13274F', fg: '#FFFFFF' },
  BAL: { bg: '#DF4601', accent: '#DF4601', fg: '#000000' },
  BOS: { bg: '#BD3039', accent: '#0C2340', fg: '#FFFFFF' },
  CHC: { bg: '#0E3386', accent: '#CC3433', fg: '#FFFFFF' },
  CHW: { bg: '#27251F', accent: '#C4CED4', fg: '#C4CED4' },
  CIN: { bg: '#C6011F', accent: '#C6011F', fg: '#FFFFFF' },
  CLE: { bg: '#00385D', accent: '#E50022', fg: '#FFFFFF' },
  COL: { bg: '#333366', accent: '#C4CED4', fg: '#FFFFFF' },
  DET: { bg: '#0C2340', accent: '#FA4616', fg: '#FFFFFF' },
  HOU: { bg: '#002D62', accent: '#EB6E1F', fg: '#EB6E1F' },
  KC: { bg: '#004687', accent: '#BD9B60', fg: '#FFFFFF' },
  LAA: { bg: '#BA0021', accent: '#003263', fg: '#FFFFFF' },
  LAD: { bg: '#005A9C', accent: '#005A9C', fg: '#FFFFFF' },
  MIA: { bg: '#00A3E0', accent: '#EF3340', fg: '#000000' },
  MIL: { bg: '#12284B', accent: '#FFC52F', fg: '#FFC52F' },
  MIN: { bg: '#002B5C', accent: '#D31145', fg: '#FFFFFF' },
  NYM: { bg: '#002D72', accent: '#FF5910', fg: '#FF5910' },
  NYY: { bg: '#0C2340', accent: '#C4CED3', fg: '#FFFFFF' },
  OAK: { bg: '#003831', accent: '#EFB21E', fg: '#EFB21E' },
  ATH: { bg: '#003831', accent: '#EFB21E', fg: '#EFB21E' },
  PHI: { bg: '#E81828', accent: '#002D72', fg: '#FFFFFF' },
  PIT: { bg: '#27251F', accent: '#FDB827', fg: '#FDB827' },
  SD: { bg: '#2F241D', accent: '#FFC425', fg: '#FFC425' },
  SF: { bg: '#FD5A1E', accent: '#27251F', fg: '#000000' },
  SEA: { bg: '#0C2C56', accent: '#005C5C', fg: '#C4CED4' },
  STL: { bg: '#C41E3A', accent: '#0C2340', fg: '#FFFFFF' },
  TB: { bg: '#092C5C', accent: '#8FBCE6', fg: '#8FBCE6' },
  TEX: { bg: '#003278', accent: '#C0111F', fg: '#FFFFFF' },
  TOR: { bg: '#134A8E', accent: '#1D2D5C', fg: '#FFFFFF' },
  WSH: { bg: '#AB0003', accent: '#14225A', fg: '#FFFFFF' },
}

const LEAGUES = { NFL: TEAM_COLORS, NBA: NBA_COLORS, NHL: NHL_COLORS, MLB: MLB_COLORS }

/** Colors for a team code. The sport picks the league, NFL by default. */
export function teamColors(code, sport = 'NFL') {
  if (!code) return null
  const c = String(code).toUpperCase()
  const league = LEAGUES[String(sport || 'NFL').toUpperCase()]
  if (!league) return null
  return league[league === TEAM_COLORS ? (ALIASES[c] || c) : c] || null
}

export default TEAM_COLORS
