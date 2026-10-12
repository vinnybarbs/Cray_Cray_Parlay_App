// NFL team colors keyed by nflverse code (Rams are LA), for the prop card
// avatar and stripe (owner 2026-10-12). No logos or photos: those are
// licensed, plain colors with our own initials are not. `bg` fills the
// avatar, `accent` is the ring and stripe, picked to stay visible on the
// near black card where a team's main color is navy or black. `fg` is the
// initials color that reads on `bg`.

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

// Older or alternate codes that show up in feeds.
const ALIASES = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA', WSH: 'WAS', JAC: 'JAX' }

export function teamColors(code) {
  if (!code) return null
  const c = String(code).toUpperCase()
  return TEAM_COLORS[ALIASES[c] || c] || null
}

export default TEAM_COLORS
