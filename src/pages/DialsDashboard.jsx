import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import BrandMark, { SignOutButton } from '../components/BrandMark'
import { API_BASE_URL as API_BASE } from '../config'

// The live dial board per market, read only. Everything on this page is
// a row the pipeline reads or wrote: the dial board, the multipliers,
// the band map, the rails, the last weight changes, and each read in the
// window traced in the Edge Anatomy order (anchor, factors, net, edges
// per market, sizing, pick, outcome). No control here writes anything:
// dials move only through sport_dials and model_weight_changes under the
// review protocol.

const MARKETS = ['MLB', 'NFL', 'NCAAF', 'NBA', 'NHL', 'NCAAB', 'EPL', 'MLS', 'Tennis', 'UFC', 'NFL_props']
const MARKET_LABEL = { NFL_props: 'NFL props' }

const pct = (p) => (p == null || !Number.isFinite(Number(p))) ? '-' : `${(Number(p) * 100).toFixed(2)}%`
const pp = (x, n = 2) => (x == null || !Number.isFinite(Number(x))) ? '-' : `${Number(x) >= 0 ? '+' : ''}${(Number(x) * 100).toFixed(n)}pp`
const ppRaw = (x, n = 2) => (x == null || !Number.isFinite(Number(x))) ? '-' : `${Number(x) >= 0 ? '+' : ''}${Number(x).toFixed(n)}pp`
const price = (o) => (o == null ? '-' : (Number(o) > 0 ? `+${o}` : String(o)))
const when = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-')
const sideName = (r, side) => (side === 'home_ml' || side === 'home_spread' ? r.home_team
  : side === 'away_ml' || side === 'away_spread' ? r.away_team
  : side === 'over' ? 'Over' : side === 'under' ? 'Under' : side || '-')

function tierClass(tier) {
  if (tier === 'Sharp Take' || tier === 'Strong Play') return 'bg-green-900 text-green-300 border-ink-700'
  if (tier === 'Play' || tier === 'Lean') return 'bg-signal-pos-dim text-signal-pos border-yellow-700'
  if (tier === 'Trap') return 'bg-signal-neg-dim text-signal-neg border-red-700'
  return 'bg-ink-800 text-ink-300 border-ink-600'
}
function Chip({ children, cls }) {
  return <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-mono border ${cls}`}>{children}</span>
}
function OutcomeChip({ outcome }) {
  const map = { won: 'bg-green-900 text-green-300 border-ink-700', lost: 'bg-signal-neg-dim text-signal-neg border-red-700', push: 'bg-signal-pos-dim text-signal-pos border-yellow-700', void: 'bg-ink-800 text-ink-400 border-ink-600', pending: 'bg-ink-800 text-ink-300 border-ink-600' }
  const k = outcome || 'pending'
  return <Chip cls={map[k] || map.pending}>{k}</Chip>
}
function Panel({ title, sub, children }) {
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
      <div className="text-xs text-ink-400 uppercase tracking-wider font-semibold">{title}</div>
      {sub && <p className="text-xs text-ink-500 mt-0.5 mb-3 leading-relaxed">{sub}</p>}
      {children}
    </div>
  )
}
const th = 'text-left text-ink-400 font-mono text-[10px] uppercase tracking-wider px-2 py-1.5 whitespace-nowrap'
const td = 'px-2 py-1.5 text-ink-200 align-top'
const tdn = 'px-2 py-1.5 text-ink-200 font-mono tabular-nums text-right whitespace-nowrap'

function DialBoard({ dials, rails, publish, sport }) {
  return (
    <Panel title={`Dial board · ${MARKET_LABEL[sport] || sport}`} sub="Sport row over the __all__ row. Read only here: a change is a sport_dials row plus a model_weight_changes row under the review protocol, never a control on this page.">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr><th className={th}>Dial</th><th className={`${th} text-right`}>Value</th><th className={th}>Scope</th><th className={th}>Changed</th></tr></thead>
            <tbody>
              {dials.map(d => (
                <tr key={d.dial} className="border-t border-ink-800">
                  <td className={`${td} font-mono`}>{d.dial}</td>
                  <td className={tdn}>{d.value}</td>
                  <td className={`${td} ${d.scope === sport ? 'text-signal-pos' : 'text-ink-400'}`}>{d.scope}</td>
                  <td className={`${td} text-ink-400 whitespace-nowrap`}>{when(d.updated_at)}</td>
                </tr>
              ))}
              {dials.length === 0 && <tr><td className={td} colSpan={4}>No dials on the board for this market.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-[10px] text-ink-400 uppercase tracking-wider font-mono mb-1">Publication</div>
            <div className="flex flex-wrap gap-1.5">
              {['ml', 'spread', 'total'].map(m => (
                <Chip key={m} cls={publish[m] === 1 ? 'bg-green-900 text-green-300 border-ink-700' : 'bg-ink-800 text-ink-400 border-ink-600'}>
                  {m} {publish[m] === 1 ? 'live' : publish[m] === 0 ? 'shadow' : 'default'}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-ink-400 uppercase tracking-wider font-mono mb-1">Rails, pp deductions</div>
            {rails.map(r => (
              <div key={r.dial} className="flex justify-between text-xs text-ink-200 font-mono border-t border-ink-800 py-1">
                <span>{r.dial}</span><span className="tabular-nums">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  )
}

function Sizing({ multipliers, bucketTargets, weightChanges }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Panel title="Sizing · multipliers and bucket floors" sub="The tier is the raw claim minus the price rails (directive 25). Multipliers are dials at 1 unless the sweep proves a sport should move; a mute is a publish dial at 0, never a multiplier. Each bucket must deliver its floor in pp over break even, or the Monday scorecard names it.">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr><th className={th}>Key</th><th className={`${th} text-right`}>Multiplier</th><th className={`${th} text-right`}>Measured k</th><th className={`${th} text-right`}>n</th><th className={th}>Source</th></tr></thead>
            <tbody>
              {multipliers.map(m => (
                <tr key={m.key} className="border-t border-ink-800">
                  <td className={`${td} font-mono`}>{m.key}</td>
                  <td className={`${tdn} ${Number(m.multiplier) === 0 ? 'text-signal-neg' : ''}`}>{Number(m.multiplier).toFixed(2)}</td>
                  <td className={tdn}>{m.measured_k ?? '-'}</td>
                  <td className={tdn}>{m.sample_n ?? '-'}</td>
                  <td className={`${td} text-ink-400 max-w-[28ch] truncate`} title={m.source || ''}>{m.source || '-'}</td>
                </tr>
              ))}
              {multipliers.length === 0 && <tr><td className={td} colSpan={5}>No multiplier rows: the sport runs its shadow model or the __global__ key.</td></tr>}
            </tbody>
          </table>
        </div>
        {bucketTargets.length > 0 && (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs">
              <thead><tr><th className={th}>Scope</th><th className={th}>Bucket</th><th className={`${th} text-right`}>Floor pp</th><th className={th}>Set</th></tr></thead>
              <tbody>
                {bucketTargets.map((b, i) => (
                  <tr key={i} className="border-t border-ink-800">
                    <td className={`${td} font-mono`}>{b.sport}</td>
                    <td className={td}>{b.band}</td>
                    <td className={tdn}>{Number(b.floor_pp).toFixed(1)}</td>
                    <td className={`${td} text-ink-400 whitespace-nowrap`}>{when(b.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Last weight changes for this market" sub="Every dial, multiplier or formula move with its evidence. The freeze (directive 21) allows only the listed sources through 2026-09-27.">
        <div className="space-y-2 max-h-[420px] overflow-y-auto">
          {weightChanges.map((w, i) => (
            <div key={i} className="border-t border-ink-800 pt-2">
              <div className="flex flex-wrap gap-2 items-baseline">
                <span className="font-mono text-xs text-white">{w.component}</span>
                <span className="font-mono text-[10px] text-ink-400">{w.sport} · {w.source} · {when(w.changed_at)}</span>
              </div>
              <p className="text-xs text-ink-300 mt-1 leading-relaxed">{w.reason}</p>
            </div>
          ))}
          {weightChanges.length === 0 && <p className="text-xs text-ink-400">No weight changes recorded for this market.</p>}
        </div>
      </Panel>
    </div>
  )
}

function ReadCard({ r }) {
  const f = r.edge_factors || {}
  const adjustments = Array.isArray(f.adjustments) ? f.adjustments : []
  const anchor = r.implied_home_prob != null ? Number(r.implied_home_prob) : null
  let running = anchor
  const rows = adjustments.map(a => {
    const impact = Number(a.impact) || 0
    if (running != null) running += impact
    return { ...a, impact, running }
  })
  const raw = r.edges_raw || {}
  const cal = r.edges || {}
  const pick = (r.picks || []).find(p => !/auto_digest_(alt|leg)_/.test(p.session_id) && p.tier !== 'Trap' && p.tier !== 'Leg')
  const legs = (r.picks || []).filter(p => p.tier === 'Leg')
  const traps = (r.picks || []).filter(p => p.tier === 'Trap')
  const shadow = (r.shadow || []).find(s => s.side === r.recommended_side) || null
  const score = (r.shadow || []).find(s => s.home_score != null)
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline">
      <div className="px-4 py-3 border-b border-ink-800 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-white font-semibold">{r.away_team} at {r.home_team}</span>
        <span className="text-ink-400 text-xs">{when(r.game_date)} · v{r.analysis_version} · {r.model_used || '-'}</span>
        {f.marketAnchored != null && <Chip cls="bg-ink-800 text-sky-300 border-ink-600">anchor: {f.marketAnchored ? (f.anchorSource || 'market') : 'record blend'}</Chip>}
        {pick ? <Chip cls={tierClass(pick.tier)}>{pick.tier} · {pick.pick} · {ppRaw(pick.edge_pp)}</Chip> : <Chip cls="bg-ink-800 text-ink-400 border-ink-600">no pick published</Chip>}
        {pick && <OutcomeChip outcome={pick.actual_outcome} />}
        {score && <span className="font-mono text-xs text-ink-300">final {score.away_score} to {score.home_score}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr><th className={th}>Stage</th><th className={th}>Input</th><th className={`${th} text-right`}>Move</th><th className={`${th} text-right`}>Running home</th></tr></thead>
          <tbody>
            <tr className="border-t border-ink-800"><td className={`${td} font-mono text-sky-300`}>1 anchor</td><td className={td}>Market home win probability{f.anchorSource ? ` (${f.anchorSource})` : ''}</td><td className={tdn}></td><td className={tdn}>{pct(anchor)}</td></tr>
            {rows.map((a, i) => (
              <tr key={i} className="border-t border-ink-800">
                <td className={`${td} font-mono text-sky-300`}>2 factor</td>
                <td className={td}>{a.factor}{a.detail ? <span className="block text-ink-400">{a.detail}</span> : null}</td>
                <td className={`${tdn} ${a.impact > 0 ? 'text-green-300' : a.impact < 0 ? 'text-signal-neg' : 'text-ink-400'}`}>{pp(a.impact)}</td>
                <td className={tdn}>{pct(a.running)}</td>
              </tr>
            ))}
            <tr className="border-t border-ink-800 bg-ink-950/40"><td className={`${td} font-mono text-sky-300`}>2 net</td><td className={td}>Model home win probability after the stack and the cap</td><td className={`${tdn}`}>{anchor != null && r.calc_home_prob != null ? pp(Number(r.calc_home_prob) - anchor) : '-'}</td><td className={tdn}>{pct(r.calc_home_prob)}</td></tr>
            {['home_ml', 'away_ml', 'home_spread', 'away_spread', 'over', 'under'].filter(k => raw[k] != null && Number(raw[k]) > 0).map(k => (
              <tr key={k} className="border-t border-ink-800">
                <td className={`${td} font-mono text-sky-300`}>3 to 4</td>
                <td className={td}>{sideName(r, k)} <span className="text-ink-400">{k.replace('_', ' ')}</span></td>
                <td className={tdn}>{ppRaw(Number(raw[k]) * 100)} raw</td>
                <td className={tdn}>{cal[k] != null ? `${ppRaw(Number(cal[k]) * 100)} sized` : '-'}</td>
              </tr>
            ))}
            <tr className="border-t border-ink-800 bg-ink-950/40">
              <td className={`${td} font-mono text-sky-300`}>5 to 6</td>
              <td className={td}>Recommended: {r.recommended_pick || 'none'}{shadow ? <span className="block text-ink-400">shadow grade on that side: {shadow.outcome || 'pending'}{shadow.price_clv_pp != null ? `, closing line value ${ppRaw(shadow.price_clv_pp)}` : ''}{shadow.close_price != null ? `, closed ${price(shadow.close_price)}` : ''}</span> : null}</td>
              <td className={tdn}>{r.recommended_odds != null ? price(r.recommended_odds) : ''}</td>
              <td className={tdn}>{pick ? pick.tier : 'Skip'}</td>
            </tr>
            {(legs.length > 0 || traps.length > 0) && (
              <tr className="border-t border-ink-800"><td className={`${td} font-mono text-sky-300`}>also</td><td className={td} colSpan={3}>
                {legs.map(l => <span key={l.id} className="mr-3">Leg {l.pick} <OutcomeChip outcome={l.actual_outcome} /></span>)}
                {traps.map(t => <span key={t.id} className="mr-3">Trap {t.pick} <OutcomeChip outcome={t.actual_outcome} /></span>)}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {f.injuryReport && (
        <details className="border-t border-ink-800">
          <summary className="px-4 py-2 text-[11px] font-mono text-ink-400 cursor-pointer hover:text-white">Injury report the read was priced on</summary>
          <div className="px-4 pb-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {['home', 'away'].map(side => (
              <div key={side}>
                <div className="text-ink-400 font-mono text-[10px] uppercase mb-1">{side === 'home' ? r.home_team : r.away_team}</div>
                {(f.injuryReport[side] || []).length === 0 ? <div className="text-ink-500">none listed</div>
                  : (f.injuryReport[side] || []).map((l, i) => <div key={i} className="text-ink-200">{l.player} <span className="text-ink-400">{l.position}, {l.status}</span></div>)}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function PropRows({ reads }) {
  return (
    <Panel title="Prop reads in the window" sub="v1 is the frozen read (player log alone). v2 is the shadow candidate (opponent allowance, team implied points, wind, availability). Both grade against the same stat line. Nothing publishes.">
      <div className="overflow-x-auto max-h-[640px]">
        <table className="w-full text-xs">
          <thead><tr><th className={th}>Kick</th><th className={th}>Player</th><th className={th}>Market</th><th className={`${th} text-right`}>Line</th><th className={th}>v1</th><th className={`${th} text-right`}>v1 pp</th><th className={th}>v1 result</th><th className={th}>v2</th><th className={`${th} text-right`}>v2 pp</th><th className={th}>v2 result</th><th className={`${th} text-right`}>Actual</th></tr></thead>
          <tbody>
            {reads.map(p => (
              <tr key={p.id} className="border-t border-ink-800">
                <td className={`${td} text-ink-400 whitespace-nowrap`}>{when(p.commence_time)}</td>
                <td className={`${td} whitespace-nowrap`}>{p.player_name}</td>
                <td className={`${td} font-mono text-ink-400`}>{p.market.replace('player_', '')}</td>
                <td className={tdn}>{p.line}</td>
                <td className={td}><Chip cls={tierClass(p.tier)}>{p.side} · {p.tier}</Chip></td>
                <td className={tdn}>{Number(p.edge_pp).toFixed(1)}</td>
                <td className={td}><OutcomeChip outcome={p.actual_outcome} /></td>
                <td className={td}>{p.v2_side ? <Chip cls={tierClass(p.v2_tier)}>{p.v2_side} · {p.v2_tier}</Chip> : <span className="text-ink-500">{p.v2_factors?.skipped || '-'}</span>}</td>
                <td className={tdn}>{p.v2_edge_pp != null ? Number(p.v2_edge_pp).toFixed(1) : '-'}</td>
                <td className={td}>{p.v2_side ? <OutcomeChip outcome={p.v2_outcome} /> : ''}</td>
                <td className={tdn}>{p.actual_value ?? '-'}</td>
              </tr>
            ))}
            {reads.length === 0 && <tr><td className={td} colSpan={11}>No prop reads in the window.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

export default function DialsDashboard({ onBack }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const sport = MARKETS.includes(params.get('sport')) ? params.get('sport') : 'MLB'
  const days = Math.max(1, Math.min(14, parseInt(params.get('days'), 10) || 2))
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: sessionData } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
      const token = sessionData?.session?.access_token
      if (!token) throw new Error('Sign in with an admin account to view this page')
      const res = await fetch(`${API_BASE}/api/admin/dials?sport=${encodeURIComponent(sport)}&days=${days}`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.status === 403) throw new Error('This account is not on the admin list')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [sport, days])

  useEffect(() => { fetchData() }, [fetchData])

  const pick = (s) => setParams({ sport: s, days: String(days) })

  return (
    <div className="min-h-screen bg-ink-950 text-white">
      <div className="sticky top-0 z-40 bg-ink-950 border-b border-ink-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BrandMark />
            <button onClick={() => (onBack ? onBack() : navigate('/admin'))} className="text-ink-300 hover:text-white text-sm px-3 py-1.5 rounded-sharp bg-ink-900 hover:bg-ink-800 transition-colors">Admin</button>
            <div>
              <h1 className="text-white font-bold text-lg leading-none">Live dials</h1>
              <p className="text-ink-400 text-xs mt-0.5">{data?.fetched_at ? `Read at ${new Date(data.fetched_at).toLocaleTimeString()}` : 'Loading'} · read only</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SignOutButton />
            <select value={days} onChange={(e) => setParams({ sport, days: e.target.value })} className="bg-ink-900 text-white text-sm px-3 py-2 rounded-sharp border border-ink-700">
              <option value="1">Last day + next 3</option>
              <option value="2">Last 2 days + next 3</option>
              <option value="7">Last week + next 3</option>
              <option value="14">Last 2 weeks + next 3</option>
            </select>
            <button onClick={fetchData} disabled={loading} className="bg-signal-pos disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2 rounded-sharp">{loading ? 'Loading' : 'Refresh'}</button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap gap-1.5">
          {MARKETS.map(m => (
            <button key={m} onClick={() => pick(m)} className={`font-mono text-xs px-3 py-1.5 rounded-sharp border ${m === sport ? 'bg-signal-pos text-ink-950 border-signal-pos' : 'bg-ink-900 text-ink-300 border-ink-700 hover:text-white'}`}>{MARKET_LABEL[m] || m}</button>
          ))}
        </div>

        {error && <div className="bg-red-950 border border-red-700 rounded-sharp p-4 text-signal-neg text-sm">{error}</div>}
        {loading && !data && <p className="text-ink-300 text-sm">Reading the board</p>}

        {data && !error && (
          <>
            <DialBoard dials={data.dials || []} rails={data.rails || []} publish={data.publish || {}} sport={sport} />
            <Sizing multipliers={data.multipliers || []} bucketTargets={data.bucketTargets || []} weightChanges={data.weightChanges || []} />
            {sport === 'NFL_props' ? <PropRows reads={data.propReads || []} /> : (
              <div className="space-y-4">
                <div className="text-xs text-ink-400 uppercase tracking-wider font-semibold">Reads in the window · {(data.reads || []).length}</div>
                {(data.reads || []).map(r => <ReadCard key={r.id} r={r} />)}
                {(data.reads || []).length === 0 && <p className="text-xs text-ink-400">No reads in the window for this market.</p>}
              </div>
            )}
            {data.errors?.length > 0 && <p className="text-xs text-signal-neg">Partial: {data.errors.join(' · ')}</p>}
          </>
        )}
      </div>
    </div>
  )
}
