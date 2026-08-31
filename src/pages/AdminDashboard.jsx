import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import BrandMark, { SignOutButton } from '../components/BrandMark'

import { API_BASE_URL as API_BASE } from '../config'

// ─── Utility helpers ──────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return 'Never'
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function fmtDate(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString()
}

function winRate(won, lost) {
  const settled = won + lost
  if (settled === 0) return null
  return Math.round((won / settled) * 100)
}

// Per-table freshness thresholds (hours). Some tables only update daily
const FRESHNESS_THRESHOLDS = {
  game_results: { fresh: 26, stale: 50 },     // Daily backfill at 5 AM
  game_analysis: { fresh: 4, stale: 8 },       // Every 2-3h per sport
  news_cache: { fresh: 4, stale: 12 },         // Every 3h
  news_articles: { fresh: 4, stale: 8 },       // Every 2h
  odds_cache: { fresh: 2, stale: 4 },          // Hourly
}

function freshnessColor(ts, table) {
  if (!ts) return 'text-signal-neg'
  const hrs = (Date.now() - new Date(ts).getTime()) / 3600000
  const t = FRESHNESS_THRESHOLDS[table] || { fresh: 4, stale: 12 }
  if (hrs < t.fresh) return 'text-green-400'
  if (hrs < t.stale) return 'text-signal-pos'
  return 'text-signal-neg'
}

function freshnessLabel(ts, table) {
  if (!ts) return 'No data'
  const hrs = (Date.now() - new Date(ts).getTime()) / 3600000
  const t = FRESHNESS_THRESHOLDS[table] || { fresh: 4, stale: 12 }
  if (hrs < t.fresh) return 'Active'
  if (hrs < t.stale) return 'Aging'
  return 'Needs attention'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, sub }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {sub && <p className="text-ink-400 text-xs mt-0.5">{sub}</p>}
    </div>
  )
}

function StatCard({ label, value, sub, color = 'yellow' }) {
  const colors = {
    yellow: 'text-signal-pos',
    green:  'text-emerald-400',
    red:    'text-signal-neg',
    blue:   'text-sky-400',
    gray:   'text-ink-300',
    purple: 'text-violet-400',
  }
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
      <p className="font-mono text-[10px] text-ink-400 uppercase tracking-[0.14em]">{label}</p>
      <p className={`font-mono text-2xl font-semibold mt-1 tabular-nums ${colors[color]}`}>
        {value}
      </p>
      {sub && <p className="font-mono text-[11px] text-ink-400 mt-1 tabular-nums">{sub}</p>}
    </div>
  )
}

function StatusDot({ status }) {
  const isOk = status === 'success' || status === 'completed' || status === 'ok'
  const isWarn = status === 'warning' || status === 'skipped'
  const isFail = status === 'failed' || status === 'error'
  const cls = isOk ? 'bg-green-500' : isWarn ? 'bg-signal-pos' : isFail ? 'bg-red-500' : 'bg-ink-600'
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} flex-shrink-0`} />
}

function OutcomeChip({ outcome }) {
  const map = {
    won: 'bg-green-900 text-green-300 border-ink-700',
    lost: 'bg-signal-neg-dim text-signal-neg border-red-700',
    push: 'bg-signal-pos-dim text-signal-pos/80 border-yellow-700',
    pending: 'bg-ink-800 text-ink-300 border-ink-600',
  }
  const label = {
    won: 'Won', lost: 'Lost', push: 'Push', pending: 'Pending'
  }
  const key = outcome || 'pending'
  const cls = map[key] || map.pending
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {label[key] || key}
    </span>
  )
}

function WinRateBar({ won, lost }) {
  const total = won + lost
  if (total === 0) return <span className="text-ink-400 text-xs">No settled picks</span>
  const pct = Math.round((won / total) * 100)
  const barColor = pct >= 55 ? 'bg-green-500' : pct >= 45 ? 'bg-signal-pos' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-ink-800 rounded-full h-2">
        <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-white text-xs font-bold w-8 text-right">{pct}%</span>
    </div>
  )
}

// ─── Sections ─────────────────────────────────────────────────────────────────

// ─── Scrollable feed panel: shared shell for intel / runs / analyses ────────
function FeedPanel({ title, sub, children, maxH = 'max-h-[420px]' }) {
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden">
      <div className="px-4 py-3 bg-ink-950 border-b border-ink-800">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-pos">{title}</p>
        {sub && <p className="text-ink-500 text-[11px] mt-0.5">{sub}</p>}
      </div>
      <div className={`${maxH} overflow-y-auto`}>
        {children}
      </div>
    </div>
  )
}

function Cell({ label, value, mono = true }) {
  const display = value == null || value === '' ? '-'
    : typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(3))
    : String(value)
  return (
    <div className="bg-ink-950/60 rounded-sharp px-2.5 py-1.5 min-w-0">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-500 truncate">{label}</p>
      <p className={`text-xs ${mono ? 'font-mono tabular-nums' : ''} ${value == null || value === '' ? 'text-ink-600' : 'text-ink-100'} break-words`}>{display}</p>
    </div>
  )
}

function JsonCell({ label, value }) {
  if (value == null) return <Cell label={label} value={null} />
  return (
    <div className="bg-ink-950/60 rounded-sharp px-2.5 py-1.5 col-span-2 sm:col-span-3 min-w-0">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-500">{label}</p>
      <pre className="text-[10px] text-ink-300 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{JSON.stringify(value, null, 1)}</pre>
    </div>
  )
}

function UpcomingInspectorSection({ analyses }) {
  const [openKey, setOpenKey] = useState(null)
  const upcoming = analyses || []
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden">
      <div className="px-4 py-3 bg-ink-950 border-b border-ink-800">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-pos">Upcoming game inspector</p>
        <p className="text-ink-500 text-[11px] mt-0.5">{upcoming.length} analyzed games not yet started. Tap one to see every cell the tile is built from</p>
      </div>
      <div className="max-h-[560px] overflow-y-auto">
        {upcoming.length === 0 ? (
          <p className="px-4 py-8 text-center text-ink-500 text-sm">Nothing analyzed and upcoming right now.</p>
        ) : upcoming.map((g) => {
          const isOpen = openKey === g.game_key
          return (
            <div key={g.game_key}>
              <button
                onClick={() => setOpenKey(isOpen ? null : g.game_key)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-t border-ink-800/60 transition-colors ${isOpen ? 'bg-ink-850/70' : 'hover:bg-ink-850/40'}`}
              >
                <span className="font-mono text-[10px] text-ink-500 w-20 flex-shrink-0 truncate">{g.sport}</span>
                <span className="text-sm text-ink-100 truncate flex-1">{g.away_team} @ {g.home_team}</span>
                <span className={`font-mono text-[10px] flex-shrink-0 ${g.recommended_pick ? 'text-signal-pos' : 'text-ink-500'}`}>{g.recommended_pick || 'preview'}</span>
                <span className="font-mono text-[10px] text-ink-500 flex-shrink-0">{fmtDate(g.game_date)}</span>
              </button>
              {isOpen && (
                <div className="px-4 py-3 bg-ink-950/40 border-t border-ink-800/40">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
                    <Cell label="game_key" value={g.game_key} />
                    <Cell label="version" value={g.analysis_version} />
                    <Cell label="stale" value={String(g.stale)} />
                    <Cell label="generated" value={timeAgo(g.generated_at)} />
                    <Cell label="expires" value={timeAgo(g.expires_at)} />
                    <Cell label="tokens in/out" value={`${g.prompt_tokens ?? '-'} / ${g.completion_tokens ?? '-'}`} />
                    <Cell label="pick" value={g.recommended_pick} />
                    <Cell label="side" value={g.recommended_side} />
                    <Cell label="pick odds" value={g.recommended_odds} />
                    <Cell label="edge score" value={g.edge_score} />
                    <Cell label="calc edge" value={g.calc_edge} />
                    <Cell label="edge side" value={g.calc_edge_side} />
                    <Cell label="spread" value={g.spread} />
                    <Cell label="total" value={g.total} />
                    <Cell label="ml home" value={g.moneyline_home} />
                    <Cell label="ml away" value={g.moneyline_away} />
                    <Cell label="home rec" value={g.home_record} />
                    <Cell label="away rec" value={g.away_record} />
                    <Cell label="calc P(home)" value={g.calc_home_prob} />
                    <Cell label="calc P(away)" value={g.calc_away_prob} />
                    <Cell label="implied P(home)" value={g.implied_home_prob} />
                    <Cell label="implied P(away)" value={g.implied_away_prob} />
                    <Cell label="home rank" value={g.home_ranking} />
                    <Cell label="away rank" value={g.away_ranking} />
                    <JsonCell label="edges (capped)" value={g.edges} />
                    <JsonCell label="edges raw" value={g.edges_raw} />
                    <JsonCell label="edge factors + adjustments" value={g.edge_factors} />
                    <JsonCell label="key factors" value={g.key_factors} />
                  </div>
                  <div className="mt-2 space-y-2">
                    <div className="bg-ink-950/60 rounded-sharp px-2.5 py-1.5">
                      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-500">analysis snippet</p>
                      <p className="text-xs text-ink-200 leading-relaxed">{g.analysis_snippet || '-'}</p>
                      {g.what_changed && <p className="mt-1 text-[11px] text-signal-pos/80">Changed: {g.what_changed}</p>}
                    </div>
                    {g.news_context && (
                      <div className="bg-ink-950/60 rounded-sharp px-2.5 py-1.5">
                        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-500">news context (as fed to the model)</p>
                        <pre className="text-[10px] text-ink-300 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{g.news_context}</pre>
                      </div>
                    )}
                    {g.injury_context && (
                      <div className="bg-ink-950/60 rounded-sharp px-2.5 py-1.5">
                        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-500">injury context</p>
                        <pre className="text-[10px] text-ink-300 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{g.injury_context}</pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// The digital workers' blackboard (agent_reports): every scheduled review,
// audit, ops check, and build session files a row, and each reads recent
// rows before starting. This feed is the same shared memory the workers see.
function AgentReportsSection({ reports }) {
  const [openId, setOpenId] = React.useState(null)
  const agentCls = {
    'ops-check': 'text-signal-pos bg-signal-pos-dim/30',
    'calibration-review': 'text-sky-400 bg-sky-950/50',
    'cost-audit': 'text-amber-400 bg-amber-950/40',
    'build-session': 'text-ink-200 bg-ink-850',
  }
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
      <h2 className="text-white font-semibold mb-1">Worker Reports</h2>
      <p className="text-ink-500 text-xs mb-3">
        The shared blackboard. Reviews, audits, ops checks, and build sessions file here and read each other before starting.
      </p>
      {(!reports || reports.length === 0) ? (
        <p className="text-ink-500 text-sm">No reports filed yet.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {reports.map((r, i) => (
            <div key={i} className="bg-ink-950/60 rounded-sharp px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded-sharp font-mono text-[10px] font-semibold ${agentCls[r.agent] || 'text-ink-300 bg-ink-850'}`}>
                  {r.agent}
                </span>
                <span className="font-mono text-[10px] text-ink-500 tabular-nums">
                  {new Date(r.created_at).toLocaleString()}
                </span>
                {r.findings && (
                  <button
                    onClick={() => setOpenId(openId === i ? null : i)}
                    className="ml-auto font-mono text-[10px] text-ink-400 hover:text-ink-100 transition-colors"
                  >
                    {openId === i ? 'hide detail' : 'detail'}
                  </button>
                )}
              </div>
              <p className="text-ink-200 text-sm mt-1 leading-snug">{r.summary}</p>
              {openId === i && r.findings && (
                <pre className="mt-2 text-[10px] text-ink-300 whitespace-pre-wrap break-words max-h-48 overflow-y-auto bg-ink-950 rounded-sharp p-2">
                  {JSON.stringify(r.findings, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function IntelFeedSection({ intel }) {
  const [kindFilter, setKindFilter] = React.useState(null)
  const kindCls = {
    injury: 'text-signal-neg bg-signal-neg-dim/30',
    weather: 'text-sky-400 bg-sky-950/50',
    record_mismatch: 'text-signal-pos bg-signal-pos-dim/30',
    record_check_summary: 'text-ink-300 bg-ink-850',
    agent_debug: 'text-ink-400 bg-ink-850',
    agent_error: 'text-orange-400 bg-orange-950/40',
  }
  // Each kind's payload has its own shape. The old weather line looked for
  // wind_mph/precip fields the agent never writes and dropped the `note`,
  // which is the actual finding, so weather rows rendered nearly blank.
  const summarize = (kind, p) => {
    if (!p) return ''
    if (kind === 'injury') return [p.player, p.status && `(${p.status})`, p.note || p.summary].filter(Boolean).join(' ') || JSON.stringify(p).slice(0, 140)
    if (kind === 'weather') return [p.note, p.temp_f != null && `${p.temp_f}F`, p.roof && p.roof !== 'none' && `roof: ${p.roof}`, p.source && `(${p.source})`].filter(Boolean).join(' · ')
    if (kind === 'record_mismatch') return `ours ${p.ours || '?'} vs ${p.source || 'web'} ${p.actual || '?'}`
    if (kind === 'record_check_summary') return `${p.checked ?? '?'} checked, ${p.mismatches ?? '?'} mismatches`
    return JSON.stringify(p).slice(0, 140)
  }
  const counts = {}
  for (const r of intel || []) counts[r.kind] = (counts[r.kind] || 0) + 1
  const rows = kindFilter ? (intel || []).filter(r => r.kind === kindFilter) : (intel || [])
  return (
    <FeedPanel title="Intel feed" sub={`${intel?.length || 0} findings from the research agent, newest first. Tap a kind to filter`}>
      <div className="flex flex-wrap gap-1.5 px-4 py-2 border-t border-ink-800/60 bg-ink-950/40">
        {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([kind, n]) => (
          <button
            key={kind}
            onClick={() => setKindFilter(kindFilter === kind ? null : kind)}
            className={`px-2 py-0.5 rounded-full font-mono text-[10px] uppercase tracking-wider transition-colors ${
              kindFilter === kind ? 'bg-signal-pos-dim/60 text-signal-pos font-bold' : `${kindCls[kind] || 'text-ink-300 bg-ink-850'} opacity-90 hover:opacity-100`
            }`}
          >
            {kind.replace(/_/g, ' ')} {n}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-ink-500 text-sm">No intel filed in the current window.</p>
      ) : rows.map((r, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-2.5 border-t border-ink-800/60">
          <span className={`flex-shrink-0 mt-0.5 px-2 py-0.5 rounded-sharp font-mono text-[10px] font-bold uppercase tracking-wider ${kindCls[r.kind] || 'text-ink-300 bg-ink-850'}`}>
            {(r.kind || '?').replace(/_/g, ' ')}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink-100 truncate">{r.team || (r.payload?.game || '-')}</p>
            <p className="text-xs text-ink-400 leading-relaxed">{summarize(r.kind, r.payload)}</p>
          </div>
          <span className="flex-shrink-0 font-mono text-[10px] text-ink-500">{timeAgo(r.created_at)}</span>
        </div>
      ))}
    </FeedPanel>
  )
}

function PipelineRunsSection({ runs }) {
  const [openIdx, setOpenIdx] = React.useState(null)
  return (
    <FeedPanel title="Pipeline runs" sub={`Last ${runs?.length || 0} cron log rows. Tap a row for the raw details`}>
      {(!runs || runs.length === 0) ? (
        <p className="px-4 py-8 text-center text-ink-500 text-sm">No runs logged.</p>
      ) : runs.map((r, i) => (
        <div key={i}>
          <button
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
            className={`w-full flex items-center gap-3 px-4 py-2 text-left border-t border-ink-800/60 transition-colors ${openIdx === i ? 'bg-ink-850/70' : 'hover:bg-ink-850/40'}`}
          >
            <StatusDot status={r.status} />
            <span className="font-mono text-xs text-ink-100 truncate flex-1">{r.job_name}</span>
            <span className={`font-mono text-[10px] uppercase ${r.status === 'failed' ? 'text-signal-neg' : 'text-ink-500'}`}>{r.status}</span>
            <span className="font-mono text-[10px] text-ink-500 flex-shrink-0 w-16 text-right">{timeAgo(r.created_at)}</span>
          </button>
          {openIdx === i && (
            <pre className="px-4 py-2 bg-ink-950/60 text-[11px] text-ink-300 whitespace-pre-wrap break-all border-t border-ink-800/40">{typeof r.details === 'string' ? r.details : JSON.stringify(r.details, null, 1)}</pre>
          )}
        </div>
      ))}
    </FeedPanel>
  )
}

function RecentAnalysesSection({ analyses }) {
  const [openIdx, setOpenIdx] = React.useState(null)
  return (
    <FeedPanel title="Analysis engine output" sub={`Last ${analyses?.length || 0} game analyses. Version, pick, tokens; tap for the written text`}>
      {(!analyses || analyses.length === 0) ? (
        <p className="px-4 py-8 text-center text-ink-500 text-sm">No analyses in the window.</p>
      ) : analyses.map((a, i) => (
        <div key={i}>
          <button
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
            className={`w-full flex items-center gap-3 px-4 py-2 text-left border-t border-ink-800/60 transition-colors ${openIdx === i ? 'bg-ink-850/70' : 'hover:bg-ink-850/40'}`}
          >
            <span className="font-mono text-[10px] text-ink-500 w-14 flex-shrink-0">{a.sport}</span>
            <span className="text-xs text-ink-100 truncate flex-1">{a.away_team} @ {a.home_team}</span>
            <span className="font-mono text-[10px] text-ink-400 flex-shrink-0">v{a.analysis_version}</span>
            <span className={`font-mono text-[10px] flex-shrink-0 w-28 truncate text-right ${a.recommended_pick ? 'text-signal-pos' : 'text-ink-500'}`}>
              {a.recommended_pick || 'preview'}
            </span>
            <span className="font-mono text-[10px] text-ink-500 flex-shrink-0 w-14 text-right">{timeAgo(a.generated_at)}</span>
          </button>
          {openIdx === i && (
            <div className="px-4 py-2.5 bg-ink-950/60 border-t border-ink-800/40">
              <p className="text-xs text-ink-200 leading-relaxed">{a.analysis_snippet || 'No text stored.'}</p>
              {a.what_changed && <p className="mt-1.5 text-[11px] text-signal-pos/80">Changed: {a.what_changed}</p>}
              <p className="mt-1.5 font-mono text-[10px] text-ink-500">
                {a.prompt_tokens || 0} in / {a.completion_tokens || 0} out{a.stale ? ' · stale' : ''} · {a.game_key}
              </p>
            </div>
          )}
        </div>
      ))}
    </FeedPanel>
  )
}

function CronHealthSection({ cronHealth, recentErrors }) {
  // Deduplicate: for each job_name keep latest entry only
  const latestByJob = {}
  for (const entry of cronHealth || []) {
    if (!latestByJob[entry.job_name] || new Date(entry.created_at) > new Date(latestByJob[entry.job_name].created_at)) {
      latestByJob[entry.job_name] = entry
    }
  }
  const jobs = Object.values(latestByJob).sort((a, b) => a.job_name.localeCompare(b.job_name))

  return (
    <div className="bg-ink-950 rounded-sharp border border-ink-700 p-5">
      <SectionHeader title="Cron Job Health" sub={`${jobs.length} jobs tracked via pg_cron`} />
      {jobs.length === 0 ? (
        <p className="text-ink-400 text-sm">No cron jobs found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-400 text-xs uppercase border-b border-ink-700">
                <th className="text-left pb-2 pr-4">Job</th>
                <th className="text-left pb-2 pr-4">Schedule</th>
                <th className="text-left pb-2 pr-4">Status</th>
                <th className="text-left pb-2">Last Run</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.job_name} className="border-b border-ink-800 hover:bg-ink-900/50">
                  <td className="py-2 pr-4 text-ink-200 font-mono text-xs">{job.job_name}</td>
                  <td className="py-2 pr-4 text-ink-400 font-mono text-xs">{job.schedule || '-'}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <StatusDot status={job.status} />
                      <span className="text-ink-300 text-xs capitalize">{job.status}</span>
                    </div>
                  </td>
                  <td className="py-2 text-ink-400 text-xs">{timeAgo(job.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recentErrors && recentErrors.length > 0 && (
        <div className="mt-5">
          <p className="text-signal-neg text-xs font-semibold uppercase tracking-wide mb-3">Recent Failures ({recentErrors.length})</p>
          <div className="space-y-2">
            {recentErrors.map((err, i) => (
              <div key={i} className="bg-red-950/40 border border-red-800/50 rounded-sharp p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-signal-neg font-mono text-xs">{err.job_name}</span>
                  <span className="text-ink-400 text-xs">{timeAgo(err.created_at)}</span>
                </div>
                {err.details && (
                  <p className="text-ink-300 text-xs mt-1 line-clamp-2">
                    {typeof err.details === 'string' ? err.details : JSON.stringify(err.details)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DataFreshnessSection({ dataFreshness }) {
  // Render whatever the API measured, so new tables (tennis, ufc, intel)
  // appear here without a client change.
  const tables = Object.keys(dataFreshness || {})
  return (
    <div className="bg-ink-950 rounded-sharp border border-ink-700 p-5">
      <SectionHeader title="Data Freshness" sub="Key tables with count and most recent record" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tables.map((table) => {
          const d = dataFreshness?.[table]
          const ts = d?.maxTimestamp
          const count = d?.count
          const colorCls = freshnessColor(ts, table)
          const label = freshnessLabel(ts, table)
          return (
            <div key={table} className="bg-ink-900 rounded-sharp p-3 border border-ink-700">
              <p className="text-ink-300 text-xs font-mono mb-1">{table}</p>
              <p className={`text-sm font-semibold ${colorCls}`}>{label}</p>
              <p className="text-ink-400 text-xs mt-1">
                {count !== null && count !== undefined ? `${count.toLocaleString()} rows` : 'Count unavailable'}
              </p>
              <p className="text-ink-500 text-xs">{ts ? timeAgo(ts) : 'No timestamp found'}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Sortable stats table: click a column header to sort by it, click again
// to flip direction. Shared by the tier / sport / bet-type breakdowns.
function SortableStatsTable({ title, groups }) {
  const [sortKey, setSortKey] = React.useState('settled')
  const [sortDir, setSortDir] = React.useState(-1)
  const cols = [
    { key: 'name', label: title, numeric: false },
    { key: 'settled', label: 'Settled', numeric: true },
    { key: 'won', label: 'W', numeric: true },
    { key: 'lost', label: 'L', numeric: true },
    { key: 'push', label: 'Push', numeric: true },
    { key: 'pending', label: 'Open', numeric: true },
    { key: 'hitRate', label: 'Hit %', numeric: true },
  ]
  const rows = Object.entries(groups || {}).map(([name, c]) => {
    const won = c.won || 0, lost = c.lost || 0
    return {
      name,
      won,
      lost,
      push: c.push || 0,
      pending: c.pending || 0,
      settled: won + lost + (c.push || 0),
      hitRate: (won + lost) > 0 ? Math.round((won / (won + lost)) * 1000) / 10 : null,
    }
  })
  rows.sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return (av < bv ? -1 : av > bv ? 1 : 0) * sortDir
  })
  const clickCol = (key) => {
    if (sortKey === key) setSortDir(d => -d)
    else { setSortKey(key); setSortDir(key === 'name' ? 1 : -1) }
  }
  if (rows.length === 0) return null
  return (
    <div className="mb-5 overflow-x-auto">
      <table className="w-full text-sm min-w-[420px]">
        <thead>
          <tr className="text-ink-400 text-xs uppercase border-b border-ink-700">
            {cols.map(c => (
              <th
                key={c.key}
                onClick={() => clickCol(c.key)}
                className={`pb-2 pr-3 cursor-pointer select-none hover:text-ink-100 ${c.numeric ? 'text-right' : 'text-left'} ${sortKey === c.key ? 'text-signal-pos' : ''}`}
                title="Click to sort"
              >
                {c.label}{sortKey === c.key ? (sortDir === -1 ? ' ▼' : ' ▲') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.name} className="border-b border-ink-800 hover:bg-ink-900/50">
              <td className="py-1.5 pr-3 text-ink-200 text-xs capitalize">{r.name}</td>
              <td className="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-ink-300">{r.settled}</td>
              <td className="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-green-400">{r.won}</td>
              <td className="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-signal-neg">{r.lost}</td>
              <td className="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-ink-500">{r.push}</td>
              <td className="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-ink-500">{r.pending}</td>
              <td className={`py-1.5 text-right font-mono text-xs font-bold tabular-nums ${
                r.hitRate == null ? 'text-ink-500' : r.hitRate >= 55 ? 'text-signal-pos' : r.hitRate >= 50 ? 'text-ink-100' : 'text-signal-neg'
              }`}>{r.hitRate != null ? `${r.hitRate}%` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ModelPerformanceSection({ modelAccuracy }) {
  const { overall, bySport, byBetType, byTier, period } = modelAccuracy || {}
  const { won = 0, lost = 0, push = 0, pending = 0, total = 0 } = overall || {}
  const wr = winRate(won, lost)
  const periodLabel = { all: 'all-time', last_30d: 'last 30 days', last_7d: 'last 7 days', last_3d: 'last 3 days' }[period] || period

  return (
    <div className="bg-ink-950 rounded-sharp border border-ink-700 p-5">
      <SectionHeader title="Model Performance" sub={`mv_public_record · ${periodLabel} · click any column to sort. Trap and Leg grade on their own lines`} />

      {/* Top stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Picks" value={total.toLocaleString()} color="blue" />
        <StatCard label="Won" value={won} color="green" sub={`of ${won + lost} settled`} />
        <StatCard label="Lost" value={lost} color="red" />
        <StatCard label="Win Rate" value={wr !== null ? `${wr}%` : 'N/A'} color={wr !== null && wr >= 55 ? 'green' : wr !== null && wr >= 45 ? 'yellow' : 'red'} sub={`${push} push, ${pending} pending`} />
      </div>

      {/* Win rate bar */}
      {(won + lost) > 0 && (
        <div className="mb-6">
          <p className="text-ink-300 text-xs mb-2">Overall Win Rate</p>
          <WinRateBar won={won} lost={lost} />
        </div>
      )}

      <SortableStatsTable title="Tier" groups={byTier} />
      <SortableStatsTable title="Sport" groups={bySport} />
      <SortableStatsTable title="Bet type" groups={byBetType} />
    </div>
  )
}

function RecentPicksSection({ recentPicks }) {
  const [expanded, setExpanded] = useState(null)

  if (!recentPicks || recentPicks.length === 0) {
    return (
      <div className="bg-ink-950 rounded-sharp border border-ink-700 p-5">
        <SectionHeader title="Recent Picks" />
        <p className="text-ink-400 text-sm">No picks found.</p>
      </div>
    )
  }

  return (
    <div className="bg-ink-950 rounded-sharp border border-ink-700 p-5">
      <SectionHeader title="Recent Picks" sub="Last 15 ai_suggestions" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-ink-400 text-xs uppercase border-b border-ink-700">
              <th className="text-left pb-2 pr-3">Sport</th>
              <th className="text-left pb-2 pr-3">Pick</th>
              <th className="text-left pb-2 pr-3">Type</th>
              <th className="text-left pb-2 pr-3">Conf.</th>
              <th className="text-left pb-2 pr-3">Outcome</th>
              <th className="text-left pb-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {recentPicks.map((pick, i) => {
              const isOpen = expanded === i
              const shortReason = pick.reasoning
                ? pick.reasoning.slice(0, 120) + (pick.reasoning.length > 120 ? '…' : '')
                : null
              return (
                <React.Fragment key={pick.id || i}>
                  <tr
                    className="border-b border-ink-800 hover:bg-ink-900/50 cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : i)}
                  >
                    <td className="py-2 pr-3">
                      <span className="text-ink-200 text-xs capitalize">{pick.sport || '-'}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <div>
                        <p className="text-white text-xs font-medium line-clamp-1">{pick.pick || '-'}</p>
                        {pick.game && <p className="text-ink-400 text-xs line-clamp-1">{pick.game}</p>}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="text-ink-300 text-xs capitalize">{pick.bet_type || '-'}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {pick.confidence != null ? (
                        <span className="text-signal-pos text-xs font-bold">{pick.confidence}/10</span>
                      ) : '-'}
                    </td>
                    <td className="py-2 pr-3">
                      <OutcomeChip outcome={pick.actual_outcome} />
                    </td>
                    <td className="py-2 text-ink-400 text-xs">{timeAgo(pick.created_at)}</td>
                  </tr>
                  {isOpen && shortReason && (
                    <tr className="bg-ink-900/40">
                      <td colSpan={6} className="px-3 py-2 text-ink-300 text-xs italic">
                        {pick.reasoning || 'No reasoning stored.'}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

// Inside the grade: the live calibration state behind every published
// tier (owner request 2026-08-25). Self-contained fetch against the
// admin calibration endpoint so the main dashboard payload stays lean.
function CalibrationSection() {
  const [cal, setCal] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: sessionData } = supabase
          ? await supabase.auth.getSession()
          : { data: { session: null } }
        const token = sessionData?.session?.access_token
        if (!token) throw new Error('sign in required')
        const res = await fetch(`${API_BASE}/api/admin/calibration`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!cancelled) setCal(json)
      } catch (e) {
        if (!cancelled) setErr(e.message)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const th = 'text-left text-ink-400 font-mono text-[10px] uppercase tracking-wider px-2 py-1.5'
  const td = 'px-2 py-1.5 text-ink-200 whitespace-nowrap'

  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
      <div className="text-xs text-ink-400 uppercase tracking-wider font-semibold mb-1">
        Inside the grade · current calibration
      </div>
      <p className="text-xs text-ink-500 mb-3 leading-relaxed">
        A sport with its own raw band fit (MLB since 2026-08-31) is sized by
        ONE calibration: the raw model edge mapped through the raw band table
        below, and the mapped value owns both the label and the 2pp publish
        gate. The flat-k multiplier still governs its trap reads. Sports
        without a raw fit run the old chain: raw edge, times the weekly
        flat-k multiplier (clamped 0.25 to 1.2), mapped through per-band
        calibration, then labeled by the ladder, with publication gating on
        the pre-band edge at 2pp.
      </p>
      {err && <p className="text-signal-neg text-sm">Couldn't load calibration: {err}</p>}
      {!cal && !err && <div className="h-16 bg-ink-850 rounded-sharp animate-pulse" />}
      {cal && (
        <div className="space-y-4">
          <div>
            <div className="text-[11px] text-ink-300 font-semibold mb-1">Flat-k multipliers, by sport and market</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr>
                  <th className={th}>key</th><th className={th}>multiplier</th>
                  <th className={th}>measured k</th><th className={th}>n</th><th className={th}>updated</th>
                </tr></thead>
                <tbody>
                  {(cal.multipliers || []).map((m) => (
                    <tr key={m.key} className="border-t border-ink-850" title={m.source || ''}>
                      <td className={`${td} font-mono`}>{m.key}</td>
                      <td className={`${td} font-mono ${Number(m.multiplier) === 0 ? 'text-signal-neg' : ''}`}>{Number(m.multiplier).toFixed(2)}</td>
                      <td className={`${td} font-mono`}>{m.measured_k != null ? Number(m.measured_k).toFixed(2) : '-'}</td>
                      <td className={`${td} font-mono`}>{m.sample_n ?? '-'}</td>
                      <td className={td}>{m.updated_at ? new Date(m.updated_at).toLocaleDateString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-ink-600 mt-1">Hover a row for the source note. Multiplier 0 means the market is muted.</p>
          </div>

          {(cal.bandsRaw || []).length > 0 && (
            <div>
              <div className="text-[11px] text-ink-300 font-semibold mb-1">Raw band map, RAW claimed pp to delivered pp (owns sizing and the gate where a sport has rows)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr>
                    <th className={th}>sport</th><th className={th}>band</th>
                    <th className={th}>raw claimed center</th><th className={th}>delivered center</th><th className={th}>n</th><th className={th}>fitted</th>
                  </tr></thead>
                  <tbody>
                    {(cal.bandsRaw || []).map((b, i) => (
                      <tr key={i} className="border-t border-ink-850">
                        <td className={td}>{b.sport}</td>
                        <td className={`${td} font-mono`}>{b.band}</td>
                        <td className={`${td} font-mono`}>{b.claimed_center != null ? Number(b.claimed_center).toFixed(1) : '-'}</td>
                        <td className={`${td} font-mono`}>{b.calibrated_center != null ? Number(b.calibrated_center).toFixed(1) : '-'}</td>
                        <td className={`${td} font-mono ${Number(b.sample_n) < 25 ? 'text-signal-neg' : ''}`}>{b.sample_n ?? '-'}</td>
                        <td className={td}>{b.fitted_at ? new Date(b.fitted_at).toLocaleDateString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-ink-600 mt-1">Refit Mondays. A band with n under 25 (red) holds its prior value instead of trusting the fit. The pooled __all__ series is reference only, it never applies to a sport.</p>
            </div>
          )}

          <div>
            <div className="text-[11px] text-ink-300 font-semibold mb-1">Band calibration, claimed pp to delivered pp (legacy chain, sports without a raw fit)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr>
                  <th className={th}>sport</th><th className={th}>band</th>
                  <th className={th}>claimed center</th><th className={th}>calibrated center</th><th className={th}>n</th>
                </tr></thead>
                <tbody>
                  {(cal.bands || []).map((b, i) => (
                    <tr key={i} className="border-t border-ink-850">
                      <td className={td}>{b.sport}</td>
                      <td className={`${td} font-mono`}>{b.band}</td>
                      <td className={`${td} font-mono`}>{b.claimed_center != null ? Number(b.claimed_center).toFixed(1) : '-'}</td>
                      <td className={`${td} font-mono`}>{b.calibrated_center != null ? Number(b.calibrated_center).toFixed(1) : '-'}</td>
                      <td className={`${td} font-mono`}>{b.sample_n ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {(cal.weightChanges || []).length > 0 && (
            <div>
              <div className="text-[11px] text-ink-300 font-semibold mb-1">Weight change log, the learning loop's audit trail</div>
              <div className="space-y-2">
                {(cal.weightChanges || []).map((c, i) => (
                  <div key={i} className="border-t border-ink-850 pt-2">
                    <p className="text-xs text-ink-200">
                      <span className="font-mono text-ink-400">{c.changed_at ? new Date(c.changed_at).toLocaleDateString() : '-'}</span>
                      {' '}<span className="font-mono text-ink-100">{c.sport}</span>
                      {' · '}<span className="font-mono">{c.component}</span>
                      {' · '}<span className="text-ink-500">{c.source}</span>
                    </p>
                    <p className="text-[11px] text-ink-400 font-mono mt-0.5 break-all">
                      {JSON.stringify(c.before)} to {JSON.stringify(c.after)}
                    </p>
                    <p className="text-[11px] text-ink-500 mt-0.5">{c.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[11px] text-ink-300 font-semibold mb-1">Factor attribution, MLB since the process break (read only)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr>
                  <th className={th}>factor</th><th className={th}>games</th>
                  <th className={th}>avg impact pp</th><th className={th}>slope</th><th className={th}>read</th>
                </tr></thead>
                <tbody>
                  {(cal.factors || []).map((f) => (
                    <tr key={f.factor} className="border-t border-ink-850">
                      <td className={`${td} font-mono`}>{f.factor}</td>
                      <td className={`${td} font-mono`}>{f.games}</td>
                      <td className={`${td} font-mono`}>{f.avg_abs_impact_pp}</td>
                      <td className={`${td} font-mono`}>{f.slope}</td>
                      <td className="px-2 py-1.5 text-ink-400">{f.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-ink-600 mt-1">Slope near 1 is sized right, above 1 underweighted, near 0 priced in, negative anti-signal. Auto-nudge stage two targets 2026-09-07 within owner-approved bounds.</p>
          </div>

          <div>
            <div className="text-[11px] text-ink-300 font-semibold mb-1">The ladder</div>
            {(cal.ladder || []).map((l) => (
              <p key={l.tier} className="text-xs text-ink-300 py-0.5">
                <span className="font-mono text-ink-100">{l.tier}</span>
                <span className="text-ink-500"> · {l.rule}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminDashboard({ onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [period, setPeriod] = useState('all')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Admin auth is the caller's own Supabase session. The server checks
      // the JWT against its ADMIN_EMAILS allowlist. No shared secret.
      const { data: sessionData } = supabase
        ? await supabase.auth.getSession()
        : { data: { session: null } }
      const token = sessionData?.session?.access_token
      if (!token) {
        throw new Error('Sign in with an admin account to view this page')
      }
      const res = await fetch(`${API_BASE}/api/admin/dashboard?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message || body.error || `HTTP ${res.status}`)
      }
      const json = await res.json()
      setData(json)
      setLastRefresh(new Date())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return (
    <div className="min-h-screen bg-ink-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-ink-950 border-b border-ink-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandMark />
            {onBack && (
              <button
                onClick={onBack}
                className="text-ink-300 hover:text-white text-sm px-3 py-1.5 rounded-sharp bg-ink-900 hover:bg-ink-800 transition-colors"
              >
                Back
              </button>
            )}
            <div>
              <h1 className="text-white font-bold text-lg leading-none">Admin Dashboard</h1>
              <p className="text-ink-400 text-xs mt-0.5">
                {lastRefresh ? `Last refresh: ${lastRefresh.toLocaleTimeString()}` : 'Loading...'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SignOutButton />
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-ink-900 text-white text-sm px-3 py-2 rounded-sharp border border-ink-700"
            >
              <option value="all">All-time</option>
              <option value="last_30d">Last 30 days</option>
              <option value="last_7d">Last 7 days</option>
              <option value="last_3d">Last 3 days</option>
            </select>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 bg-signal-pos hover:bg-signal-pos disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2 rounded-sharp transition-colors"
            >
              {loading ? (
                <>
                  <span className="animate-spin inline-block w-3 h-3 border-2 border-ink-950 border-t-transparent rounded-full" />
                  Loading...
                </>
              ) : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="bg-red-950 border border-red-700 rounded-sharp p-4 text-signal-neg text-sm">
            <strong>Error loading dashboard:</strong> {error}
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="animate-spin w-10 h-10 border-4 border-signal-pos border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-ink-300 text-sm">Fetching admin data...</p>
            </div>
          </div>
        )}

        {data && (
          <>
            {/* Quick stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label="Cron Jobs Tracked"
                value={(data.cronHealth || []).length}
                color="blue"
              />
              <StatCard
                label="Recent Failures"
                value={data.recentErrors?.length ?? 0}
                color={data.recentErrors?.length > 0 ? 'red' : 'green'}
              />
              <StatCard
                label="Total AI Picks"
                value={(data.modelAccuracy?.overall?.total ?? 0).toLocaleString()}
                color="yellow"
              />
              <StatCard
                label="Machine Parlays"
                value={(data.houseParlays || []).length.toLocaleString()}
                sub="last 20 builds"
                color="purple"
              />
            </div>

            {/* System Health row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="lg:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <AgentReportsSection reports={data.agentReports} />
                <IntelFeedSection intel={data.intel} />
                <PipelineRunsSection runs={data.recentRuns} />
              </div>
              <div className="lg:col-span-2">
                <RecentAnalysesSection analyses={data.recentAnalyses} />
              </div>
              <CronHealthSection
                cronHealth={data.cronHealth}
                recentErrors={data.recentErrors}
              />
              <DataFreshnessSection dataFreshness={data.dataFreshness} />
            </div>

            {/* Upcoming games, every cell the tile is built from */}
            <UpcomingInspectorSection analyses={data.upcomingAnalyses} />

            {/* Model Performance. Graded era only, same population as the ledger */}
            <ModelPerformanceSection modelAccuracy={data.modelAccuracy} />

            {/* Inside the grade: multipliers, bands, factor attribution, ladder */}
            <CalibrationSection />

            {/* Recent Picks, the graded digest stream */}
            <RecentPicksSection recentPicks={data.recentPicks} />

            {/* Raw timestamp */}
            <p className="text-ink-700 text-xs text-center pb-4">
              Data fetched at {data.timestamp ? fmtDate(data.timestamp) : '-'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
