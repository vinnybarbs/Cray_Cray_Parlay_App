import React from 'react'
import { teamColors } from '../lib/teamColors'

// The Board's game tracker (owner 2026-10-16: "a game tracker somewhere,
// maybe for the standard board"). Three pieces, all fed by useLiveGames:
//   LiveScoreboard   the score block on a started card, in place of the
//                    "Game in progress" chip
//   StandingLine     where the pick stands, in plain words, with a pill
//   LiveNowRail      one chip per started game, score and clock only, on
//                    the Board, Props and Tracked (owner 2026-10-18: "should
//                    not have our bets in it")
// Team-color initials circles, no logos. Amber when our side is good,
// crimson when it is not, grey when nothing is decided. A trap is read
// the other way round: the bait side losing is the good news.

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

export function TeamDot({ name, abbr, sport, size = 'md' }) {
  const c = teamColors(abbr, sport)
  const dim = size === 'sm' ? 'w-[18px] h-[18px] text-[7px] border' : 'w-[30px] h-[30px] text-[10px] border-2'
  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full font-extrabold ${dim} ${c ? '' : 'bg-ink-750 border-ink-600 text-ink-200'}`}
      style={c ? { backgroundColor: c.bg, borderColor: c.accent, color: c.fg } : undefined}
    >
      {initials(name) || abbr}
    </span>
  )
}

// Good news is amber, bad news crimson, undecided grey. A trap flips the
// reading: the bait side behind is what we called.
function standingTone(standing, { trap = false } = {}) {
  if (!standing) return 'mid'
  const good = ['ahead', 'won'].includes(standing.status)
  const bad = ['behind', 'lost'].includes(standing.status)
  if (trap) return bad ? 'pos' : good ? 'neg' : 'mid'
  return good ? 'pos' : bad ? 'neg' : 'mid'
}

const TONE = {
  pos: 'bg-signal-pos-dim/40 text-signal-pos',
  neg: 'bg-signal-neg-dim/40 text-signal-neg',
  mid: 'bg-ink-800 text-ink-200',
}

export function StandingPill({ standing, trap = false, className = '' }) {
  if (!standing) return null
  return (
    <span className={`px-2 py-0.5 rounded-full font-semibold text-[11px] whitespace-nowrap ${TONE[standingTone(standing, { trap })]} ${className}`}>
      {trap ? `Bait side: ${standing.label.charAt(0).toLowerCase()}${standing.label.slice(1)}` : standing.label}
    </span>
  )
}

/** The pill plus the sentence under the pick, inside the pick block. */
export function StandingLine({ standing, trap = false }) {
  if (!standing) return null
  return (
    <div className="mt-2 pt-2 border-t border-ink-700 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-200">
      <StandingPill standing={standing} trap={trap} />
      {standing.note && <span>{standing.note}</span>}
    </div>
  )
}

function ScoreRow({ team, sport, lead }) {
  return (
    <div className={`flex items-center gap-2.5 ${lead ? 'text-ink-100' : 'text-ink-300'}`}>
      <TeamDot name={team.name} abbr={team.abbr} sport={sport} />
      <span className="flex-1 min-w-0 flex items-center gap-1.5 text-sm truncate">
        <span className="truncate">{team.short || team.name}</span>
        {team.possession && <span className="w-1.5 h-1.5 rounded-full bg-signal-pos flex-shrink-0" title="Has the ball" aria-label="has the ball" />}
      </span>
      <span className={`tabular-nums text-xl font-bold min-w-[1.75rem] text-right ${lead ? 'text-ink-50' : 'text-ink-300'}`}>{team.score ?? ''}</span>
    </div>
  )
}

/** The score block: a row per team, the clock and situation beside. */
export function LiveScoreboard({ live, sport }) {
  if (!live || !live.home || !live.away) return null
  const hs = live.home.score ?? 0, as = live.away.score ?? 0
  const final = !!live.final
  return (
    <div className="mt-2 bg-ink-850 rounded-sharp px-3 py-2.5 grid grid-cols-[1fr_auto] gap-x-3 items-center">
      <div className="flex flex-col gap-2 min-w-0">
        <ScoreRow team={live.away} sport={sport} lead={as >= hs} />
        <ScoreRow team={live.home} sport={sport} lead={hs >= as} />
      </div>
      <div className="border-l border-ink-700 pl-3 self-stretch flex flex-col justify-center gap-0.5 min-w-[5.5rem]">
        {final ? (
          <span className="text-[11px] font-semibold text-ink-300">Final</span>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-signal-pos">
            <span className="w-1.5 h-1.5 rounded-full bg-signal-pos animate-pulse" />Live
          </span>
        )}
        {!final && live.detail && <span className="tabular-nums text-[13px] font-semibold text-ink-100 whitespace-nowrap">{live.detail}</span>}
        {!final && live.downDistance && <span className="tabular-nums text-[11px] text-ink-400 whitespace-nowrap">{live.downDistance}</span>}
      </div>
    </div>
  )
}

/**
 * The Live now strip: one chip per started game, the score and the clock,
 * nothing about our reads (owner 2026-10-18). items:
 *   [{ key, live, sport }]   (src/lib/liveNow.js liveNowItems)
 * onJump(key), when given, scrolls the page to that game.
 */
export function LiveNowRail({ items, onJump }) {
  if (!items || items.length === 0) return null
  const playing = items.filter(i => !i.live.final).length
  const finals = items.length - playing
  const summary = [
    playing > 0 ? `${playing} in progress` : null,
    finals > 0 ? `${finals} final` : null,
  ].filter(Boolean).join(', ')
  return (
    <section aria-label="Live now" className="bg-ink-900 rounded-sharp shadow-hairline px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink-200 mb-2">
        <span className="relative flex w-2 h-2" aria-hidden="true">
          {playing > 0 && <span className="absolute inline-flex h-full w-full rounded-full bg-signal-pos opacity-60 motion-safe:animate-ping" />}
          <span className={`relative inline-flex w-2 h-2 rounded-full ${playing > 0 ? 'bg-signal-pos' : 'bg-ink-500'}`} />
        </span>
        Live now
        <span className="font-normal text-ink-400">· {summary}</span>
      </div>
      <ul className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 [scrollbar-width:none]">
        {items.map(it => {
          const { live } = it
          const hs = live.home.score ?? 0, as = live.away.score ?? 0
          const body = (
            <>
              <span className="flex flex-col gap-1">
                <span className={`flex items-center gap-1.5 text-xs ${as >= hs ? 'text-ink-100' : 'text-ink-300'}`}>
                  <TeamDot size="sm" name={live.away.name} abbr={live.away.abbr} sport={it.sport} />
                  <span className="max-w-[6.5rem] truncate">{live.away.abbr || live.away.name}</span>
                  {live.away.possession && <span className="w-1.5 h-1.5 rounded-full bg-signal-pos flex-shrink-0" aria-label="has the ball" />}
                  <span className="ml-auto pl-2 tabular-nums font-bold">{live.away.score ?? ''}</span>
                </span>
                <span className={`flex items-center gap-1.5 text-xs ${hs >= as ? 'text-ink-100' : 'text-ink-300'}`}>
                  <TeamDot size="sm" name={live.home.name} abbr={live.home.abbr} sport={it.sport} />
                  <span className="max-w-[6.5rem] truncate">{live.home.abbr || live.home.name}</span>
                  {live.home.possession && <span className="w-1.5 h-1.5 rounded-full bg-signal-pos flex-shrink-0" aria-label="has the ball" />}
                  <span className="ml-auto pl-2 tabular-nums font-bold">{live.home.score ?? ''}</span>
                </span>
              </span>
              <span className="flex flex-col items-start justify-center gap-0.5 border-l border-ink-700 pl-2.5 self-stretch">
                {live.final ? (
                  <span className="text-[11px] font-semibold text-ink-300">Final</span>
                ) : (
                  <span className="tabular-nums text-[11px] font-semibold text-ink-100 whitespace-nowrap">{live.detail || 'Live'}</span>
                )}
                {!live.final && live.downDistance && <span className="tabular-nums text-[10px] text-ink-400 whitespace-nowrap">{live.downDistance}</span>}
              </span>
            </>
          )
          const cls = 'flex items-center gap-2.5 rounded-xl bg-ink-850 shadow-hairline px-2.5 py-2 text-left'
          return (
            <li key={it.key} className="flex-shrink-0">
              {onJump
                ? <button type="button" onClick={() => onJump(it.key)} className={`${cls} hover:shadow-hairline-bright`}>{body}</button>
                : <div className={cls}>{body}</div>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default LiveScoreboard
