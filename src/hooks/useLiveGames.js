import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

// The Board's game tracker feed (owner 2026-10-16). One shared poll of
// /api/digest/live for the whole page, however many started cards
// subscribe, every POLL_MS while at least one is mounted and the tab is
// visible. Each card reads its own game by game_key.
//
// Shape: { games: { [game_key]: { state, final, detail, period, clock,
//          home: { name, short, abbr, score, possession }, away: {...},
//          downDistance, pick: standing | null, alts: { [pick]: standing }, traps: { [side]: standing } } },
//          asOf }
// standing: { status: ahead | behind | even | won | lost | push, label, note }

const POLL_MS = 30 * 1000

let snapshot = null
let timer = null
let inFlight = false
const listeners = new Set()

async function poll() {
  if (inFlight || (typeof document !== 'undefined' && document.hidden)) return
  inFlight = true
  try {
    const r = await apiFetch('/api/digest/live')
    if (r.ok) {
      snapshot = await r.json()
      listeners.forEach(fn => fn(snapshot))
    }
  } catch { /* keep the last snapshot */ } finally {
    inFlight = false
  }
}

function onVisible() {
  if (typeof document !== 'undefined' && !document.hidden && listeners.size) poll()
}

function subscribe(fn) {
  listeners.add(fn)
  if (!timer) {
    poll()
    timer = setInterval(poll, POLL_MS)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  }
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    }
  }
}

/** The live feed while enabled, else null. */
export default function useLiveGames(enabled = true) {
  const [data, setData] = useState(enabled ? snapshot : null)
  useEffect(() => {
    if (!enabled) return undefined
    setData(snapshot)
    return subscribe(setData)
  }, [enabled])
  return enabled ? data : null
}
