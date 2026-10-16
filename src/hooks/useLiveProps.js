import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

// The live props tracker feed (owner 2026-10-16). One shared poll of
// /api/props/live for the whole page, however many started cards
// subscribe, every POLL_MS while at least one is mounted and the tab is
// visible. Each card reads its own line by key.
//
// Shape: { games: { [gameKey]: { state, final, detail, homeScore, awayScore, homeAbbr, awayAbbr } },
//          reads: { [readKey]: { current, status, final } }, asOf }

const POLL_MS = 30 * 1000

export const liveReadKey = (p) => `${p.playerKey || p.player}|${p.market}|${p.side}|${p.line}`
export const liveGameKey = (p) => `${p.away_team}|${p.home_team}|${p.commence_time}`

let snapshot = null
let timer = null
let inFlight = false
const listeners = new Set()

async function poll() {
  if (inFlight || (typeof document !== 'undefined' && document.hidden)) return
  inFlight = true
  try {
    const r = await apiFetch('/api/props/live')
    if (r.ok) {
      snapshot = await r.json()
      listeners.forEach(fn => fn(snapshot))
    }
  } catch { /* keep the last snapshot */ } finally {
    inFlight = false
  }
}

function subscribe(fn) {
  listeners.add(fn)
  if (!timer) {
    poll()
    timer = setInterval(poll, POLL_MS)
  }
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null }
  }
}

/** The live feed while enabled, else null. */
export default function useLiveProps(enabled = true) {
  const [data, setData] = useState(enabled ? snapshot : null)
  useEffect(() => {
    if (!enabled) return undefined
    setData(snapshot)
    return subscribe(setData)
  }, [enabled])
  return enabled ? data : null
}
