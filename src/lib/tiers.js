// The grading language, in one place. Every surface (digest, generator,
// landing, ledger) speaks signed percentage-point edges and these six tiers.
// Cutoffs are product law: change them here or nowhere.
//
// We deliberately avoid "Lock" because it recreates the "guaranteed-win" mental
// model the old 10/10 edge_score caused. Negative edges get their own tier
// so we never silently dress them up.

// Strong Play merged into Play 2026-08-10: the 4-7 and 7-10 bands were
// statistically indistinguishable and both carried negative CLV, so the
// split labeled noise as signal. Historical rows keep their stored
// 'Strong Play' tier (the record is append only), which is why renderers
// must still map that label, see legacyTier below.
export const TIERS = [
  { label: 'Sharp Take',  subtitle: 'sharp take', range: '10pp+',   min: 10,        max: Infinity },
  { label: 'Play',        subtitle: 'play it',    range: '4-10pp',  min: 4,         max: 10 },
  { label: 'Lean',        subtitle: 'lean it',    range: '2-4pp',   min: 2,         max: 4 },
  { label: 'Skip',        subtitle: 'pass on it', range: '-2-2pp',  min: -2,        max: 2 },
  { label: 'Trap',        subtitle: 'fade it',    range: '-2pp or worse', min: -Infinity, max: -2 },
]

export function tierRange(label) {
  const t = TIERS.find(t => t.label === label)
  return t ? t.range : null
}

// 6-tier label scheme from signed edge in percentage points.
// Sharp-Quant aesthetic: graphite frame + amber/crimson signal accent.
export function edgeTier(signedPp) {
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
  if (signedPp < 4) {
    return { label: 'Lean', subtitle: 'lean it', color: 'text-signal-pos/80', bg: 'bg-ink-850 shadow-hairline' }
  }
  if (signedPp < 10) {
    return { label: 'Play', subtitle: 'play it', color: 'text-signal-pos', bg: 'bg-ink-850 shadow-hairline' }
  }
  return { label: 'Sharp Take', subtitle: 'sharp take', color: 'text-signal-pos', bg: 'bg-signal-pos-dim/40 shadow-hairline-pos-bright' }
}

// Historical rows persisted before 2026-08-10 carry 'Strong Play'. Render
// them with the Play styling so old ledger rows never show an unstyled tier.
export function legacyTier(label) {
  if (label === 'Strong Play') {
    return { label: 'Strong Play', subtitle: 'play it', color: 'text-signal-pos', bg: 'bg-ink-850 shadow-hairline' }
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
