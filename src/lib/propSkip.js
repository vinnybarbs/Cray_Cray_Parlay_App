// Why a prop read is a Skip, in one line (owner 2026-10-16: "show all
// props even skips reasoning"). The lean is under our 4 point bar, or it
// is an anytime TD we price below the book, and books sell no "no".
// ourProb and bookProb are for the read's own side. Pure.
export function skipReason(p) {
  if (p.market === 'player_anytime_td' && p.side !== 'over') {
    if (p.ourProb == null || p.bookProb == null) return 'We price his TD chance below the book. Books sell no "no", so no bet.'
    return `We give him a ${Math.round(100 - p.ourProb)}% chance to score, the book ${Math.round(100 - p.bookProb)}%. Books sell no "no", so no bet.`
  }
  const lean = `Lean ${p.side} ${p.line}`
  if (p.ourProb == null || p.bookProb == null) return `${lean}, but under our 4 point bar.`
  return `${lean}, but book says ${Math.round(p.bookProb)}% and we say ${Math.round(p.ourProb)}%. Too close to bet.`
}
