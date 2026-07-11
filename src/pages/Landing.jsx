import React, { useEffect, useState } from 'react'

// API_BASE matches the rest of the app — Railway in prod, env override locally.
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://craycrayparlayapp-production.up.railway.app'

// ─── Landing — public marketing surface ────────────────────────────────────
// Concept: "Trading terminal as marketing page." Bloomberg-severity layout
// reframes every section as a terminal artifact — ticker, scorecard, execution
// flow, disclosure, term sheet, filings. Sharp-Quant tokens only; no new
// colors or fonts. Hero copy is the locked villain frame (2026-05-12).

const TERMINAL_CSS = `
@keyframes ticker-scroll {
  0% { transform: translate3d(0,0,0); }
  100% { transform: translate3d(-50%,0,0); }
}
@keyframes hairline-draw {
  0% { transform: scaleX(0); transform-origin: left; }
  100% { transform: scaleX(1); transform-origin: left; }
}
@keyframes signal-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
.ticker-track { animation: ticker-scroll 80s linear infinite; }
.signal-dot { animation: signal-pulse 2.4s ease-in-out infinite; }
.grid-bg {
  background-image:
    linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px);
  background-size: 56px 56px;
}
.scanline-bg {
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 3px,
    rgba(255,255,255,0.008) 3px,
    rgba(255,255,255,0.008) 4px
  );
}
`

export default function Landing({ onStartTrial, onSignIn }) {
  const [stats, setStats] = useState(null)
  const [tierStats, setTierStats] = useState(null)
  const [sportStats, setSportStats] = useState(null)

  // Fetch via /api/public-stats so anon visitors can see the Track Record.
  // Direct supabase-js read was blocked by RLS on mv_model_accuracy (the
  // backend uses the service-role key to bypass RLS while keeping the
  // underlying table locked down). 2026-05-12 fix.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public-stats`)
        if (!res.ok) return
        const json = await res.json()
        if (cancelled) return
        if (json.overall) setStats(json.overall)
        if (Array.isArray(json.tiers) && json.tiers.length > 0) setTierStats(json.tiers)
        if (Array.isArray(json.bySport) && json.bySport.length > 0) setSportStats(json.bySport)
      } catch (err) {
        // Soft-fail: section renders its empty/loading state instead.
        if (!cancelled) console.warn('public-stats fetch failed', err)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const scrollTo = (id) => () => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100 font-mono antialiased">
      <style>{TERMINAL_CSS}</style>
      <Ticker />
      <Nav onStartTrial={onStartTrial} onSignIn={onSignIn} scrollTo={scrollTo} />
      <Hero stats={stats} onStartTrial={onStartTrial} onSignIn={onSignIn} onSeePick={scrollTo('snapshot')} />
      <EdgeScorecard />
      <ExecutionFlow />
      <SnapshotTerminal tierStats={tierStats} />
      <TrackRecord sportStats={sportStats} tierStats={tierStats} />
      <Disclosure />
      <TermSheet onStartTrial={onStartTrial} />
      <Filings />
      <Footer />
    </div>
  )
}

// ─── Ticker — top scrolling edge feed ──────────────────────────────────────
// Real edges from /api/public-ticker (the old hardcoded demo array showed
// NBA/NFL numbers in July — instant credibility killer for anyone who knows
// sports). Off-season leagues scroll as coverage entries instead: covering
// every league is the differentiator when most edge tools do one or two.

const COVERED_LEAGUES = [
  { key: 'MLB',    returns: 'Mar' },
  { key: 'NBA',    returns: 'Oct' },
  { key: 'NFL',    returns: 'Sept' },
  { key: 'NHL',    returns: 'Oct' },
  { key: 'NCAAB',  returns: 'Nov' },
  { key: 'NCAAF',  returns: 'Aug' },
  { key: 'MLS',    returns: 'Feb' },
  { key: 'EPL',    returns: 'Aug' },
  { key: 'Tennis', returns: 'Jan' },
  { key: 'UFC',    returns: 'Jan' },
]

function Ticker() {
  const [feed, setFeed] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public-ticker`)
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled) setFeed(json)
      } catch { /* coverage-only fallback renders */ }
    })()
    return () => { cancelled = true }
  }, [])

  const liveItems = (feed?.items || []).map(it => ({
    kind: 'edge',
    side: it.pp >= 0 ? '▲' : '▼',
    pp: `${it.pp >= 0 ? '+' : '−'}${Math.abs(it.pp).toFixed(1)}`,
    label: `${it.sport} · ${it.label}`,
    tone: it.pp >= 0 ? 'pos' : 'neg',
  }))

  const inSeason = new Set(feed?.inSeason || [])
  const coverageItems = COVERED_LEAGUES
    .filter(l => !liveItems.some(it => it.label.startsWith(`${l.key} ·`)))
    .map(l => ({
      kind: 'coverage',
      label: inSeason.has(l.key) ? `${l.key} · in season · on the board` : `${l.key} · covered · back ${l.returns}`,
    }))

  // Live edges first, coverage entries woven after. With no live data at all
  // the reel is coverage-only — never invented numbers.
  const items = [...liveItems, ...coverageItems]
  const row = [...items, ...items] // doubled for seamless loop
  const headline = liveItems.length > 0 ? 'Live edges · today' : `${COVERED_LEAGUES.length} leagues · one board`

  return (
    <div className="bg-ink-950 border-b border-ink-800 overflow-hidden relative">
      <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-ink-950 to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-ink-950 to-transparent z-10 pointer-events-none" />
      <div className="absolute top-1.5 left-3 flex items-center gap-2 z-20 bg-ink-950 pr-3">
        <span className="signal-dot inline-block w-1.5 h-1.5 rounded-full bg-signal-pos" />
        <span className="text-[9px] uppercase tracking-[0.20em] text-ink-400">{headline}</span>
      </div>
      <div className="flex whitespace-nowrap py-1.5 pt-7 ticker-track">
        {row.map((it, i) => (
          it.kind === 'edge' ? (
            <span key={i} className="inline-flex items-center gap-2 px-6 text-[11px] tabular-nums">
              <span className={it.tone === 'pos' ? 'text-signal-pos' : 'text-signal-neg'}>{it.side}</span>
              <span className={`font-semibold ${it.tone === 'pos' ? 'text-signal-pos' : 'text-signal-neg'}`}>{it.pp}pp</span>
              <span className="text-ink-300">{it.label}</span>
              <span className="text-ink-700">│</span>
            </span>
          ) : (
            <span key={i} className="inline-flex items-center gap-2 px-6 text-[11px]">
              <span className="text-ink-500 uppercase tracking-[0.08em]">{it.label}</span>
              <span className="text-ink-700">│</span>
            </span>
          )
        ))}
      </div>
    </div>
  )
}

// ─── Nav ───────────────────────────────────────────────────────────────────

function Nav({ onStartTrial, onSignIn, scrollTo }) {
  return (
    <header className="sticky top-0 z-30 bg-ink-950/90 backdrop-blur-md border-b border-ink-800">
      <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
        <button onClick={scrollTo('top')} className="flex items-baseline gap-2 group">
          <span className="text-sm font-bold uppercase tracking-[0.18em] text-ink-100 group-hover:text-signal-pos transition-colors">
            Cray Cray
          </span>
          <span className="text-[9px] uppercase tracking-[0.24em] text-signal-pos">
            ▌ for parlays
          </span>
        </button>
        <nav className="flex items-center gap-1 md:gap-5">
          <button onClick={scrollTo('flow')} className="hidden md:block text-[10px] uppercase tracking-[0.18em] text-ink-400 hover:text-ink-100 transition-colors">
            How
          </button>
          <button onClick={scrollTo('track')} className="hidden md:block text-[10px] uppercase tracking-[0.18em] text-ink-400 hover:text-ink-100 transition-colors">
            Track record
          </button>
          <button onClick={scrollTo('terms')} className="hidden md:block text-[10px] uppercase tracking-[0.18em] text-ink-400 hover:text-ink-100 transition-colors">
            Pricing
          </button>
          {/* Sign in — separate from Start trial so returning users don't have to
              parse a trial CTA when they just want to log in. Both routes hit the
              same Auth modal which handles signup + signin flows. */}
          <button
            onClick={onSignIn}
            className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-100 hover:text-signal-pos transition-colors px-2 py-1.5"
          >
            Sign in
          </button>
          <button
            onClick={onStartTrial}
            className="text-[10px] font-bold uppercase tracking-[0.18em] bg-signal-pos text-ink-950 px-3 py-1.5 rounded-sharp hover:bg-signal-pos/90 transition-colors"
          >
            [ Start trial ]
          </button>
        </nav>
      </div>
    </header>
  )
}

// ─── Hero ──────────────────────────────────────────────────────────────────

function Hero({ stats, onStartTrial, onSignIn, onSeePick }) {
  const hitRateDisplay = stats?.hitRate != null ? `${stats.hitRate}%` : '—'
  const weeklyCount = stats?.total != null ? stats.total.toLocaleString() : '1,000+'

  return (
    <section id="top" className="relative grid-bg border-b border-ink-800 overflow-hidden">
      <div className="scanline-bg absolute inset-0 pointer-events-none" />
      <div className="relative max-w-6xl mx-auto px-5 pt-16 pb-20 md:pt-24 md:pb-28 grid md:grid-cols-12 gap-10 md:gap-12 items-center">

        {/* LEFT: copy stack */}
        <div className="md:col-span-7">
          <SectionLabel>$ ./edge --today</SectionLabel>

          <h1 className="font-sans font-bold text-[2.5rem] md:text-[4.25rem] leading-[0.95] tracking-[-0.025em] text-ink-100 mt-5">
            Your book won't tell you<br />
            which side is <span className="italic text-ink-300">the trap.</span>
            <span className="block mt-2 text-signal-pos">
              <span className="text-ink-700">▌</span> We will.
            </span>
          </h1>

          <p className="mt-8 text-ink-300 text-base leading-relaxed max-w-xl">
            <span className="text-ink-100 font-medium">Math-graded picks</span> for every game.
            Per-side edges in plus/minus points. <span className="text-signal-pos">Including the negative ones.</span>
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-3">
            <button
              onClick={onStartTrial}
              className="group inline-flex items-center justify-center gap-3 bg-signal-pos text-ink-950 text-xs font-bold uppercase tracking-[0.18em] px-6 py-4 rounded-sharp hover:bg-signal-pos/90 transition-colors"
            >
              <span>[ Start free trial</span>
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
              <span>]</span>
            </button>
            <button
              onClick={onSeePick}
              className="inline-flex items-center justify-center gap-2 text-ink-100 text-xs font-bold uppercase tracking-[0.18em] px-6 py-4 rounded-sharp shadow-hairline hover:shadow-hairline-bright transition-shadow"
            >
              See today's free pick →
            </button>
          </div>

          {/* Sign in affordance for returning users — small but findable */}
          <p className="mt-5 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-400">
            Already have an account?{' '}
            <button
              onClick={onSignIn}
              className="text-signal-pos hover:underline transition-colors"
            >
              Sign in →
            </button>
          </p>
        </div>

        {/* RIGHT: stat-strip panel — looks like a terminal readout */}
        <div className="md:col-span-5">
          <div className="bg-ink-900 shadow-hairline rounded-sharp">
            <div className="flex items-center justify-between px-4 py-2 border-b border-ink-800">
              <span className="text-[9px] uppercase tracking-[0.20em] text-ink-400">
                $ status · last 30d
              </span>
              <span className="flex items-center gap-1.5">
                <span className="signal-dot inline-block w-1.5 h-1.5 rounded-full bg-signal-pos" />
                <span className="text-[9px] uppercase tracking-[0.18em] text-signal-pos">LIVE</span>
              </span>
            </div>
            <dl className="divide-y divide-ink-800">
              <StatRow label="Hit rate" value={hitRateDisplay} tone={stats?.hitRate >= 55 ? 'pos' : stats?.hitRate >= 50 ? 'neutral' : 'neg'} big />
              <StatRow label="Picks graded" value={weeklyCount} tone="neutral" />
              <StatRow label="Markets covered" value="ML · Spread · Total" tone="neutral" small />
              <StatRow label="Affiliate parent" value="None" tone="pos" small />
            </dl>
          </div>
          <div className="mt-3 flex justify-between text-[9px] uppercase tracking-[0.20em] text-ink-500 px-1">
            <span>// source: mv_model_accuracy</span>
            <span>// refresh: after every settlement</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function StatRow({ label, value, tone = 'neutral', big = false, small = false }) {
  const valueColor = tone === 'pos' ? 'text-signal-pos' : tone === 'neg' ? 'text-signal-neg' : 'text-ink-100'
  const valueSize = big ? 'text-3xl md:text-4xl' : small ? 'text-sm' : 'text-xl'
  return (
    <div className="flex items-center justify-between px-4 py-3 gap-3">
      <dt className="text-[10px] uppercase tracking-[0.18em] text-ink-400 flex-shrink-0">{label}</dt>
      <dd className={`font-bold tabular-nums ${valueColor} ${valueSize} tracking-tight text-right`}>{value}</dd>
    </div>
  )
}

// ─── EdgeScorecard — competitors graded with our own tier system ──────────

function EdgeScorecard() {
  const rows = [
    {
      name: 'Action Network',
      pp: '−8.2',
      side: '▼',
      tier: 'Trap',
      tone: 'neg',
      reason: 'Owned by a publicly-traded sportsbook affiliate (Better Collective). Structurally cannot warn you off a book without dismantling its parent\'s revenue model.',
    },
    {
      name: 'OddsJam',
      pp: '+0.4',
      side: '·',
      tier: 'Skip',
      tone: 'neutral',
      reason: '$99–199/mo. Their own reviewers admit Gold doesn\'t pay off below ~$2K/mo in volume — locks out >80% of recreational bettors.',
    },
    {
      name: 'Pikkit',
      pp: '+1.1',
      side: '▲',
      tier: 'Lean',
      tone: 'neutral',
      reason: 'Grades you after the bet (CLV). Different shelf — they measure history, we publish the decision. Complementary, not competitive.',
    },
    {
      name: 'Cray Cray for Parlays',
      pp: '+9.6',
      side: '▲',
      tier: 'Strong Play',
      tone: 'pos',
      reason: 'No affiliate parent. Per-side edges including negative ones. Trap label is the differentiator the rest structurally can\'t copy.',
    },
  ]
  return (
    <section className="border-b border-ink-800">
      <div className="max-w-6xl mx-auto px-5 py-20 md:py-28">
        <SectionLabel>$ competitors_graded.csv</SectionLabel>
        <h2 className="font-sans font-bold text-3xl md:text-5xl text-ink-100 tracking-[-0.02em] mt-5 leading-[1.05] max-w-3xl">
          We graded them with <span className="text-signal-pos">our own system.</span>
        </h2>
        <p className="mt-5 text-ink-300 max-w-2xl leading-relaxed">
          Every other picks app has a structural reason it can't tell you which side is the trap. So we ran the same math on <span className="text-ink-100">them.</span>
        </p>

        <div className="mt-12">
          {/* Header row */}
          <div className="hidden md:grid grid-cols-[1fr_140px_140px] gap-4 text-[10px] uppercase tracking-[0.18em] text-ink-500 pb-2 border-b border-ink-800">
            <span>Vendor</span>
            <span className="text-right">Edge (signed)</span>
            <span className="text-right">Grade</span>
          </div>

          {rows.map((r, i) => {
            const ppColor = r.tone === 'pos' ? 'text-signal-pos' : r.tone === 'neg' ? 'text-signal-neg' : 'text-ink-300'
            const grdColor = r.tone === 'pos' ? 'text-signal-pos' : r.tone === 'neg' ? 'text-signal-neg' : 'text-ink-400'
            const isUs = r.name.startsWith('Cray')
            return (
              <div
                key={i}
                className={`relative py-6 md:py-7 pl-5 md:pl-6 border-b border-ink-800 ${isUs ? 'bg-signal-pos-dim/10' : ''}`}
              >
                {isUs && (
                  <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-signal-pos" aria-hidden="true" />
                )}
                <div className="grid md:grid-cols-[1fr_140px_140px] gap-2 md:gap-4 items-baseline">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={`text-lg md:text-xl font-bold tracking-tight ${isUs ? 'text-ink-100' : 'text-ink-100'}`}>
                        {r.name}
                      </span>
                      {isUs && (
                        <span className="text-[9px] uppercase tracking-[0.20em] text-signal-pos">
                          ★ us
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-ink-300 leading-relaxed max-w-xl">{r.reason}</p>
                  </div>
                  <div className="md:text-right tabular-nums font-bold text-xl">
                    <span className={ppColor}>{r.side} {r.pp}<span className="text-[11px] ml-0.5">pp</span></span>
                  </div>
                  <div className="md:text-right">
                    <span className={`text-xs font-bold uppercase tracking-[0.18em] ${grdColor}`}>
                      {r.tier}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <p className="mt-8 text-[10px] uppercase tracking-[0.18em] text-ink-500">
          // Edges illustrative. Methodology: our own per-side edge calc, applied to each competitor's positioning.
        </p>
      </div>
    </section>
  )
}

// ─── ExecutionFlow — How it works, reframed as a trade flow ────────────────

function ExecutionFlow() {
  const steps = [
    {
      n: '01',
      title: 'Math grades every game',
      body: 'Per-side edge calculator runs against ML, spread, and total. Computes model probability, compares to the book\'s implied. Gap = signed pp.',
      meta: [
        ['// source', 'The Odds API · ESPN'],
        ['// math',   'lib/services/edge-calculator.js'],
        ['// output', 'signed_pp · tier'],
      ],
    },
    {
      n: '02',
      title: 'De-Genny narrates',
      body: 'Once math has picked the side, the LLM writes the rationale in plain English. The AI explains. It does not pick.',
      meta: [
        ['// engine',  'OpenAI GPT-4o mini · fine-tuned'],
        ['// role',    'narration only'],
        ['// guard',   'no hallucinated stats'],
      ],
    },
    {
      n: '03',
      title: 'You lock and build',
      body: 'Stack the sides you like. One tap hands you a deep-linked betslip to your sportsbook. We never hold money or see your account.',
      meta: [
        ['// books',   'DraftKings · FanDuel'],
        ['// holds',   'we hold nothing'],
        ['// gate',    '+21'],
      ],
    },
  ]
  return (
    <section id="flow" className="border-b border-ink-800 bg-ink-950">
      <div className="max-w-6xl mx-auto px-5 py-20 md:py-28">
        <SectionLabel>$ ./how_it_works</SectionLabel>
        <h2 className="font-sans font-bold text-3xl md:text-5xl text-ink-100 tracking-[-0.02em] mt-5 leading-[1.05] max-w-3xl">
          Three steps. <span className="text-ink-400">No vibes.</span>
        </h2>

        <div className="mt-14 grid md:grid-cols-3 gap-6 md:gap-4 relative">
          {/* connector line on desktop */}
          <div className="hidden md:block absolute top-[28px] left-[8.33%] right-[8.33%] h-px bg-ink-800" aria-hidden="true" />
          {steps.map((s, i) => (
            <div key={s.n} className="relative">
              <div className="flex items-center gap-3 mb-5">
                <span className="relative z-10 bg-ink-950 pr-3 text-3xl md:text-4xl font-bold tabular-nums text-signal-pos tracking-tight">
                  {s.n}
                </span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500">step</span>
              </div>
              <h3 className="font-sans font-semibold text-xl text-ink-100 mb-3 tracking-tight">
                {s.title}
              </h3>
              <p className="text-sm text-ink-300 leading-relaxed mb-5">
                {s.body}
              </p>
              <dl className="space-y-1.5 text-[10px] uppercase tracking-[0.14em]">
                {s.meta.map(([k, v]) => (
                  <div key={k} className="flex gap-3 items-baseline">
                    <dt className="text-ink-500 flex-shrink-0">{k}</dt>
                    <dd className="text-ink-200 normal-case tracking-normal text-[11px]">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── SnapshotTerminal — the real free Pick of the Day ──────────────────────
// Served by /api/public-pod (highest edge_pp >= 4pp on the upcoming board,
// longshot MLs fenced at +300). The old version rendered a hardcoded NBA
// example under a "SEE TODAY'S FREE PICK" CTA — a promise the tile broke.
// One real pick is the free tease; the full board stays behind the trial.

const TIER_SUBTITLES = {
  'Trap': 'fade it', 'Skip': 'pass on it', 'Lean': 'lean it',
  'Play': 'play it', 'Strong Play': 'hammer it', 'Sharp Take': 'sharp take',
}

function SnapshotTerminal({ tierStats }) {
  const [pod, setPod] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public-pod`)
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled) setPod(json)
      } catch { /* loading state stays up */ }
    })()
    return () => { cancelled = true }
  }, [])

  const pick = pod?.pick || null
  const quiet = pod?.quiet === true

  const sharpTake = tierStats?.find(t => t.tier === 'Sharp Take')
  const decided = sharpTake ? sharpTake.wins + sharpTake.losses : 0
  const tr = decided >= 10 ? sharpTake : null

  const gameTime = pick?.gameDate ? new Date(pick.gameDate).toLocaleString('en-US', {
    weekday: 'short', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/New_York',
  }) + ' ET' : null
  const pp = pick?.edgePp != null ? Number(pick.edgePp) : null
  const ppText = pp != null ? `${pp >= 0 ? '+' : '−'}${Math.abs(pp).toFixed(1)}` : null

  return (
    <section id="snapshot" className="border-b border-ink-800 bg-ink-950">
      <div className="max-w-5xl mx-auto px-5 py-20 md:py-28">
        <SectionLabel>$ edge_snapshot --date=today</SectionLabel>
        <h2 className="font-sans font-bold text-3xl md:text-5xl text-ink-100 tracking-[-0.02em] mt-5 leading-[1.05] max-w-3xl">
          Today's free pick,<br />
          straight off the <span className="text-signal-pos">live board.</span>
        </h2>
        <p className="mt-5 text-ink-300 max-w-2xl leading-relaxed">
          {quiet
            ? 'The board is quiet today. When no game clears our Play threshold, we say so — we refuse to force a pick.'
            : 'Same tile, same math as every pick in the paid digest. Refreshes with the morning board.'}
        </p>

        <div className="mt-12 bg-ink-900 shadow-hairline-pos rounded-sharp">
          {/* terminal title bar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-signal-pos-dim/40 bg-ink-950">
            <div className="flex items-center gap-2.5">
              <span className="signal-dot inline-block w-1.5 h-1.5 rounded-full bg-signal-pos" />
              <span className="text-[10px] uppercase tracking-[0.20em] text-signal-pos font-semibold">
                ★ pick of the day
              </span>
            </div>
            <span className="text-[10px] uppercase tracking-[0.14em] text-ink-400 tabular-nums">
              {pick ? `${pick.sport} · ${gameTime}` : quiet ? 'no qualifying edge today' : 'loading board…'}
            </span>
          </div>

          {pick ? (
            <>
              <div className="grid md:grid-cols-[1fr_auto] gap-5 px-5 md:px-7 py-6">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 tabular-nums">
                    {pick.awayTeam} @ {pick.homeTeam} · {pick.betType}
                  </div>
                  <h3 className="font-sans font-bold text-3xl md:text-4xl text-signal-pos tabular-nums tracking-tight mt-2">
                    {pick.pick}
                  </h3>
                </div>
                <div className="flex flex-col items-start md:items-end bg-signal-pos-dim/20 rounded-sharp px-4 py-3">
                  <div className="text-3xl md:text-4xl font-bold tabular-nums text-signal-pos tracking-tight">
                    ▲ {ppText}<span className="text-sm ml-0.5">pp</span>
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-signal-pos mt-1">
                    {pick.tier}
                  </div>
                  <div className="text-[10px] italic lowercase text-ink-400 mt-0.5">
                    {TIER_SUBTITLES[pick.tier] || ''}
                  </div>
                </div>
              </div>

              {/* why this pick — tabular */}
              <div className="border-t border-ink-800">
                <div className="px-5 md:px-7 py-2 bg-ink-950 border-b border-ink-800">
                  <span className="text-[9px] uppercase tracking-[0.20em] text-signal-pos">
                    ▌ why this pick
                  </span>
                </div>
                <dl className="divide-y divide-ink-800">
                  {pick.modelProb != null && (
                    <FactRow label="Model win prob" value={`${(pick.modelProb * 100).toFixed(1)}%`} tone="pos" />
                  )}
                  {pick.impliedProb != null && (
                    <FactRow label="Book implied" value={`${(pick.impliedProb * 100).toFixed(1)}%`} tone="neutral" />
                  )}
                  <FactRow label="Gap" value={`${ppText}pp`} tone="pos" />
                  <FactRow label="Full rationale" value="In the digest · free trial" tone="neutral" />
                </dl>
              </div>
            </>
          ) : (
            <div className="px-5 md:px-7 py-10 text-center">
              <p className="text-ink-300 text-sm">
                {quiet
                  ? 'Quiet day — math says skip. No game on the board clears +4pp right now.'
                  : 'Pulling today\'s board…'}
              </p>
              {quiet && (
                <p className="text-[10px] uppercase tracking-[0.18em] text-ink-500 mt-3">
                  // A pick you shouldn't make is not a pick. Check back after the morning refresh.
                </p>
              )}
            </div>
          )}

          {/* track record strip */}
          {tr && (
            <div className="border-t border-ink-800 px-5 md:px-7 py-3 flex items-center justify-between bg-ink-950 gap-3">
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink-400">
                Sharp Take · last 30d
              </span>
              <span className="tabular-nums text-sm flex-shrink-0">
                <span className="text-signal-pos font-bold">{tr.wins}W</span>
                <span className="text-ink-700 mx-1.5">·</span>
                <span className="text-ink-400">{tr.losses}L</span>
                <span className="text-ink-700 mx-1.5">·</span>
                <span className={parseFloat(tr.hitRate) >= 55 ? 'text-signal-pos font-bold' : 'text-ink-200'}>
                  {tr.hitRate}%
                </span>
              </span>
            </div>
          )}
        </div>

        <p className="mt-4 text-[10px] uppercase tracking-[0.18em] text-ink-500 text-center">
          // The full board renders a tile like this for every game with live markets, in every in-season league.
        </p>
      </div>
    </section>
  )
}

function FactRow({ label, value, tone }) {
  const valColor = tone === 'pos' ? 'text-signal-pos' : tone === 'neg' ? 'text-signal-neg' : 'text-ink-100'
  return (
    <div className="px-5 md:px-7 py-2.5 grid grid-cols-[1fr_auto] gap-3 items-baseline">
      <dt className="text-[10px] uppercase tracking-[0.18em] text-ink-400">{label}</dt>
      <dd className={`text-sm tabular-nums font-medium ${valColor}`}>{value}</dd>
    </div>
  )
}

// ─── TrackRecord — proof, with CSS-only sparkline bars ─────────────────────
// Renders the most-populated dimension from mv_model_accuracy. The MV has
// `sport` rows (NBA/NFL/MLB/etc.) but no `tier` rows yet — so sport is the
// public-facing breakdown. Tier-level lands when the MV materializes it.

function TrackRecord({ sportStats, tierStats }) {
  // Minimum-sample floor: a 100% hit rate on 3 picks reads as noise, not
  // receipts. Rows under the floor are held back, and we say so.
  const MIN_SETTLED = 25
  const aboveFloor = (rows) => (rows || []).filter(r => (r.wins + r.losses) >= MIN_SETTLED)
  const heldBack = (rows) => (rows || []).length - aboveFloor(rows).length

  // Prefer tier breakdown when populated; fall back to sport.
  const order = ['Sharp Take', 'Strong Play', 'Play', 'Lean', 'Skip', 'Trap']
  const sortedTiers = aboveFloor(tierStats).sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier))
  const sortedSports = aboveFloor(sportStats).sort((a, b) => parseFloat(b.hitRate || 0) - parseFloat(a.hitRate || 0))
  const useTiers = sortedTiers.length > 0
  const rows = useTiers ? sortedTiers : sortedSports
  const heldBackCount = useTiers ? heldBack(tierStats) : heldBack(sportStats)
  const dimensionLabel = useTiers ? 'Tier' : 'Sport'
  const dimensionKey = useTiers ? 'tier' : 'sport'
  const headlineKicker = useTiers ? 'Per tier.' : 'Per sport.'

  return (
    <section id="track" className="border-b border-ink-800 bg-ink-950">
      <div className="max-w-5xl mx-auto px-5 py-20 md:py-28">
        <SectionLabel>$ ./hit_rate --period=30d --source=mv_model_accuracy</SectionLabel>
        <h2 className="font-sans font-bold text-3xl md:text-5xl text-ink-100 tracking-[-0.02em] mt-5 leading-[1.05] max-w-3xl">
          The receipts. <span className="text-ink-400">{headlineKicker} Updated after every settlement.</span>
        </h2>
        <p className="mt-5 text-ink-300 max-w-2xl leading-relaxed">
          Most picks apps cherry-pick wins. We publish every {dimensionLabel.toLowerCase()} — including the losers. If a {dimensionLabel.toLowerCase()} dips below 50%, you see it.
        </p>

        {rows.length > 0 ? (
          <div className="mt-12 bg-ink-900 shadow-hairline rounded-sharp">
            <div className="grid grid-cols-[1fr_80px_100px_80px] gap-3 px-5 py-2.5 bg-ink-950 border-b border-ink-800 text-[10px] uppercase tracking-[0.18em] text-ink-400">
              <span>{dimensionLabel}</span>
              <span className="text-right">Settled</span>
              <span>Hit rate</span>
              <span className="text-right">%</span>
            </div>
            {rows.map((row, i) => {
              const settled = row.wins + row.losses
              const rate = parseFloat(row.hitRate)
              const isPos = rate >= 55
              const isNeg = rate < 50
              const color = isPos ? 'text-signal-pos' : isNeg ? 'text-signal-neg' : 'text-ink-100'
              const barColor = isPos ? 'bg-signal-pos' : isNeg ? 'bg-signal-neg' : 'bg-ink-400'
              const label = row[dimensionKey]
              return (
                <div key={label} className={`grid grid-cols-[1fr_80px_100px_80px] gap-3 px-5 py-4 items-center ${i > 0 ? 'border-t border-ink-800' : ''}`}>
                  <span className="text-ink-100 font-medium">{label}</span>
                  <span className="text-right text-ink-400 tabular-nums text-sm">{settled.toLocaleString()}</span>
                  {/* sparkline-bar */}
                  <div className="relative h-1.5 bg-ink-800 rounded-sharp overflow-hidden">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-ink-700" />
                    <div
                      className={`absolute top-0 bottom-0 ${barColor}`}
                      style={{
                        width: `${Math.min(100, Math.abs(rate))}%`,
                        left: 0,
                      }}
                    />
                  </div>
                  <span className={`text-right text-base tabular-nums font-bold ${color}`}>
                    {row.hitRate}%
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="mt-12 bg-ink-900 shadow-hairline rounded-sharp px-5 py-8 text-center">
            <p className="text-ink-300 text-sm">Loading hit-rate data…</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-ink-500 mt-2">
              // Refreshes after every settlement run
            </p>
          </div>
        )}

        {rows.length > 0 && heldBackCount > 0 && (
          <p className="mt-4 text-[10px] uppercase tracking-[0.18em] text-ink-500 text-center">
            // {heldBackCount} {dimensionLabel.toLowerCase()}{heldBackCount === 1 ? '' : 's'} under {25} settled picks held back until the sample is real.
          </p>
        )}
      </div>
    </section>
  )
}

// ─── Disclosure — regulatory-filing aesthetic for the credibility wedge ──

function Disclosure() {
  return (
    <section className="border-b border-ink-800 bg-ink-950">
      <div className="max-w-3xl mx-auto px-5 py-20 md:py-24">
        <SectionLabel>§ disclosure · 2026.05</SectionLabel>
        <div className="mt-8 bg-ink-900 shadow-hairline rounded-sharp px-6 py-8 md:px-10 md:py-10">
          <h2 className="font-sans font-bold text-xl md:text-2xl text-ink-100 tracking-[-0.01em] leading-relaxed">
            On affiliate revenue and conflict of interest
          </h2>
          <div className="mt-6 space-y-4 text-sm text-ink-200 leading-relaxed">
            <p>
              <span className="text-ink-500 text-[10px] uppercase tracking-[0.18em] block mb-1">§ 1.</span>
              Cray Cray for Parlays receives <span className="text-signal-pos font-medium">no affiliate commissions</span> for sending users to sportsbooks. We are not owned by or financially affiliated with any sportsbook, sportsbook affiliate, or operator of betting markets.
            </p>
            <p>
              <span className="text-ink-500 text-[10px] uppercase tracking-[0.18em] block mb-1">§ 2.</span>
              We do not place wagers on behalf of users. We do not hold money. We do not see your sportsbook account credentials. Deep links open the user's own sportsbook session.
            </p>
            <p>
              <span className="text-ink-500 text-[10px] uppercase tracking-[0.18em] block mb-1">§ 3.</span>
              Our entire business is grading games against the public market and publishing the result — <span className="text-signal-pos font-medium">including the bets we believe you should NOT make.</span> The Trap label is the differentiator no affiliate-owned publication can adopt without dismantling its parent's revenue model.
            </p>
          </div>
          <p className="mt-8 text-[10px] uppercase tracking-[0.18em] text-ink-500 pt-6 border-t border-ink-800">
            // Filed publicly. Read the math: <span className="text-ink-300 normal-case tracking-normal">lib/services/edge-calculator.js</span>
          </p>
        </div>
      </div>
    </section>
  )
}

// ─── TermSheet — pricing as signed-document layout ─────────────────────────

function TermSheet({ onStartTrial }) {
  const included = [
    'Daily digest across every sport · ML / spread / total',
    'Per-side edges, signed and tier-graded',
    'Negative edges visible (Trap label)',
    'De-Genny chat for picks on demand',
    'One-tap parlay builder · DraftKings & FanDuel deep links',
    'Settlement tracking · every pick graded after the game',
    'Hit rate by tier and sport · refreshed after every settlement',
  ]
  return (
    <section id="terms" className="border-b border-ink-800 bg-ink-950">
      <div className="max-w-3xl mx-auto px-5 py-20 md:py-28">
        <SectionLabel>§ terms · pro_access</SectionLabel>
        <h2 className="font-sans font-bold text-3xl md:text-5xl text-ink-100 tracking-[-0.02em] mt-5 leading-[1.05]">
          Pricing.
        </h2>
        <p className="mt-5 text-ink-300 max-w-2xl leading-relaxed">
          One tier. Trial first. Pay nothing until you've actually seen a Sharp Take hit.
        </p>

        <div className="mt-12 bg-ink-900 shadow-hairline-pos rounded-sharp">
          <div className="flex items-center justify-between px-5 py-2.5 border-b border-signal-pos-dim/40 bg-ink-950">
            <span className="text-[10px] uppercase tracking-[0.20em] text-signal-pos font-semibold">
              ▌ term sheet
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink-400">
              effective immediately
            </span>
          </div>

          <dl className="divide-y divide-ink-800">
            <TermRow label="Plan"            value="PRO ACCESS" />
            <TermRow label="Price"           value={<><span className="text-3xl text-ink-100">$19.99</span> <span className="text-ink-400 text-sm">/ month</span></>} big />
            <TermRow label="Free trial"      value="7 days · no card required" tone="pos" />
            <TermRow label="Billing"         value="Monthly · no annual commitment" />
            <TermRow label="Cancellation"    value="Anytime · self-serve · no email needed" />
          </dl>

          <div className="border-t border-ink-800 px-5 md:px-7 py-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 mb-3">
              ▌ included
            </div>
            <ul className="space-y-2">
              {included.map((f, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-ink-200">
                  <span className="text-signal-pos flex-shrink-0 mt-0.5">▸</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-ink-800 px-5 md:px-7 py-5 bg-ink-950">
            <button
              onClick={onStartTrial}
              className="group w-full md:w-auto inline-flex items-center justify-center gap-3 bg-signal-pos text-ink-950 text-xs font-bold uppercase tracking-[0.18em] px-8 py-4 rounded-sharp hover:bg-signal-pos/90 transition-colors"
            >
              <span>[ Execute trial</span>
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
              <span>]</span>
            </button>
            <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-ink-500">
              // No credit card required to start. We send one email when the trial ends.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function TermRow({ label, value, tone = 'neutral', big = false }) {
  const valColor = tone === 'pos' ? 'text-signal-pos' : tone === 'neg' ? 'text-signal-neg' : 'text-ink-100'
  return (
    <div className="px-5 md:px-7 py-3.5 grid grid-cols-[140px_1fr] md:grid-cols-[200px_1fr] gap-3 items-baseline">
      <dt className="text-[10px] uppercase tracking-[0.18em] text-ink-400">{label}</dt>
      <dd className={`tabular-nums ${valColor} ${big ? 'text-2xl font-bold tracking-tight' : 'text-sm'}`}>
        {value}
      </dd>
    </div>
  )
}

// ─── Filings · Q&A — FAQ as 10-K Q&A document ─────────────────────────────

function Filings() {
  const items = [
    {
      q: 'What\'s a "Trap"?',
      a: 'A pick with a negative per-side edge — meaning the model thinks the side wins less often than the book\'s line implies. Every other picks app hides these. We label them. "Trap" is the only honest reaction to a bad bet that looks tempting.',
    },
    {
      q: 'Why publish negative edges? Doesn\'t that scare people off?',
      a: 'Negative edges are most of the betting universe. If we only published positive ones, we\'d be lying about the shape of the market. The Trap label is the differentiator — it\'s the one thing every other picks app structurally can\'t show you.',
    },
    {
      q: 'How is this different from Action Network or OddsJam?',
      a: 'Action Network is owned by Better Collective, a publicly-traded sportsbook affiliate — they can\'t credibly warn you off a book. OddsJam targets $2K+ monthly bankroll arb bettors at $99–199/mo. We\'re built for the $50–500/mo bankroll that wants the math without the price tag — and we\'re the only picks app that shows you what NOT to bet.',
    },
    {
      q: 'Is this gambling advice?',
      a: 'No. It\'s information. We grade games using public data and publish the math. What you do with the picks is on you. We\'re not licensed as advice, we\'re not a sportsbook, we don\'t hold money. For entertainment and informational purposes only.',
    },
    {
      q: 'Do I need to be 21?',
      a: 'Yes. We\'re an info site about sports betting, which is a +21 activity in every US jurisdiction we know of. The +21 gate enforces it on first visit.',
    },
    {
      q: 'Where does my data go?',
      a: 'Email + (optionally) Google sign-in is all we collect to start. We don\'t share or sell. Locked picks live on your account so we can grade them later. Payment goes through Stripe directly — we never see your card.',
    },
  ]
  const [open, setOpen] = useState(null)

  return (
    <section className="border-b border-ink-800 bg-ink-950">
      <div className="max-w-3xl mx-auto px-5 py-20 md:py-24">
        <SectionLabel>§ filings · q&amp;a</SectionLabel>
        <h2 className="font-sans font-bold text-3xl md:text-5xl text-ink-100 tracking-[-0.02em] mt-5 leading-[1.05]">
          Questions <span className="text-ink-400">on file.</span>
        </h2>

        <div className="mt-12 bg-ink-900 shadow-hairline rounded-sharp divide-y divide-ink-800">
          {items.map((it, i) => {
            const isOpen = open === i
            const num = String(i + 1).padStart(2, '0')
            return (
              <div key={i}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-start gap-4 px-5 md:px-6 py-5 text-left hover:bg-ink-850/40 transition-colors"
                >
                  <span className="text-[10px] uppercase tracking-[0.18em] text-signal-pos tabular-nums flex-shrink-0 mt-1">
                    Q.{num}
                  </span>
                  <span className="flex-1 font-sans text-base md:text-lg text-ink-100 font-medium tracking-tight">
                    {it.q}
                  </span>
                  <span className="text-signal-pos text-lg flex-shrink-0 ml-2 leading-none">
                    {isOpen ? '−' : '+'}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-5 md:px-6 pb-6 pl-[60px] md:pl-[64px]">
                    <div className="flex gap-4">
                      <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500 flex-shrink-0 hidden">
                        A.{num}
                      </span>
                      <p className="text-sm text-ink-300 leading-relaxed">{it.a}</p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="bg-ink-950">
      <div className="max-w-6xl mx-auto px-5 py-10">
        <div className="border-t border-ink-800 pt-8 grid md:grid-cols-[1fr_auto] gap-6 items-baseline">
          <div className="space-y-2 text-[10px] uppercase tracking-[0.18em] text-ink-500 leading-relaxed">
            <p>For entertainment and informational purposes only · not gambling advice · +21</p>
            <p>
              If you or someone you know has a gambling problem, call <span className="text-ink-300 normal-case tracking-normal">1-800-GAMBLER</span>
            </p>
          </div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-700 md:text-right">
            © 2026 Cray Cray for Parlays
          </div>
        </div>
      </div>
    </footer>
  )
}

// ─── Shared: section label (looks like a terminal command) ────────────────

function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-signal-pos text-[10px] uppercase tracking-[0.20em]">▌</span>
      <span className="text-[10px] uppercase tracking-[0.20em] text-ink-400">{children}</span>
    </div>
  )
}
