import React, { useEffect, useState } from 'react'
import { API_BASE_URL as API_BASE } from '../config'

// Player sheet (owner 2026-10-13: "a clickable player with some stats and
// summary"). Opens from a prop card: this season's game log, averages,
// red zone usage and every read we have made on the player with how it
// graded. Built only from data we already sync.

const LABEL = {
  completions: 'Cmp', attempts: 'Att', passing_yards: 'Pass yds', passing_tds: 'Pass TD', interceptions: 'INT',
  carries: 'Car', rushing_yards: 'Rush yds', rushing_tds: 'Rush TD',
  targets: 'Tgt', receptions: 'Rec', receiving_yards: 'Rec yds', receiving_tds: 'Rec TD',
}

// The columns a bettor looks at first, by position. At most five fit a
// phone, and only stats the player actually logged show.
const PRIORITY = {
  QB: ['passing_yards', 'passing_tds', 'interceptions', 'rushing_yards', 'rushing_tds'],
  RB: ['carries', 'rushing_yards', 'receptions', 'receiving_yards', 'rushing_tds'],
  WR: ['targets', 'receptions', 'receiving_yards', 'receiving_tds', 'rushing_yards'],
  TE: ['targets', 'receptions', 'receiving_yards', 'receiving_tds'],
}
const FALLBACK = ['passing_yards', 'carries', 'rushing_yards', 'targets', 'receptions', 'receiving_yards', 'rushing_tds', 'receiving_tds']

export function columnsFor(position, used) {
  const order = PRIORITY[position] || FALLBACK
  return order.filter(k => used.includes(k)).slice(0, 5)
}

const OUTCOME = { won: ['Hit', 'text-signal-pos'], lost: ['Missed', 'text-signal-neg'], push: ['Push', 'text-ink-400'] }

function ReadRow({ r }) {
  const o = OUTCOME[r.outcome]
  const when = new Date(r.commence_time).toLocaleDateString([], { month: 'short', day: 'numeric' })
  return (
    <li className="flex items-baseline justify-between gap-3 py-2 border-t border-ink-800 text-sm">
      <div className="min-w-0">
        <div className="text-ink-200 first-letter:uppercase truncate">{r.label || r.text}</div>
        <div className="text-xs text-ink-500">{when}{r.opponent ? ` vs ${r.opponent}` : ''}</div>
      </div>
      <span className={`text-xs font-semibold flex-shrink-0 tabular-nums ${o ? o[1] : 'text-ink-400'}`}>
        {o ? o[0] : 'Open'}{r.actual != null ? ` · ${r.actual}` : ''}
      </span>
    </li>
  )
}

export default function PlayerSheet({ playerKey, name, team, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/player?key=${encodeURIComponent(playerKey)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [playerKey])

  // Lock the page behind the sheet.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const p = data?.player
  const cols = data ? columnsFor(p?.position, data.used || []) : []
  const rz = data?.redzone
  const rec = data?.record

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 cursor-default" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${name} player sheet`}>
      <div
        className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto bg-ink-900 shadow-hairline rounded-t-2xl sm:rounded-2xl px-5 pt-5 text-left"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-ink-100 leading-tight">{p?.name || name}</h2>
            <p className="text-xs text-ink-400">{[p?.position, p?.team || team, data?.season ? `${data.season} season` : null].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-ink-800 text-ink-300 hover:text-ink-100 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {error && <p className="text-sm text-ink-400">This player did not load. Try again in a minute.</p>}
        {!data && !error && <p className="text-sm text-ink-400">Loading</p>}

        {data && (
          <div className="flex flex-col gap-5">
            {cols.length > 0 && (
              <section className="grid grid-cols-3 gap-2" aria-label="Season averages">
                {cols.slice(0, 3).map(k => (
                  <div key={k} className="bg-ink-850 rounded-xl px-3 py-2">
                    <div className="text-lg font-semibold tabular-nums text-ink-100">{data.averages[k]}</div>
                    <div className="text-[11px] text-ink-400">{LABEL[k]} a game</div>
                  </div>
                ))}
              </section>
            )}

            {rz && rz.games > 0 && (rz.rz_carries > 0 || rz.rz_targets > 0) && (
              <p className="text-sm text-ink-300">
                Red zone, last {rz.games} games:{' '}
                {[rz.rz_carries > 0 ? `${rz.rz_carries} carries${rz.team_rz_carries ? ` of the team's ${rz.team_rz_carries}` : ''}` : null,
                  rz.rz_targets > 0 ? `${rz.rz_targets} targets${rz.team_rz_targets ? ` of the team's ${rz.team_rz_targets}` : ''}` : null]
                  .filter(Boolean).join(', ')}.
              </p>
            )}

            {data.games.length > 0 && (
              <section aria-label="Game log">
                <h3 className="text-sm font-semibold text-ink-200 mb-2">Game log</h3>
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="text-ink-500">
                      <th className="text-left font-normal pb-1">Wk</th>
                      <th className="text-left font-normal pb-1">Opp</th>
                      {cols.map(k => <th key={k} className="text-right font-normal pb-1">{LABEL[k]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.games.map(g => (
                      <tr key={`${g.season}-${g.week}`} className="border-t border-ink-800 text-ink-200">
                        <td className="py-1.5">{g.week}</td>
                        <td className="py-1.5 text-ink-400">{g.opponent || ''}</td>
                        {cols.map(k => <td key={k} className="py-1.5 text-right">{g[k]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <section aria-label="Our reads on this player">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <h3 className="text-sm font-semibold text-ink-200">Our reads on {p?.name?.split(' ').slice(-1)[0] || 'him'}</h3>
                {rec && rec.won + rec.lost > 0 && (
                  <span className="text-xs tabular-nums text-ink-300">{rec.won}-{rec.lost}{rec.push ? `-${rec.push}` : ''}</span>
                )}
              </div>
              {data.reads.length === 0
                ? <p className="text-sm text-ink-400">No reads with us 4% or more above the book yet.</p>
                : <ul>{data.reads.map((r, i) => <ReadRow key={i} r={r} />)}</ul>}
              <p className="text-[11px] text-ink-500 mt-2">Shadow reads, not in the official record.</p>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
