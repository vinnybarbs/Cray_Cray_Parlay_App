// Game times render in the viewer's own time zone with the zone shown
// ("6:40 PM MDT"), and the date rides along with the time. Evening games
// land on the next UTC date, so a bare time or a bare date misleads
// anyone near midnight. Never show one without the other on a tile.

export function fmtGameTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

// "Tue, Jul 21 · 6:40 PM MDT"
export function fmtGameDateTime(iso) {
  if (!iso) return null
  const day = new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  return `${day} · ${fmtGameTime(iso)}`
}

// "Tue, Jul 21"
export function fmtGameDay(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

// "Tuesday, July 21, 2026" for page headers
export function fmtFullDate(iso) {
  const d = iso ? new Date(iso) : new Date()
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// Calendar days from `now` to the game, counted on the viewer's own
// calendar (or `timeZone` when given), so a Saturday game seen on a
// Wednesday night is 3, not "tomorrow". Null when the date is missing.
export function daysUntilGame(iso, now = new Date(), timeZone) {
  if (!iso) return null
  const ymd = (d) => new Date(d).toLocaleDateString('en-CA', timeZone ? { timeZone } : undefined)
  const [y1, m1, d1] = ymd(now).split('-').map(Number)
  const [y2, m2, d2] = ymd(iso).split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

// The chip on a game that is not today: "Tomorrow" or "In 3 days".
// Null for today and for anything already past.
export function gameDayChip(iso, now = new Date(), timeZone) {
  const days = daysUntilGame(iso, now, timeZone)
  if (days == null || days < 1) return null
  return days === 1 ? 'Tomorrow' : `In ${days} days`
}
