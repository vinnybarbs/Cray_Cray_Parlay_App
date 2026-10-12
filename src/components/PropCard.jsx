import React from 'react'
import { fmtGameDateTime } from '../lib/gameTime'

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
    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-ink-400 border border-ink-700 rounded-full px-2 py-0.5 flex-shrink-0">
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

function Avatar({ name, team }) {
  return (
    <div className="relative w-11 h-11 flex-shrink-0" aria-hidden="true">
      <div className="w-11 h-11 rounded-full bg-ink-750 border border-ink-600 flex items-center justify-center text-sm font-semibold text-ink-200">
        {initials(name)}
      </div>
      {team && (
        <span className="absolute -right-1.5 -bottom-1 font-mono text-[8px] font-bold leading-none px-1 py-0.5 rounded bg-ink-950 border border-ink-600 text-ink-200">
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
        <span>Book says <span className="font-mono tabular-nums text-ink-300">{Math.round(book)}%</span></span>
        <span>We say <span className="font-mono tabular-nums font-semibold text-signal-pos">{Math.round(ours)}%</span></span>
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
        <span className="font-mono tabular-nums text-ink-200">{h.hits} of {n}</span>
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

export default function PropCard({ p, showOutcome = false }) {
  const o = showOutcome ? OUTCOME[p.outcome] : null
  const hasEvidence = !showOutcome && p.ourProb != null && p.bookProb != null
  return (
    <div className="bg-ink-900 rounded-2xl border border-ink-700 px-4 py-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar name={p.player} team={p.team} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink-100 leading-tight truncate">{p.player || p.text}</div>
          <div className="text-xs text-ink-400 truncate">
            {p.awayAbbr && p.homeAbbr ? `${p.awayAbbr} at ${p.homeAbbr}` : `${p.away_team} at ${p.home_team}`} · {fmtGameDateTime(p.commence_time)}
          </div>
        </div>
        {o
          ? <span className={`text-xs font-semibold flex-shrink-0 ${o.cls}`}>{o.label}{p.actual != null ? ` · ${p.actual}` : ''}</span>
          : <ShadowBadge />}
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-lg font-semibold text-ink-100 leading-snug min-w-0 first-letter:uppercase">{p.player ? pickLine(p) : p.text}</span>
        <span className="font-mono text-base tabular-nums text-ink-200 flex-shrink-0">{fmtOdds(p.price)}</span>
      </div>

      {hasEvidence
        ? <ProbBar ours={p.ourProb} book={p.bookProb} />
        : !showOutcome && (
          <div className="text-sm text-ink-300">
            We make this <span className="font-semibold tabular-nums text-ink-100">{Number(p.edgePp).toFixed(1)} points</span> more likely than the price says.
          </div>
        )}

      {!showOutcome && <HistoryChart p={p} />}

      {!showOutcome && <SideChips p={p} />}
    </div>
  )
}
