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
