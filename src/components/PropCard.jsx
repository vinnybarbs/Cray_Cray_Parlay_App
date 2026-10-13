import React, { useState } from 'react'
import { fmtGameDateTime } from '../lib/gameTime'
import { teamColors } from '../lib/teamColors'

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

function Why({ p }) {
  const narration = p.why?.narration
  const facts = whyFacts(p)
  if (!narration && facts.length === 0) return null
  return (
    <div className="flex flex-col gap-3 pt-1">
      {narration && <p className="text-sm text-ink-200 leading-relaxed">{narration}</p>}
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
    </div>
  )
}

export default function PropCard({ p, showOutcome = false }) {
  const [open, setOpen] = useState(false)
  const canExplain = !showOutcome && (p.why?.narration || whyFacts(p).length > 0)
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
        <span className=" text-base tabular-nums text-ink-200 flex-shrink-0">{fmtOdds(p.price)}</span>
      </div>

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
              onClick={() => setOpen(o => !o)}
              aria-expanded={open}
              className="text-left flex flex-col gap-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-pos"
            >
              {evidence}
              <span className="flex items-center gap-1 text-xs font-semibold text-signal-pos">
                {open ? 'Hide the why' : 'Why we like it'}
                <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </span>
            </button>
            {open && <Why p={p} />}
          </div>
        )
      })()}

      {!showOutcome && <HistoryChart p={p} />}

      {!showOutcome && <SideChips p={p} />}
    </div>
  )
}
