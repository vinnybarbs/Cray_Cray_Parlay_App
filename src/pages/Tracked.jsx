import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BrandMark, { SignOutButton } from '../components/BrandMark'
import { TopNav } from '../components/TabBar'
import InstallButton from '../components/InstallButton'
import PropCard, { fmtOdds } from '../components/PropCard'
import TrackButton from '../components/TrackButton'
import { LiveScoreboard, LiveNowRail, StandingLine, TeamDot } from '../components/LiveScoreboard'
import useLiveGames from '../hooks/useLiveGames'
import useLiveProps, { liveReadKey, liveGameKey } from '../hooks/useLiveProps'
import { useTracked } from '../lib/trackedStore'
import { splitUnits, groupTracked, itemTime, itemSection, parlayStatus } from '../lib/trackedKeys'
import { fmtGameDateTime } from '../lib/gameTime'
import { findByMatchup, liveNowItems } from '../lib/liveNow'
import { apiFetch } from '../lib/api'

// The Tracked tab (owner 2026-10-16): every play and prop the user
// tapped Track bet on, in one place, with the same live trackers the
// Board and the Props page run. In progress on top, then what is ahead,
// then the last week of results. Grades are the ledger's, by key, never
// computed here.

const OUTCOMES_MS = 5 * 60 * 1000
const GRADED = new Set(['won', 'lost', 'push'])

const OUTCOME_TEXT = {
  won: { label: 'Won', cls: 'bg-signal-pos/15 text-signal-pos' },
  lost: { label: 'Lost', cls: 'bg-signal-neg/15 text-signal-neg' },
  push: { label: 'Push', cls: 'bg-ink-800 text-ink-300' },
}

function useOutcomes(items) {
  const [out, setOut] = useState({ games: {}, props: {} })
  // Only started bets have a grade to ask for.
  const started = useMemo(() => items.filter(it => (itemTime(it) || Infinity) <= Date.now()), [items])
  const sig = started.map(it => it.key).join('\n')
  useEffect(() => {
    if (!sig) return undefined
    let cancelled = false
    const ask = async () => {
      try {
        const body = {
          games: started.filter(it => it.kind === 'game').map(it => ({ key: it.key, home_team: it.home_team, away_team: it.away_team, pick: it.pick, game_date: it.game_date })),
          props: started.filter(it => it.kind === 'prop').map(it => ({ key: it.key, playerKey: it.playerKey, market: it.market, side: it.side, line: it.line, commence_time: it.commence_time })),
        }
        const r = await apiFetch('/api/tracked/outcomes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        if (!r.ok) return
        const data = await r.json()
        if (!cancelled) setOut({ games: data.games || {}, props: data.props || {} })
      } catch { /* keep what we have */ }
    }
    ask()
    const t = setInterval(ask, OUTCOMES_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  return out
}

// The feed keys a spotlight pick by its text and the headline by `pick`.
const standingFor = (item, live) => (live ? (live.alts?.[item.pick] || live.pick || null) : null)

// The official grade, or the live feed's call once the game is final.
function gradedOf(item, live, grade) {
  if (item.kind === 'prop') return GRADED.has(grade?.outcome) ? grade.outcome : null
  const standing = standingFor(item, live)
  return GRADED.has(grade?.outcome) ? grade.outcome
    : (live?.final && GRADED.has(standing?.status) ? standing.status : null)
}

function TrackedGameCard({ item, live, grade, section, inParlay = false }) {
  const standing = standingFor(item, live)
  const graded = gradedOf(item, live, grade)
  const o = graded ? OUTCOME_TEXT[graded] : null
  const odds = item.odds != null && Number.isFinite(parseInt(item.odds, 10)) ? parseInt(item.odds, 10) : null
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex -space-x-1.5">
          <TeamDot name={item.away_team} abbr={live?.away?.abbr} sport={item.sport} />
          <TeamDot name={item.home_team} abbr={live?.home?.abbr} sport={item.sport} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink-100 leading-tight truncate tabular-nums">
            {item.away_team} <span className="text-ink-500">at</span> {item.home_team}
          </div>
          <div className="text-xs text-ink-400 truncate">
            {item.sport}{item.tier ? ` · ${item.tier}` : ''} · {fmtGameDateTime(item.game_date)}
          </div>
        </div>
        {o && <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0 ${o.cls}`}>{o.label}</span>}
      </div>

      {section === 'live' && live && <LiveScoreboard live={live} sport={item.sport} />}

      <div className="bg-ink-850 rounded-sharp shadow-hairline px-3 py-2">
        <div className="text-xs text-ink-400 mb-0.5">{item.bet_type ? `${item.bet_type} pick` : 'Model Pick'}</div>
        <div className="flex items-baseline justify-between gap-3">
          <span className={`font-medium text-sm tabular-nums ${graded === 'lost' ? 'text-ink-300' : 'text-signal-pos'}`}>{item.pick}</span>
          {odds != null && <span className="text-sm tabular-nums text-ink-200 flex-shrink-0">{fmtOdds(odds)}</span>}
        </div>
        {item.book_pct != null && item.our_pct != null && (
          <div className="text-xs text-ink-400 mt-0.5 tabular-nums">Book says {item.book_pct}%, we say {item.our_pct}%</div>
        )}
        {!graded && section === 'live' && <StandingLine standing={standing} />}
        {section === 'finished' && !o && (
          <div className="text-xs text-ink-500 mt-1">Grading. The ledger posts the result after the final.</div>
        )}
      </div>

      {!inParlay && (
        <div className="flex justify-end">
          <TrackButton item={item} />
        </div>
      )}
    </div>
  )
}

function TrackedPropCard({ item, grade, section }) {
  const p = {
    ...item,
    started: section !== 'upcoming',
    outcome: grade?.outcome && GRADED.has(grade.outcome) ? grade.outcome : null,
    actual: grade?.actual ?? null,
  }
  return <PropCard p={p} showOutcome={section !== 'upcoming'} />
}

const PARLAY_STATE = {
  won: { label: 'Parlay won', cls: 'bg-signal-pos/15 text-signal-pos' },
  lost: { label: 'Parlay lost', cls: 'bg-signal-neg/15 text-signal-neg' },
  push: { label: 'Push', cls: 'bg-ink-800 text-ink-300' },
}

const LEG_DOT = {
  won: 'bg-signal-pos border-signal-pos',
  lost: 'bg-signal-neg border-signal-neg',
  push: 'bg-ink-500 border-ink-500',
}

// A parlay tracked together (owner 2026-10-18): the legs stay full cards
// with their own live trackers, joined by a line down the left with a dot
// per leg that fills in as each one settles.
function TrackedParlay({ unit, liveFor, gradeFor, stateFor }) {
  const { untrackMany } = useTracked()
  const meta = unit.meta || {}
  const outcomes = unit.legs.map(l => gradedOf(l, liveFor(l), gradeFor(l)))
  const status = parlayStatus(outcomes)
  const done = PARLAY_STATE[status.state]
  const settled = outcomes.filter(Boolean).length
  const pct = (v) => (v == null ? null : v < 10 ? `${v}%` : `${Math.round(v)}%`)
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="w-8 h-8 rounded-full bg-signal-pos/15 text-signal-pos flex items-center justify-center flex-shrink-0" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
            <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink-100 leading-tight tabular-nums">
            {unit.legs.length} leg parlay{meta.odds != null && <span className="ml-2 text-signal-pos">{fmtOdds(meta.odds)}</span>}
          </div>
          <div className="text-xs text-ink-400 tabular-nums truncate">
            {meta.book_pct != null && meta.our_pct != null ? `Book says ${pct(meta.book_pct)}, we say ${pct(meta.our_pct)}` : 'Tracked together'}
            {!done && settled > 0 && ` · ${status.won} of ${unit.legs.length} hit`}
          </div>
        </div>
        {done && <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0 ${done.cls}`}>{done.label}</span>}
      </div>

      <div className="relative flex flex-col gap-3 pl-6">
        <div className="absolute left-[9px] top-6 bottom-6 w-0.5 rounded-full bg-signal-pos/30" aria-hidden="true" />
        {unit.legs.map((l, i) => {
          const section = itemSection(l, stateFor(l))
          return (
            <div key={l.key} className="relative">
              <span className={`absolute -left-6 top-5 w-5 h-5 rounded-full border-2 bg-ink-950 flex items-center justify-center text-[10px] font-bold tabular-nums ${outcomes[i] ? `${LEG_DOT[outcomes[i]]} text-ink-950` : 'border-signal-pos/60 text-signal-pos'}`} aria-hidden="true">
                {i + 1}
              </span>
              {l.kind === 'game'
                ? <TrackedGameCard item={l} live={liveFor(l)} grade={gradeFor(l)} section={section} inParlay />
                : <TrackedPropCard item={l} grade={gradeFor(l)} section={section} />}
            </div>
          )
        })}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => untrackMany(unit.legs.map(l => l.key))}
          className="px-2 py-1 rounded-full text-[11px] font-semibold bg-ink-800 text-ink-300 hover:text-ink-100 active:bg-ink-700"
        >
          Untrack parlay
        </button>
      </div>
    </div>
  )
}

function Section({ title, count, children }) {
  if (count === 0) return null
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
        <span className="text-[11px] text-ink-500 tabular-nums">{count}</span>
      </div>
      {children}
    </section>
  )
}

export default function Tracked() {
  const navigate = useNavigate()
  const { items } = useTracked()
  const outcomes = useOutcomes(items)

  // Game cards and the Live now strip both read the game feed, so it runs
  // while any tracked bet has kicked off.
  const anyStarted = items.some(it => (itemTime(it) || Infinity) <= Date.now())
  const gameFeed = useLiveGames(anyStarted)
  const propFeed = useLiveProps(items.some(it => it.kind === 'prop'))

  const gradeFor = (it) => (it.kind === 'game' ? outcomes.games[it.key] : outcomes.props[it.key]) || null
  const liveFor = (it) => (it.kind === 'game'
    ? gameFeed?.games?.[it.game_key] || null
    : propFeed?.games?.[liveGameKey(it)] || null)
  const stateFor = (it) => {
    const live = liveFor(it)
    const read = it.kind === 'prop' ? propFeed?.reads?.[liveReadKey(it)] : null
    return { outcome: gradeFor(it)?.outcome, final: !!(live?.final || read?.final) }
  }

  // The Live now strip (owner 2026-10-18): score and clock for every game
  // a tracked bet is on, one chip per game, no reads in it.
  const liveNow = liveNowItems(gameFeed?.games, items.map(it => (it.kind === 'game'
    ? it.game_key
    : findByMatchup(gameFeed?.games, { home_team: it.home_team, away_team: it.away_team, at: it.commence_time })?.[0])))

  const sections = splitUnits(items, stateFor)
  const render = (section) => (u) => {
    if (u.type === 'parlay') return <TrackedParlay key={u.key} unit={u} liveFor={liveFor} gradeFor={gradeFor} stateFor={stateFor} />
    const it = u.item
    return it.kind === 'game'
      ? <TrackedGameCard key={it.key} item={it} live={liveFor(it)} grade={gradeFor(it)} section={section} />
      : <TrackedPropCard key={it.key} item={it} grade={gradeFor(it)} section={section} />
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
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-lg font-semibold text-ink-100">Tracked</h1>
          <span className="text-[11px] text-ink-500 tabular-nums">{(n => `${n} bet${n !== 1 ? 's' : ''}`)(groupTracked(items).length)}</span>
        </div>

        {items.length === 0 && (
          <div className="bg-ink-900 rounded-sharp shadow-hairline p-6 flex flex-col items-center text-center gap-3">
            <p className="text-sm text-ink-300">Nothing tracked yet. Tap <span className="font-semibold text-ink-100">Track bet</span> on any play or prop and it lands here, live score and all.</p>
            <div className="flex gap-2">
              <button onClick={() => navigate('/digest')} className="px-4 py-2 bg-signal-pos rounded-sharp font-mono font-bold uppercase tracking-[0.12em] text-xs text-ink-950 transition-all active:scale-[0.98]">Board</button>
              <button onClick={() => navigate('/props')} className="px-4 py-2 bg-ink-800 rounded-sharp font-mono font-bold uppercase tracking-[0.12em] text-xs text-ink-100 transition-all active:scale-[0.98]">Props</button>
            </div>
          </div>
        )}

        <LiveNowRail items={liveNow} />

        <Section title="In progress" count={sections.live.length}>{sections.live.map(render('live'))}</Section>
        <Section title="Upcoming" count={sections.upcoming.length}>{sections.upcoming.map(render('upcoming'))}</Section>
        <Section title="Finished" count={sections.finished.length}>{sections.finished.map(render('finished'))}</Section>

        {items.length > 0 && (
          <p className="text-[11px] text-ink-500">Results stay a week. Tracking is a watch list, not a wager, and the ledger's grade is the one that counts.</p>
        )}
      </main>
    </div>
  )
}
