import React, { useState } from 'react'
import { fmtGameDateTime } from '../lib/gameTime'
import { teamColors } from '../lib/teamColors'
import PlayerSheet from './PlayerSheet'
import LineShop from './LineShop'
import { LockIcon, UnlockButton } from './Locked'
import useLiveProps, { liveReadKey, liveGameKey } from '../hooks/useLiveProps'
import TrackButton from './TrackButton'
import { propItem } from '../lib/trackedKeys'
import { skipReason } from '../lib/propSkip'

// One shadow prop read (owner 2026-10-12: show props as shadow so the
// site can be envisioned before they publish). Always carries the SHADOW
// badge, never a tier name, so it never reads as a pick.
//
// UI plan item 6 (owner approved 2026-10-12): the card shows its evidence,
// not just a claim. Our probability against the book's as a bar, and the
// player's last games against the line, the pattern prop bettors know
// from the commercial apps. Both come from /api/props and drop out
// cleanly when missing.

export function fmtOdds(odds) {
  if (odds == null) return ''
  const n = parseInt(odds, 10)
  if (Number.isNaN(n)) return String(odds)
  return n > 0 ? `+${n}` : String(n)
}

export function fmtUnits(u) {
  if (u == null) return '-'
  return `${u > 0 ? '+' : ''}${Number(u).toFixed(1)}u`
}

export function ShadowBadge() {
  return (
    <span className="text-[11px] font-medium text-ink-400 border border-ink-700 rounded-full px-2.5 py-0.5 flex-shrink-0">
      Shadow
    </span>
  )
}

const OUTCOME = {
  won: { label: 'Hit', cls: 'text-signal-pos' },
  lost: { label: 'Missed', cls: 'text-signal-neg' },
  push: { label: 'Push', cls: 'text-ink-400' },
}

const isTd = (p) => p.market === 'player_anytime_td'

// "Over 1.5 receptions", "To score a TD"
export function pickLine(p) {
  if (isTd(p)) return 'To score a TD'
  if (p.side == null || p.line == null) return p.text
  return `${p.side === 'over' ? 'Over' : 'Under'} ${p.line} ${p.marketLabel}`
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// Team colors instead of a headshot or logo (owner 2026-10-12): photos
// and logos need a license, plain colors and our own initials do not.
// Falls back to neutral ink when the team is unknown.
function Avatar({ name, team }) {
  const c = teamColors(team)
  return (
    <div className="relative w-11 h-11 flex-shrink-0" aria-hidden="true">
      <div
        className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold ${c ? 'border-2' : 'bg-ink-750 border border-ink-600 text-ink-200'}`}
        style={c ? { backgroundColor: c.bg, borderColor: c.accent, color: c.fg } : undefined}
      >
        {initials(name)}
      </div>
      {team && (
        <span
          className="absolute -right-1.5 -bottom-1 tabular-nums text-[8px] font-bold leading-none px-1 py-0.5 rounded border bg-ink-950"
          style={c ? { borderColor: c.accent, color: '#FFFFFF' } : undefined}
        >
          {team}
        </span>
      )}
    </div>
  )
}

// Ours against the book's, both for the read's side. The white tick is
// the book's number, the amber fill is ours.
function ProbBar({ ours, book }) {
  if (ours == null || book == null) return null
  const clamp = (x) => Math.max(0, Math.min(100, x))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-2 rounded-full bg-ink-700 overflow-hidden" role="img" aria-label={`We say ${ours.toFixed(1)} percent, the book says ${book.toFixed(1)} percent`}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-signal-pos" style={{ width: `${clamp(ours)}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-ink-400" style={{ width: `${clamp(Math.min(book, ours))}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-ink-100" style={{ left: `calc(${clamp(book)}% - 1px)` }} />
      </div>
      <div className="flex justify-between text-xs text-ink-400">
        <span>Book says <span className=" tabular-nums text-ink-300">{Math.round(book)}%</span></span>
        <span>We say <span className=" tabular-nums font-semibold text-signal-pos">{Math.round(ours)}%</span></span>
      </div>
    </div>
  )
}

// Last games against the line. Amber bars cleared it on the read's side,
// dark bars did not. The dashed rule is the line.
function HistoryChart({ p }) {
  const h = p.history
  if (!h || !h.games || h.games.length === 0) return null
  const td = isTd(p)
  const top = td ? 1 : Math.max(p.line * 1.6, ...h.games.map(g => g.value), 1)
  const pct = (v) => `${Math.max(4, Math.min(100, (v / top) * 100))}%`
  const n = h.games.length
  const label = td
    ? `Scored in ${h.hits} of last ${n}`
    : `${h.hits} of last ${n} went ${p.side} ${p.line}`
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-12 flex items-end gap-1" role="img" aria-label={`${label}. ${h.games.map(g => g.value).join(', ')}`}>
        {h.games.map((g, i) => (
          <div
            key={`${g.season}-${g.week}-${i}`}
            className={`flex-1 rounded-t ${g.hit ? 'bg-signal-pos' : 'bg-ink-600'}`}
            style={{ height: td ? (g.value > 0 ? '100%' : '10%') : pct(g.value) }}
            title={`${g.season} week ${g.week}${g.opponent ? ` vs ${g.opponent}` : ''}: ${g.value}`}
          />
        ))}
        {!td && <div className="absolute inset-x-0 border-t border-dashed border-ink-300/70 pointer-events-none" style={{ bottom: pct(p.line) }} />}
      </div>
      <div className="flex justify-between text-xs text-ink-400">
        <span>{td ? `Scored a TD, last ${n} games` : `Last ${n} games vs ${p.line}`}</span>
        <span className=" tabular-nums text-ink-200">{h.hits} of {n}</span>
      </div>
    </div>
  )
}

// Both prices with our side lit (owner mockup 2026-10-12). These are
// labels, not buttons: TrapHawk takes no bets and links to no book
// (directive 27). An anytime TD shows only the yes, books sell no no.
function SideChips({ p }) {
  if (!p.side) return null
  const td = isTd(p)
  const sides = [
    { key: 'over', label: td ? 'Yes' : 'Over', price: p.overPrice },
    { key: 'under', label: td ? 'No' : 'Under', price: p.underPrice },
  ].filter(s => s.key === p.side || s.price != null)
  return (
    <div className="flex gap-2">
      {sides.map(s => {
        const ours = s.key === p.side
        return (
          <div
            key={s.key}
            className={`flex-1 text-center py-2.5 rounded-xl text-sm font-semibold ${ours ? 'bg-signal-pos text-ink-950' : 'bg-ink-800 text-ink-300'}`}
            aria-label={ours ? `Our side, ${s.label} ${fmtOdds(s.price)}` : `${s.label} ${fmtOdds(s.price)}`}
          >
            {s.label} {fmtOdds(s.price)}
          </div>
        )
      })}
    </div>
  )
}

// The expanding explanation (owner 2026-10-12): tap the evidence area
// and it opens in place to a few sentences in the same voice as the game
// research, with the numbers behind the read. Nothing opens when there
// is nothing to say.
function whyFacts(p) {
  const w = p.why || {}
  const out = []
  if (w.projection != null && p.line != null) out.push(['Projection', `${w.projection} vs a line of ${p.line}`])
  if (w.recentAvg != null && w.longAvg != null) out.push(['Recent form', `${w.recentAvg} a game lately, ${w.longAvg} over a longer stretch`])
  if (w.opponent && w.oppPct != null && Math.abs(w.oppPct) >= 3) out.push(['Matchup', `${w.opponent} allows ${Math.abs(w.oppPct)}% ${w.oppPct > 0 ? 'more' : 'fewer'} ${p.marketLabel} than average`])
  if (w.teamImplied != null) out.push(['Game script', `Team expected to score about ${w.teamImplied}`])
  if (w.windMph != null) out.push(['Weather', `Wind around ${w.windMph} mph`])
  if (w.status) out.push(['Status', w.status])
  return out
}

function Why({ p, onPlayer }) {
  const [more, setMore] = useState(false)
  const narration = p.why?.narration
  const detail = p.why?.detail
  const facts = whyFacts(p)
  if (!narration && facts.length === 0 && !onPlayer) return null
  return (
    <div className="flex flex-col gap-3 pt-1">
      {narration && <p className="text-sm text-ink-200 leading-relaxed">{narration}</p>}
      {/* The longer write-up (owner 2026-10-13: "a more button under
          the why we like it for the narration"). */}
      {detail && (more
        ? <div className="flex flex-col gap-2">
            {detail.split(/\n\s*\n/).map((para, i) => <p key={i} className="text-sm text-ink-300 leading-relaxed">{para}</p>)}
          </div>
        : <button type="button" onClick={() => setMore(true)} className="self-start text-xs font-semibold text-signal-pos hover:underline">Read more</button>)}
      {facts.length > 0 && (
        <dl className="flex flex-col gap-1.5">
          {facts.map(([k, v]) => (
            <div key={k} className="flex gap-3 text-xs">
              <dt className="w-24 flex-shrink-0 text-ink-500">{k}</dt>
              <dd className="text-ink-300 min-w-0">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {onPlayer && p.playerKey && (
        <button
          type="button"
          onClick={onPlayer}
          className="self-start px-3 py-1.5 rounded-full bg-ink-850 border border-ink-700 text-xs font-semibold text-ink-200 hover:text-ink-100"
        >
          {p.player} game log and our history
        </button>
      )}
    </div>
  )
}

// A started read keeps its card (owner 2026-10-13: "game in progress"
// and "locked at", so a bettor can come back and see why). The chip says
// where it stands: the official grade once it lands, else the live
// tracker's call (owner 2026-10-16: "show progress, and hit or miss").
const LIVE_STATUS = {
  hit: { label: 'Hit', cls: 'bg-signal-pos/15 text-signal-pos' },
  miss: { label: 'Missed', cls: 'bg-signal-neg/15 text-signal-neg' },
  push: { label: 'Push', cls: 'bg-ink-800 text-ink-300' },
  no_stats: { label: 'No stats', cls: 'bg-ink-800 text-ink-300' },
}

function StartedChip({ p, live }) {
  const o = OUTCOME[p.outcome]
  if (o) return <span className={`text-xs font-semibold flex-shrink-0 ${o.cls}`}>Final, {o.label.toLowerCase()}{p.actual != null ? ` · ${p.actual}` : ''}</span>
  const ls = live && LIVE_STATUS[live.status]
  if (ls) {
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${ls.cls}`}>
        {live.final && live.status !== 'hit' && live.status !== 'miss' ? `Final, ${ls.label.toLowerCase()}` : ls.label}
      </span>
    )
  }
  const elapsedH = (Date.now() - new Date(p.commence_time).getTime()) / 3600e3
  const inProgress = live ? !live.final : elapsedH <= 4
  return (
    <span className="px-2 py-0.5 rounded-full bg-ink-800 text-ink-200 text-xs font-semibold flex-shrink-0 flex items-center gap-1">
      {inProgress && <span className="w-1.5 h-1.5 rounded-full bg-signal-pos animate-pulse" />}
      {inProgress ? (live ? 'Live' : 'Game in progress') : 'Locked'}
    </span>
  )
}

// What the tracker says under the bar. n is how many more it takes to
// clear the line: an over needs n more, an under is safe until n more.
// Pure.
function trackerText(p, live) {
  const cur = Number(live.current) || 0
  if (isTd(p)) return cur >= 1 ? `Scored${cur > 1 ? ` ${cur} TDs` : ''}` : (live.final ? 'No TD' : 'No TD yet')
  const n = Math.max(0, Math.floor(Number(p.line)) + 1 - cur)
  const unit = (k) => (k === 1 && p.marketLabel === 'receptions' ? 'reception' : k === 1 && /TDs$/.test(p.marketLabel) ? p.marketLabel.slice(0, -1) : p.marketLabel)
  if (live.status === 'hit') return p.side === 'over' ? `Cleared ${p.line}` : `Stayed under ${p.line}`
  if (live.status === 'miss') return p.side === 'over' ? `Finished short of ${p.line}` : `Went over ${p.line}`
  if (live.status === 'push') return `Landed on ${p.line}`
  if (live.status === 'no_stats') return 'No stats recorded, likely void'
  return p.side === 'over' ? `Needs ${n} more ${unit(n)}` : `Safe unless ${n} more ${unit(n)}`
}

// The live tracker (owner 2026-10-16): the stat so far against the line,
// "4 of 6.5 receptions", with the game score and clock.
function LiveTracker({ p, live, game }) {
  if (!live) return null
  const td = isTd(p)
  const cur = Number(live.current) || 0
  const line = Number(p.line)
  const top = td ? 1 : Math.max(line * 1.25, cur, 1)
  const pct = (v) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`
  const fill = live.status === 'hit' ? 'bg-signal-pos'
    : live.status === 'miss' ? 'bg-signal-neg'
      : p.side === 'over' ? 'bg-signal-pos/70' : 'bg-ink-300'
  const score = game && game.homeScore != null && game.awayScore != null
    ? `${game.awayAbbr || p.awayAbbr} ${game.awayScore}, ${game.homeAbbr || p.homeAbbr} ${game.homeScore}`
    : null
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-ink-850 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm text-ink-200">
          {td
            ? <span className="font-semibold text-ink-100 tabular-nums">{cur} TD{cur === 1 ? '' : 's'}</span>
            : <><span className="font-semibold text-ink-100 tabular-nums">{cur}</span> of <span className="tabular-nums">{p.line}</span> {p.marketLabel}</>}
        </span>
        {(score || game?.detail) && (
          <span className="text-xs text-ink-400 tabular-nums whitespace-nowrap">{[score, game?.detail].filter(Boolean).join(' · ')}</span>
        )}
      </div>
      <div className="relative h-2 rounded-full bg-ink-700 overflow-hidden" role="img" aria-label={`${trackerText(p, live)}, ${cur} so far`}>
        <div className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ${fill}`} style={{ width: td ? (cur >= 1 ? '100%' : '0%') : pct(cur) }} />
        {!td && <div className="absolute inset-y-0 w-0.5 bg-ink-100" style={{ left: `calc(${pct(line)} - 1px)` }} />}
      </div>
      <span className={`text-xs ${live.status === 'hit' ? 'text-signal-pos' : live.status === 'miss' ? 'text-signal-neg' : 'text-ink-400'}`}>{trackerText(p, live)}</span>
    </div>
  )
}

const fmtClock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

// A prop read for a visitor without Pro: the player and the market,
// no side, line or why (the server removed them).
function LockedProp({ p }) {
  return (
    <div className="bg-ink-900 rounded-2xl border border-ink-700 px-4 py-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar name={p.player} team={p.team} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink-100 leading-tight truncate">{p.player}</div>
          <div className="text-xs text-ink-400 truncate">
            {p.awayAbbr && p.homeAbbr ? `${p.awayAbbr} at ${p.homeAbbr}` : `${p.away_team} at ${p.home_team}`} · {fmtGameDateTime(p.commence_time)}
          </div>
        </div>
        <span className="text-xs text-ink-500 flex items-center gap-1 flex-shrink-0"><LockIcon className="w-3.5 h-3.5" /> Pro</span>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-ink-300">A {p.marketLabel} read, for Pro members.</span>
        <UnlockButton />
      </div>
    </div>
  )
}

// The headline of a skip: the market at the book's line, no side lit.
function skipLine(p) {
  if (isTd(p)) return 'To score a TD'
  return `${p.line} ${p.marketLabel}`
}

// Every other read for the game (owner 2026-10-16: "show all props even
// skips reasoning", so a bettor can research here and not jump apps).
// Compact by default, tap for the numbers, the chart and the player.
export function SkipCard({ p }) {
  const [open, setOpen] = useState(false)
  const [playerOpen, setPlayerOpen] = useState(false)
  const td = isTd(p)
  const chartP = td ? { ...p, side: 'over' } : p
  return (
    <div className="bg-ink-900/60 rounded-xl border border-ink-800 px-3 py-2.5 flex flex-col gap-2">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full flex items-center gap-3 text-left">
        <span className="min-w-0 flex-1 flex flex-col">
          <span className="text-sm font-semibold text-ink-200 truncate">{p.player}</span>
          <span className="text-xs text-ink-400 truncate first-letter:uppercase">
            {skipLine(p)}
            {!td && (p.overPrice != null || p.underPrice != null) && (
              <span className="tabular-nums"> · O {fmtOdds(p.overPrice) || '-'} / U {fmtOdds(p.underPrice) || '-'}</span>
            )}
            {td && p.overPrice != null && <span className="tabular-nums"> · {fmtOdds(p.overPrice)}</span>}
          </span>
        </span>
        <span className="text-[11px] font-medium text-ink-500 border border-ink-700 rounded-full px-2 py-0.5 flex-shrink-0">Skip</span>
        <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 text-ink-500 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-sm text-ink-300">{skipReason(p)}</p>
          <Why p={{ ...p, why: p.why ? { ...p.why, narration: null, detail: null } : null }} onPlayer={p.playerKey ? () => setPlayerOpen(true) : null} />
          <HistoryChart p={chartP} />
        </div>
      )}
      {playerOpen && <PlayerSheet playerKey={p.playerKey} name={p.player} team={p.team} onClose={() => setPlayerOpen(false)} />}
    </div>
  )
}

export default function PropCard({ p, showOutcome = false }) {
  if (p.locked) return <LockedProp p={p} />
  return <OpenPropCard p={p} showOutcome={showOutcome} />
}

function OpenPropCard({ p, showOutcome }) {
  const [open, setOpen] = useState(false)
  const started = !!p.started
  const [playerOpen, setPlayerOpen] = useState(false)
  const canExplain = !showOutcome && (p.why?.narration || whyFacts(p).length > 0 || !!p.playerKey)
  const openPlayer = p.playerKey ? (e) => { e?.stopPropagation?.(); setPlayerOpen(true) } : null
  const o = showOutcome ? OUTCOME[p.outcome] : null
  const hasEvidence = !showOutcome && p.ourProb != null && p.bookProb != null
  // Only an ungraded started read polls the tracker. Once the official
  // grade lands the card shows that instead.
  const feed = useLiveProps(started && !OUTCOME[p.outcome])
  const live = feed?.reads?.[liveReadKey(p)] || null
  const liveGame = feed?.games?.[liveGameKey(p)] || null
  return (
    // The whole card opens the why (owner 2026-10-13: "I still can't click
    // anything on a prop to see research"). The labeled button stays for
    // keyboards and screen readers.
    <div
      onClick={canExplain ? () => setOpen(v => !v) : undefined}
      className={`bg-ink-900 rounded-2xl border border-ink-700 px-4 py-4 flex flex-col gap-3 ${canExplain ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center gap-3">
        <Avatar name={p.player} team={p.team} />
        <div className="min-w-0 flex-1">
          {openPlayer && p.player
            ? <button type="button" onClick={openPlayer} className="block max-w-full text-left font-semibold text-ink-100 leading-tight truncate underline decoration-ink-600 underline-offset-4 hover:decoration-signal-pos">{p.player}</button>
            : <div className="font-semibold text-ink-100 leading-tight truncate">{p.player || p.text}</div>}
          <div className="text-xs text-ink-400 truncate">
            {p.awayAbbr && p.homeAbbr ? `${p.awayAbbr} at ${p.homeAbbr}` : `${p.away_team} at ${p.home_team}`} · {started ? `Started ${fmtClock(p.commence_time)}` : fmtGameDateTime(p.commence_time)}
          </div>
        </div>
        {started
          ? <StartedChip p={p} live={live} />
          : o
            ? <span className={`text-xs font-semibold flex-shrink-0 ${o.cls}`}>{o.label}{p.actual != null ? ` · ${p.actual}` : ''}</span>
            : <ShadowBadge />}
      </div>

      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-lg font-semibold text-ink-100 leading-snug min-w-0 first-letter:uppercase">{p.player ? pickLine(p) : p.text}</span>
          <span className=" text-base tabular-nums text-ink-200 flex-shrink-0">{fmtOdds(p.price)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          {started
            ? <span className="text-xs text-ink-400 tabular-nums">Locked at {fmtClock(p.commence_time)}, {fmtOdds(p.price)}</span>
            : <span />}
          {/* Track bet (owner 2026-10-16): one tap puts the read on the
              Tracked tab. Gone once the official grade is in. */}
          {!OUTCOME[p.outcome] && <TrackButton item={propItem(p)} />}
        </div>
      </div>

      {started && <LiveTracker p={p} live={live} game={liveGame} />}

      {!showOutcome && (() => {
        const evidence = hasEvidence
          ? <ProbBar ours={p.ourProb} book={p.bookProb} />
          : (
            <div className="text-sm text-ink-300">
              We put this <span className="font-semibold tabular-nums text-ink-100">{Math.round(Number(p.edgePp))}%</span> above the book.
            </div>
          )
        if (!canExplain) return evidence
        return (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
              aria-expanded={open}
              className="text-left flex flex-col gap-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-pos"
            >
              {evidence}
              <span className="flex items-center gap-1 text-xs font-semibold text-signal-pos">
                {open ? 'Hide the why' : 'Why we like it'}
                <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </span>
            </button>
            {open && <div onClick={(e) => e.stopPropagation()}><Why p={p} onPlayer={openPlayer} /></div>}
          </div>
        )
      })()}

      {!showOutcome && <HistoryChart p={p} />}

      {!showOutcome && <SideChips p={p} />}

      {!showOutcome && !started && <LineShop shop={p.shop} compact />}

      {playerOpen && (
        <div onClick={(e) => e.stopPropagation()}>
          <PlayerSheet playerKey={p.playerKey} name={p.player} team={p.team} onClose={() => setPlayerOpen(false)} />
        </div>
      )}
    </div>
  )
}
