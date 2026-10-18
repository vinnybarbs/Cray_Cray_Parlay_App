import React, { useCallback, useEffect, useMemo, useState } from 'react'
import InstallButton from '../components/InstallButton'
import { useNavigate } from 'react-router-dom'
import BrandMark, { SignOutButton } from '../components/BrandMark'
import { TopNav } from '../components/TabBar'
import PropCard, { fmtUnits, SkipCard } from '../components/PropCard'
import { API_BASE_URL as API_BASE } from '../config'
import { SkeletonList } from '../components/Skeleton'
import { apiFetch } from '../lib/api'
import { groupByGame, sortProps } from '../lib/propGames'
import { teamColors } from '../lib/teamColors'
import { fmtGameDateTime } from '../lib/gameTime'
import { LiveNowRail } from '../components/LiveScoreboard'
import useLiveGames from '../hooks/useLiveGames'
import { findByMatchup, liveNowItems } from '../lib/liveNow'

// Props (shadow), owner 2026-10-12. Every NFL player prop read at 4
// points or more, the recent results and the shadow record by market.
// Under each game, every other read we have shows as a Skip with its
// numbers (owner 2026-10-16), so the whole game can be researched here.
// Props are not picks yet: they publish only when the shadow record and
// the closing line clear the bar (build_queue 65), and nothing here
// counts toward the official record.

// How often the board refetches while a game on it is on, so grades
// show without a reload. The server caches the signed in response for
// 20 seconds, so this costs two queries a minute per open page.
const REFRESH_MS = 30 * 1000

// A team-color circle with the team code, the same no-logo look as the
// prop card avatar (owner 2026-10-12).
function TeamDot({ abbr }) {
  const c = teamColors(abbr)
  return (
    <span
      className={`w-8 h-8 rounded-full flex items-center justify-center ${String(abbr || '').length > 2 ? 'text-[9px]' : 'text-[10px]'} font-bold flex-shrink-0 ${c ? 'border-2' : 'bg-ink-750 border border-ink-600 text-ink-200'}`}
      style={c ? { backgroundColor: c.bg, borderColor: c.accent, color: c.fg } : undefined}
      aria-hidden="true"
    >
      {abbr ? String(abbr).slice(0, 3) : ''}
    </span>
  )
}

const fmtClock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function GameState({ g }) {
  if (g.state === 'live') {
    return (
      <span className="px-2 py-0.5 rounded-full bg-ink-800 text-ink-200 text-xs font-semibold flex items-center gap-1 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-signal-pos animate-pulse" />
        In progress
      </span>
    )
  }
  if (g.state === 'final') return <span className="text-xs text-ink-400 flex-shrink-0">Final</span>
  return null
}

// One game, collapsible (owner 2026-10-16). The header carries the
// matchup, kickoff or state, and how many reads are inside.
function GameSection({ g, defaultOpen, showOutcome }) {
  const [open, setOpen] = useState(defaultOpen)
  const [skipsOpen, setSkipsOpen] = useState(false)
  const reads = sortProps(g.props.filter(p => !p.skip))
  const skips = sortProps(g.props.filter(p => p.skip))
  const n = reads.length
  const graded = showOutcome ? reads.filter(p => p.outcome === 'won' || p.outcome === 'lost') : []
  const hits = graded.filter(p => p.outcome === 'won').length
  return (
    <section id={`props-game-${g.key}`} className="flex flex-col gap-2 scroll-mt-20" aria-label={`${g.away} at ${g.home}`}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={`w-full bg-ink-900 rounded-2xl border px-4 py-3 flex items-center gap-3 text-left transition-colors ${g.state === 'live' ? 'border-signal-pos/50' : 'border-ink-700'}`}
      >
        <span className="flex -space-x-2">
          <TeamDot abbr={g.awayAbbr} />
          <TeamDot abbr={g.homeAbbr} />
        </span>
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-sm font-semibold text-ink-100 truncate">{g.away} at {g.home}</span>
          <span className="text-xs text-ink-400">
            {g.state === 'upcoming' ? fmtGameDateTime(g.commence_time) : `Started ${fmtClock(g.commence_time)}`}
            {' · '}{n} {n === 1 ? 'prop' : 'props'}
            {skips.length > 0 && <>{' · '}{skips.length} {skips.length === 1 ? 'skip' : 'skips'}</>}
            {graded.length > 0 && <>{' · '}<span className="tabular-nums text-ink-200">{hits} of {graded.length} hit</span>{graded.some(p => p.unofficial) ? ', unofficial' : ''}</>}
          </span>
        </span>
        <GameState g={g} />
        <svg className={`w-4 h-4 text-ink-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && reads.map((p, i) => <PropCard key={`${p.text}|${i}`} p={p} showOutcome={showOutcome} />)}
      {open && skips.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setSkipsOpen(v => !v)}
            aria-expanded={skipsOpen}
            className="self-start px-3 py-1.5 rounded-full bg-ink-900 border border-ink-700 text-xs font-semibold text-ink-300 hover:text-ink-100"
          >
            {skipsOpen ? 'Hide skips' : `Show ${skips.length} more ${skips.length === 1 ? 'prop' : 'props'} we'd skip`}
          </button>
          {skipsOpen && skips.map((p, i) => <SkipCard key={`skip|${p.text}|${i}`} p={p} />)}
        </div>
      )}
    </section>
  )
}

export default function Props() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('upcoming')
  // Market filter chips (owner mockup 2026-10-12). 'all' or a market key.
  const [market, setMarket] = useState('all')

  // One loader for the first paint and every refresh. A refresh keeps the
  // page up on a failed fetch: the last good board stays.
  const load = useCallback((initial = false) => {
    let cancelled = false
    apiFetch(`/api/props`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled && initial) setError(e.message) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => load(true), [load])

  // The home screen app comes back days later with the board it left
  // on. Reload when the page is visible again (owner 2026-10-18: the
  // Browns props were graded but Recent results still showed none).
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const allUpcoming = data?.upcoming || []
  const allRecent = data?.recent || []
  const allLive = data?.live || []
  const allSkips = data?.skips || []
  // Chips for the markets on the board right now, in board order.
  const markets = []
  for (const p of [...allUpcoming, ...allLive, ...allSkips, ...allRecent]) {
    if (!markets.some(m => m.key === p.market)) markets.push({ key: p.market, label: p.marketLabel })
  }
  const pick = (list) => (market === 'all' ? list : list.filter(p => p.market === market))
  const upcoming = pick(allUpcoming)
  const recent = pick(allRecent)
  const live = pick(allLive)
  const skips = pick(allSkips)
  const rec = data?.record
  const total = rec?.total

  // Started and upcoming reads in one list, a section per game: in
  // progress on top, then upcoming by kickoff, then finished (owner
  // 2026-10-16). Live games and the next game start open.
  const games = groupByGame([...live, ...upcoming, ...skips])
  const firstUpcoming = games.find(g => g.state === 'upcoming')
  const openByDefault = (g) => g.state === 'live' || g === firstUpcoming
  const recentGames = groupByGame(recent)

  // The Live now strip (owner 2026-10-18): score and clock for the games
  // on this slate that are on, no reads in it. Polls only while one is.
  // Every game on the slate, whatever market chip is on.
  const slate = useMemo(() => groupByGame([...allLive, ...allUpcoming, ...allSkips]), [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const anyLive = slate.some(g => g.state === 'live')
  const liveFeed = useLiveGames(anyLive)

  // While a game on the slate is on, the official grades land up to 15
  // minutes after the final whistle, so refetch the board every 30 seconds
  // until every read in it is graded. A game stops counting as live once
  // it is, so the polling ends on its own.
  useEffect(() => {
    if (!anyLive) return undefined
    const id = setInterval(() => { if (!document.hidden) load() }, REFRESH_MS)
    return () => clearInterval(id)
  }, [anyLive, load])
  const { liveNow, sectionFor } = useMemo(() => {
    const keys = []
    const map = {}
    for (const g of slate) {
      if (g.state !== 'live') continue
      const p = g.props[0]
      const hit = findByMatchup(liveFeed?.games, { home_team: p.home_team, away_team: p.away_team, at: g.commence_time })
      if (!hit) continue
      keys.push(hit[0])
      map[hit[0]] = g.key
    }
    return { liveNow: liveNowItems(liveFeed?.games, keys), sectionFor: map }
  }, [slate, liveFeed])
  const jumpTo = (feedKey) => {
    const el = document.getElementById(`props-game-${sectionFor[feedKey]}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <header className="sticky top-0 z-20 bg-ink-950/95 backdrop-blur border-b border-ink-800" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-xl lg:max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <button onClick={() => navigate('/today')} className="focus:outline-none"><BrandMark /></button>
          <div className="flex items-center gap-1">
            <TopNav className="mr-2" />
            <InstallButton />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-6 pb-16 flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-3xl font-bold tracking-tight">Props</h1>
          </div>
          <p className="text-sm text-ink-400">
            NFL player prop reads, tracked in the open before they go live. Not picks yet and not in the official record. They publish once this shadow record and the closing line both clear the bar.
          </p>
        </section>

        {markets.length > 1 && (
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" role="group" aria-label="Filter by market">
            {[{ key: 'all', label: 'All' }, ...markets].map(m => (
              <button
                key={m.key}
                onClick={() => setMarket(m.key)}
                aria-pressed={market === m.key}
                className={`px-4 py-2 rounded-full text-sm whitespace-nowrap border transition-colors first-letter:uppercase ${market === m.key ? 'bg-ink-100 text-ink-950 border-ink-100' : 'bg-ink-900 text-ink-300 border-ink-700'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-4 border-b border-ink-800" role="tablist">
          {[['upcoming', `Games (${games.length})`], ['recent', 'Recent results']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-sm border-b-2 transition-colors ${tab === k ? 'border-signal-pos text-ink-100 font-semibold' : 'border-transparent text-ink-400'}`}>
              {label}
            </button>
          ))}
        </div>

        {data && tab === 'upcoming' && liveNow.length > 0 && <LiveNowRail items={liveNow} onJump={jumpTo} />}

        {error && <p className="text-sm text-ink-400">Props did not load. Try again in a minute.</p>}
        {!data && !error && <SkeletonList count={4} label="Loading props" />}

        {data && tab === 'upcoming' && (
          games.length === 0
            ? <p className="text-sm text-ink-400">No prop reads for the next games yet. Reads refresh twice a day.</p>
            : games.map(g => <GameSection key={g.key} g={g} defaultOpen={openByDefault(g)} />)
        )}

        {data && tab === 'recent' && (
          recentGames.length === 0
            ? <p className="text-sm text-ink-400">No finished props from the last week yet.</p>
            : <>
                {recent.some(p => p.unofficial) && (
                  <p className="text-xs text-ink-400">Unofficial results come from the box score and turn official when the game settles, usually within minutes of the final.</p>
                )}
                {recentGames.map((g, i) => <GameSection key={g.key} g={g} defaultOpen={i === 0} showOutcome />)}
              </>
        )}

        {total && (total.won + total.lost) > 0 && (
          <details className="bg-ink-900 rounded-2xl border border-ink-700 px-4 py-3 flex flex-col gap-3" aria-label="Shadow record">
            <summary className="flex items-center justify-between cursor-pointer text-sm text-ink-300">
              <span>Shadow record by market, us 4% or more above the book</span>
              <span className=" tabular-nums text-ink-100">
                {total.won}-{total.lost} <span className={total.units >= 0 ? 'text-signal-pos' : 'text-signal-neg'}>{fmtUnits(total.units)}</span>
              </span>
            </summary>
            <table className="w-full text-sm mt-3">
              <tbody>
                {rec.byMarket.map(m => (
                  <tr key={m.market} className="border-t border-ink-800">
                    <td className="py-1.5 text-ink-300 capitalize">{m.label}</td>
                    <td className="py-1.5 text-right tabular-nums text-ink-200">{m.won}-{m.lost}</td>
                    <td className={`py-1.5 text-right tabular-nums w-20 ${m.units >= 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{fmtUnits(m.units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-ink-500 mt-2">Graded since Sep 14 at the consensus price, 1 unit each. Rushing and receiving yards changed method on Oct 12 and anytime TD started Oct 12.</p>
          </details>
        )}

        <p className="text-[11px] text-ink-600 text-center">For information and entertainment. 21+. If gambling stops being fun, call 1-800-GAMBLER.</p>
      </main>
    </div>
  )
}
