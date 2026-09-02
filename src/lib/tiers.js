// The grading language, in one place. Every surface (digest, generator,
// landing, ledger) speaks signed percentage-point edges and these six tiers.
// Cutoffs are product law: change them here or nowhere.
//
// We deliberately avoid "Lock" because it recreates the "guaranteed-win" mental
// model the old 10/10 edge_score caused. Negative edges get their own tier
// so we never silently dress them up.

// Shadow sports: the model's reads compute and display for transparency,
// but nothing publishes, grades, or alerts until go-live, so NO surface
// may dress a shadow read in bet-tier language. The digest greys them
// out; The Board excludes them from its pick list entirely (2026-08-28:
// a record-less NCAAF week-1 read put New Mexico State +3000 on the
// board as a Strong Play). Mirror of SHADOW_SPORTS in pre-analyze.
export const SHADOW_SPORTS = new Set(['NFL', 'NCAAF', 'EPL', 'MLS', 'Soccer', 'World Cup', 'Champions League', 'Copa America', 'Euros'])

// Strong Play restored 2026-08-16 at 7-10pp (owner decision: 7pp is the
// betting floor, so that band earns its own label). It was merged into
// Play from 2026-08-10 to 2026-08-16, rows stamped in that window may
// carry 7-10pp edges under the 'Play' label, the record is append only.
export const TIERS = [
  { label: 'Sharp Take',  subtitle: 'sharp take',  range: '10pp+',   min: 10,        max: Infinity },
  { label: 'Strong Play', subtitle: 'strong play', range: '7-10pp',  min: 7,         max: 10 },
  { label: 'Play',        subtitle: 'play it',     range: '4-7pp',   min: 4,         max: 7 },
  { label: 'Lean',        subtitle: 'lean it',     range: '2-4pp',   min: 2,         max: 4 },
  { label: 'Skip',        subtitle: 'pass on it',  range: '-2-2pp',  min: -2,        max: 2 },
  { label: 'Trap',        subtitle: 'fade it',     range: '-2pp or worse', min: -Infinity, max: -2 },
]

export function tierRange(label) {
  const t = TIERS.find(t => t.label === label)
  return t ? t.range : null
}

// Sharp Take chalk fence: no Sharp Take heavier than -150. Break-even at
// -150 is 60 percent, and heavy-chalk claimed edges measured as mostly
// vig (45d: chalk Sharp Takes +2.8u vs dog Sharp Takes +25.3u). Must
// stay in lockstep with lib/services/pick-grader.js.
const SHARP_TAKE_PRICE_FENCE = -150

// Longshot tier ceiling (owner rule 2026-09-02): a side priced +300 or
// longer is never labeled above Lean, whatever the claimed edge. Mirror
// of lib/services/pick-grader.js, see the rationale there.
const LONGSHOT_TIER_CEILING_ODDS = 300

// Break-even win percentage for an American price: risk / (risk + win).
// -150 needs 60.0, -180 needs 64.3, +122 needs only 45.0.
export function breakEvenPct(americanOdds) {
  const o = Number(String(americanOdds ?? '').replace(/[^0-9-]/g, ''))
  if (!Number.isFinite(o) || o === 0) return null
  return o > 0 ? 100 * 100 / (o + 100) : 100 * -o / (-o + 100)
}

// Tier label scheme from signed edge in percentage points, plus the price
// fence when the pick's American odds are known.
// Sharp-Quant aesthetic: graphite frame + amber/crimson signal accent.
export function edgeTier(signedPp, americanOdds = null) {
  if (signedPp == null || Number.isNaN(signedPp)) {
    return { label: '-', subtitle: '', color: 'text-ink-400', bg: 'bg-ink-850 shadow-hairline' }
  }
  // Trap is a directional call: this side is at least 2pp below fair, so
  // fading it is honest advice. The -2 to +2 band is noise and reads Skip.
  // Mirror of the +2pp Lean gate.
  if (signedPp <= -2) {
    return { label: 'Trap', subtitle: 'fade it', color: 'text-signal-neg', bg: 'bg-signal-neg-dim/30 shadow-hairline-neg' }
  }
  if (signedPp < 2) {
    return { label: 'Skip', subtitle: 'pass on it', color: 'text-ink-300', bg: 'bg-ink-850 shadow-hairline' }
  }
  const oCeil = americanOdds != null ? Number(String(americanOdds).replace(/[^0-9-]/g, '')) : null
  if (oCeil != null && Number.isFinite(oCeil) && oCeil >= LONGSHOT_TIER_CEILING_ODDS) {
    return { label: 'Lean', subtitle: 'lean it', color: 'text-signal-pos/80', bg: 'bg-ink-850 shadow-hairline' }
  }
  if (signedPp < 4) {
    return { label: 'Lean', subtitle: 'lean it', color: 'text-signal-pos/80', bg: 'bg-ink-850 shadow-hairline' }
  }
  if (signedPp < 7) {
    return { label: 'Play', subtitle: 'play it', color: 'text-signal-pos', bg: 'bg-ink-850 shadow-hairline' }
  }
  if (signedPp < 10) {
    return { label: 'Strong Play', subtitle: 'strong play', color: 'text-signal-pos', bg: 'bg-signal-pos-dim/25 shadow-hairline-pos' }
  }
  const o = americanOdds != null ? Number(String(americanOdds).replace(/[^0-9-]/g, '')) : null
  // Fenced 10pp+ chalk drops one rung to Strong Play, mirror of pick-grader.
  if (o != null && Number.isFinite(o) && o < 0 && o <= SHARP_TAKE_PRICE_FENCE) {
    return { label: 'Strong Play', subtitle: 'strong play', color: 'text-signal-pos', bg: 'bg-signal-pos-dim/25 shadow-hairline-pos' }
  }
  return { label: 'Sharp Take', subtitle: 'sharp take', color: 'text-signal-pos', bg: 'bg-signal-pos-dim/40 shadow-hairline-pos-bright' }
}

// Strong Play is a live tier again (2026-08-16), so no legacy remap is
// needed. Kept as a no-op passthrough because renderers still call it for
// rows whose stored tier is not in TIERS.
export function legacyTier(label) {
  if (label === 'Strong Play') {
    return { label: 'Strong Play', subtitle: 'strong play', color: 'text-signal-pos', bg: 'bg-signal-pos-dim/25 shadow-hairline-pos' }
  }
  return null
}

export function formatPp(signedPp) {
  if (signedPp == null) return null
  const v = Number(signedPp)
  if (Number.isNaN(v)) return null
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}pp`
}

// Convert the game.edges dict (signed fractions) into pp for a given side key.
export function edgePpForSide(edges, side) {
  if (!edges || side == null) return null
  const v = edges[side]
  if (v == null) return null
  return Number((v * 100).toFixed(1))
}

// Real odds for the recommended side. recommended_odds is captured at
// analysis time server-side; rows analyzed before that column existed still
// carry ML prices on the row. When no real price is known we send null,
// never a made-up -110, downstream lock records feed the settlement ledger.
export function lockOddsFor(game) {
  if (game.recommended_odds != null) return game.recommended_odds
  if (game.recommended_side === 'home_ml') return game.moneyline_home ?? null
  if (game.recommended_side === 'away_ml') return game.moneyline_away ?? null
  return null
}

export function pickIdFor(game) {
  return `${game.home_team}-${game.away_team}-${game.recommended_side || 'pick'}`
}

export function buildLockedPayload(game, sport) {
  return {
    id: pickIdFor(game),
    sport,
    homeTeam: game.home_team,
    awayTeam: game.away_team,
    pick: game.recommended_pick,
    betType: game.recommended_side || 'Moneyline/Spread',
    odds: lockOddsFor(game),
    model: game.model_used || null,
    confidence: game.edge_score || 7,
    reasoning: game.analysis_snippet || '',
    gameDate: game.game_date,
  }
}
