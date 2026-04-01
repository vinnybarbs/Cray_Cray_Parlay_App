import React, { useState, useEffect, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://craycrayparlayapp-production.up.railway.app'
const ADMIN_SECRET = 'admin123'

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
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

function winRate(won, lost) {
  const settled = won + lost
  if (settled === 0) return null
  return Math.round((won / settled) * 100)
}

function freshnessColor(ts) {
  if (!ts) return 'text-red-400'
  const hrs = (Date.now() - new Date(ts).getTime()) / 3600000
  if (hrs < 4) return 'text-green-400'
  if (hrs < 12) return 'text-yellow-400'
  return 'text-red-400'
}

function freshnessLabel(ts) {
  if (!ts) return 'No data'
  const hrs = (Date.now() - new Date(ts).getTime()) / 3600000
  if (hrs < 4) return 'Fresh'
  if (hrs < 12) return 'Stale'
  return 'Very stale'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, sub }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
    </div>
  )
}

function StatCard({ label, value, sub, color = 'yellow' }) {
  const colors = {
    yellow: 'from-yellow-500 to-orange-500',
    green: 'from-green-500 to-emerald-500',
    red: 'from-red-500 to-pink-500',
    blue: 'from-blue-500 to-cyan-500',
    gray: 'from-gray-400 to-gray-500',
    purple: 'from-purple-500 to-indigo-500',
  }
  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <p className="text-gray-400 text-xs uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 bg-gradient-to-r ${colors[color]} bg-clip-text text-transparent`}>
        {value}
      </p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  )
}

function StatusDot({ status }) {
  const isOk = status === 'success' || status === 'completed' || status === 'ok'
  const isWarn = status === 'warning' || status === 'skipped'
  const isFail = status === 'failed' || status === 'error'
  const cls = isOk ? 'bg-green-500' : isWarn ? 'bg-yellow-500' : isFail ? 'bg-red-500' : 'bg-gray-500'
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} flex-shrink-0`} />
}

function OutcomeChip({ outcome }) {
  const map = {
    won: 'bg-green-900 text-green-300 border-green-700',
    lost: 'bg-red-900 text-red-300 border-red-700',
    push: 'bg-yellow-900 text-yellow-300 border-yellow-700',
    pending: 'bg-gray-700 text-gray-400 border-gray-600',
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
  if (total === 0) return <span className="text-gray-500 text-xs">No settled picks</span>
  const pct = Math.round((won / total) * 100)
  const barColor = pct >= 55 ? 'bg-green-500' : pct >= 45 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-700 rounded-full h-2">
        <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-white text-xs font-bold w-8 text-right">{pct}%</span>
    </div>
  )
}

// ─── Sections ─────────────────────────────────────────────────────────────────

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
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
      <SectionHeader title="Cron Job Health" sub={`${jobs.length} jobs tracked via pg_cron`} />
      {jobs.length === 0 ? (
        <p className="text-gray-500 text-sm">No cron jobs found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs uppercase border-b border-gray-700">
                <th className="text-left pb-2 pr-4">Job</th>
                <th className="text-left pb-2 pr-4">Schedule</th>
                <th className="text-left pb-2 pr-4">Status</th>
                <th className="text-left pb-2">Last Run</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.job_name} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="py-2 pr-4 text-gray-300 font-mono text-xs">{job.job_name}</td>
                  <td className="py-2 pr-4 text-gray-500 font-mono text-xs">{job.schedule || '—'}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <StatusDot status={job.status} />
                      <span className="text-gray-400 text-xs capitalize">{job.status}</span>
                    </div>
                  </td>
                  <td className="py-2 text-gray-500 text-xs">{timeAgo(job.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recentErrors && recentErrors.length > 0 && (
        <div className="mt-5">
          <p className="text-red-400 text-xs font-semibold uppercase tracking-wide mb-3">Recent Failures ({recentErrors.length})</p>
          <div className="space-y-2">
            {recentErrors.map((err, i) => (
              <div key={i} className="bg-red-950/40 border border-red-800/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-red-300 font-mono text-xs">{err.job_name}</span>
                  <span className="text-gray-500 text-xs">{timeAgo(err.created_at)}</span>
                </div>
                {err.details && (
                  <p className="text-gray-400 text-xs mt-1 line-clamp-2">
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
  const tables = ['news_cache', 'news_articles', 'odds_cache', 'game_results', 'game_analysis']
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
      <SectionHeader title="Data Freshness" sub="Key tables — count and most recent record" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tables.map((table) => {
          const d = dataFreshness?.[table]
          const ts = d?.maxTimestamp
          const count = d?.count
          const colorCls = freshnessColor(ts)
          const label = freshnessLabel(ts)
          return (
            <div key={table} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
              <p className="text-gray-400 text-xs font-mono mb-1">{table}</p>
              <p className={`text-sm font-semibold ${colorCls}`}>{label}</p>
              <p className="text-gray-500 text-xs mt-1">
                {count !== null && count !== undefined ? `${count.toLocaleString()} rows` : 'Count unavailable'}
              </p>
              <p className="text-gray-600 text-xs">{ts ? timeAgo(ts) : 'No timestamp found'}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ModelPerformanceSection({ modelAccuracy }) {
  const { overall, bySport, byBetType } = modelAccuracy || {}
  const { won = 0, lost = 0, push = 0, pending = 0, total = 0 } = overall || {}
  const wr = winRate(won, lost)

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
      <SectionHeader title="Model Performance" sub="Based on settled ai_suggestions" />

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
          <p className="text-gray-400 text-xs mb-2">Overall Win Rate</p>
          <WinRateBar won={won} lost={lost} />
        </div>
      )}

      {/* By sport */}
      {bySport && Object.keys(bySport).length > 0 && (
        <div className="mb-5">
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-3">By Sport</p>
          <div className="space-y-2">
            {Object.entries(bySport)
              .sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost))
              .map(([sport, counts]) => {
                const wr = winRate(counts.won || 0, counts.lost || 0)
                return (
                  <div key={sport} className="flex items-center gap-3">
                    <span className="text-gray-300 text-xs w-24 flex-shrink-0 capitalize">{sport}</span>
                    <div className="flex-1">
                      <WinRateBar won={counts.won || 0} lost={counts.lost || 0} />
                    </div>
                    <span className="text-gray-500 text-xs w-20 text-right flex-shrink-0">
                      {counts.won || 0}W / {counts.lost || 0}L
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* By bet type */}
      {byBetType && Object.keys(byBetType).length > 0 && (
        <div>
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-3">By Bet Type</p>
          <div className="space-y-2">
            {Object.entries(byBetType)
              .sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost))
              .map(([betType, counts]) => (
                <div key={betType} className="flex items-center gap-3">
                  <span className="text-gray-300 text-xs w-24 flex-shrink-0 capitalize">{betType}</span>
                  <div className="flex-1">
                    <WinRateBar won={counts.won || 0} lost={counts.lost || 0} />
                  </div>
                  <span className="text-gray-500 text-xs w-20 text-right flex-shrink-0">
                    {counts.won || 0}W / {counts.lost || 0}L
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RecentPicksSection({ recentPicks }) {
  const [expanded, setExpanded] = useState(null)

  if (!recentPicks || recentPicks.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
        <SectionHeader title="Recent Picks" />
        <p className="text-gray-500 text-sm">No picks found.</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
      <SectionHeader title="Recent Picks" sub="Last 15 ai_suggestions" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs uppercase border-b border-gray-700">
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
                    className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : i)}
                  >
                    <td className="py-2 pr-3">
                      <span className="text-gray-300 text-xs capitalize">{pick.sport || '—'}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <div>
                        <p className="text-white text-xs font-medium line-clamp-1">{pick.pick || '—'}</p>
                        {pick.game && <p className="text-gray-500 text-xs line-clamp-1">{pick.game}</p>}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="text-gray-400 text-xs capitalize">{pick.bet_type || '—'}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {pick.confidence != null ? (
                        <span className="text-yellow-400 text-xs font-bold">{pick.confidence}/10</span>
                      ) : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      <OutcomeChip outcome={pick.actual_outcome} />
                    </td>
                    <td className="py-2 text-gray-500 text-xs">{timeAgo(pick.created_at)}</td>
                  </tr>
                  {isOpen && shortReason && (
                    <tr className="bg-gray-800/40">
                      <td colSpan={6} className="px-3 py-2 text-gray-400 text-xs italic">
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

function ConfidenceCalibrationSection({ calibration }) {
  if (!calibration || calibration.length === 0) return null
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <SectionHeader title="Confidence Calibration" sub="Is the model honest about how sure it is?" />
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mt-4">
        {calibration.map(b => {
          const isCalibrated = Math.abs(b.winPct - (b.confidence * 10)) < 15
          return (
            <div key={b.confidence} className="bg-gray-900 rounded-lg p-3 text-center border border-gray-700">
              <div className="text-2xl font-bold text-yellow-400">{b.confidence}/10</div>
              <div className={`text-lg font-bold mt-1 ${b.winPct >= 65 ? 'text-green-400' : b.winPct >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                {b.winPct}%
              </div>
              <div className="text-xs text-gray-500 mt-1">{b.won}W-{b.lost}L ({b.total})</div>
              <div className="mt-2 w-full bg-gray-700 rounded-full h-2">
                <div className={`h-2 rounded-full ${b.winPct >= 65 ? 'bg-green-500' : b.winPct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${b.winPct}%` }} />
              </div>
              <div className="text-[10px] mt-1 text-gray-600">
                {isCalibrated ? '✓ calibrated' : b.winPct > b.confidence * 10 ? '↑ underconfident' : '↓ overconfident'}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-gray-500 mt-3">
        Ideal: a 7/10 confidence pick should win ~70% of the time. If 8/10 picks only win 60%, the model is overconfident at that level.
      </p>
    </div>
  )
}

function SettlementSection({ settlementStatus }) {
  const { parlaysByStatus = {}, legsByOutcome = {} } = settlementStatus || {}

  const parlayEntries = Object.entries(parlaysByStatus).sort((a, b) => b[1] - a[1])
  const legEntries = Object.entries(legsByOutcome).sort((a, b) => b[1] - a[1])
  const totalParlays = parlayEntries.reduce((s, [, v]) => s + v, 0)
  const totalLegs = legEntries.reduce((s, [, v]) => s + v, 0)

  const statusColors = {
    won: 'bg-green-500',
    lost: 'bg-red-500',
    push: 'bg-yellow-500',
    pending: 'bg-gray-500',
    settled: 'bg-blue-500',
    active: 'bg-cyan-500',
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
      <SectionHeader title="Settlement Monitor" sub="Parlay and leg status breakdown" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Parlays */}
        <div>
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-3">Parlays by Status ({totalParlays.toLocaleString()} total)</p>
          {parlayEntries.length === 0 ? (
            <p className="text-gray-500 text-sm">No parlays found.</p>
          ) : (
            <div className="space-y-2">
              {parlayEntries.map(([status, count]) => {
                const pct = totalParlays > 0 ? Math.round((count / totalParlays) * 100) : 0
                const barCls = statusColors[status] || 'bg-gray-500'
                return (
                  <div key={status}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300 capitalize">{status}</span>
                      <span className="text-gray-400">{count} ({pct}%)</span>
                    </div>
                    <div className="bg-gray-700 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${barCls}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Legs */}
        <div>
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-3">Parlay Legs by Outcome ({totalLegs.toLocaleString()} total)</p>
          {legEntries.length === 0 ? (
            <p className="text-gray-500 text-sm">No leg data found.</p>
          ) : (
            <div className="space-y-2">
              {legEntries.map(([outcome, count]) => {
                const pct = totalLegs > 0 ? Math.round((count / totalLegs) * 100) : 0
                const barCls = statusColors[outcome] || 'bg-gray-500'
                return (
                  <div key={outcome}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300 capitalize">{outcome}</span>
                      <span className="text-gray-400">{count} ({pct}%)</span>
                    </div>
                    <div className="bg-gray-700 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${barCls}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminDashboard({ onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/admin/dashboard?secret=${ADMIN_SECRET}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const json = await res.json()
      setData(json)
      setLastRefresh(new Date())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
              >
                Back
              </button>
            )}
            <div>
              <h1 className="text-white font-bold text-lg leading-none">Admin Dashboard</h1>
              <p className="text-gray-500 text-xs mt-0.5">
                {lastRefresh ? `Last refresh: ${lastRefresh.toLocaleTimeString()}` : 'Loading...'}
              </p>
            </div>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-gray-900 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {loading ? (
              <>
                <span className="animate-spin inline-block w-3 h-3 border-2 border-gray-900 border-t-transparent rounded-full" />
                Loading...
              </>
            ) : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="bg-red-950 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
            <strong>Error loading dashboard:</strong> {error}
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="animate-spin w-10 h-10 border-4 border-yellow-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-400 text-sm">Fetching admin data...</p>
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
                label="Total Parlays"
                value={Object.values(data.settlementStatus?.parlaysByStatus || {}).reduce((s, v) => s + v, 0).toLocaleString()}
                color="purple"
              />
            </div>

            {/* System Health row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CronHealthSection
                cronHealth={data.cronHealth}
                recentErrors={data.recentErrors}
              />
              <DataFreshnessSection dataFreshness={data.dataFreshness} />
            </div>

            {/* Model Performance */}
            <ModelPerformanceSection modelAccuracy={data.modelAccuracy} />

            {/* Recent Picks */}
            <RecentPicksSection recentPicks={data.recentPicks} />

            {/* Confidence Calibration */}
            <ConfidenceCalibrationSection calibration={data.confidenceCalibration} />

            {/* Settlement Monitor */}
            <SettlementSection settlementStatus={data.settlementStatus} />

            {/* Raw timestamp */}
            <p className="text-gray-700 text-xs text-center pb-4">
              Data fetched at {data.timestamp ? fmtDate(data.timestamp) : '—'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
