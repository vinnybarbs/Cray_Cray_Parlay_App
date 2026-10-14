import React, { useEffect, useState } from 'react'

// API_BASE matches the rest of the app. Railway in prod, env override locally.
import { API_BASE_URL as API_BASE } from '../config'
import InstallButton from '../components/InstallButton'
import PropCard from '../components/PropCard'
import LiveStrip from '../components/LiveStrip'
import BrandMark from '../components/BrandMark'
import { SkeletonCard } from '../components/Skeleton'
import { LAUNCH_PRICE, LAUNCH_ANNUAL, STANDARD_PRICE } from './Account'

// ─── Landing, the public front door ──────────────────────────────────────────
// Rewritten 2026-10-12 (owner design review, "lead with the play, prove it
// with the record"). Six sections in the consumer look the app uses:
// the live strip, one promise, a real prop card, three proofs with one
// record line, how it works, then price and questions. The trading
// terminal costume (term sheet, filings, scanlines, bracket buttons) is
// gone. Record numbers come only from /api/public-stats, which reads
// mv_public_record, the same rollup as the ledger.

export default function Landing({ onStartTrial, onSignIn }) {
  const [stats, setStats] = useState(null)
  const [sharpTake, setSharpTake] = useState(null)
  const [ticker, setTicker] = useState(null)
  const [tickerDone, setTickerDone] = useState(false)
  const [props, setProps] = useState(null)

  useEffect(() => {
    let cancelled = false
    const get = (path, set) => fetch(`${API_BASE}${path}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!cancelled && j) set(j) })
      .catch(() => { /* each section has its own empty state */ })
    get('/api/public-stats', j => { if (j.overall) setStats(j.overall); if (j.sharpTakeAllTime) setSharpTake(j.sharpTakeAllTime) })
    get('/api/public-ticker', setTicker).finally(() => { if (!cancelled) setTickerDone(true) })
    get('/api/props', setProps)
    return () => { cancelled = true }
  }, [])

  const scrollTo = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // The ticker: published plays and the bait to stay off, already in
  // order from the API. Every chip scrolls to the free look.
  const strip = (ticker?.items || []).map((it, i) => ({ ...it, key: `${it.kind}-${i}` }))

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100 antialiased">
      <Nav onStartTrial={onStartTrial} onSignIn={onSignIn} />
      <LiveStrip items={strip} loading={!tickerDone} onSelect={scrollTo('free-look')} />
      <Hero onStartTrial={onStartTrial} onSignIn={onSignIn} onSeeFree={scrollTo('free-look')} />
      <FreeLook props={props} onStartTrial={onStartTrial} />
      <Proofs stats={stats} sharpTake={sharpTake} />
      <HowItWorks />
      <Pricing onStartTrial={onStartTrial} />
      <Questions />
      <Footer />
    </div>
  )
}

function Nav({ onStartTrial, onSignIn }) {
  return (
    <header className="sticky top-0 z-30 bg-ink-950/95 backdrop-blur border-b border-ink-800" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <BrandMark />
        <div className="flex items-center gap-2">
          <a href="#/ledger" className="hidden md:inline px-3 py-2 text-sm text-ink-300 hover:text-white">The record</a>
          <button onClick={onSignIn} className="px-3 py-2 text-sm text-ink-300 hover:text-white">Sign in</button>
          <button onClick={onStartTrial} className="px-4 py-2 rounded-full bg-signal-pos text-ink-950 text-sm font-semibold hover:bg-signal-pos/90">Start free</button>
        </div>
      </div>
    </header>
  )
}

function Hero({ onStartTrial, onSignIn, onSeeFree }) {
  return (
    <section className="max-w-5xl mx-auto px-4 pt-12 pb-14 md:pt-20 md:pb-20">
      <p className="text-sm font-semibold text-signal-pos">NFL player props, priced by math</p>
      <h1 className="mt-3 text-[2.5rem] md:text-6xl font-bold leading-[1.02] tracking-tight max-w-3xl">
        Find the props worth betting. <span className="text-ink-400">And the ones that aren't.</span>
      </h1>
      <p className="mt-5 text-lg text-ink-300 max-w-xl leading-relaxed">
        Every day we price every game and player prop against the books, show you the ones that beat the price, and name the popular sides that don't.
      </p>
      <div className="mt-8 flex flex-col sm:flex-row gap-3 max-w-md sm:max-w-none">
        <button onClick={onStartTrial} className="px-6 py-4 rounded-xl bg-signal-pos text-ink-950 font-semibold hover:bg-signal-pos/90 active:scale-[0.98] transition">
          Start your free week
        </button>
        <button onClick={onSeeFree} className="px-6 py-4 rounded-xl border border-ink-700 text-ink-100 font-semibold hover:bg-ink-900 transition">
          See today's free look
        </button>
      </div>
      <p className="mt-3 text-sm text-ink-400">7 days free, no card required.</p>
      <div className="mt-5 max-w-md"><InstallButton variant="block" /></div>
      <p className="mt-5 text-sm text-ink-400">
        Already a member? <button onClick={onSignIn} className="text-signal-pos font-semibold hover:underline">Sign in</button>
      </p>
    </section>
  )
}

// A real card from today's board, the same component the app shows.
function FreeLook({ props, onStartTrial }) {
  const top = props?.upcoming?.[0]
  return (
    <section id="free-look" className="border-t border-ink-800 bg-ink-900/40">
      <div className="max-w-5xl mx-auto px-4 py-14 md:py-20 grid md:grid-cols-2 gap-8 md:gap-12 items-start">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Today's free look</h2>
          <p className="mt-3 text-ink-300 leading-relaxed">
            This is the strongest prop on our board right now, exactly as members see it. Our number against the book's, the player's last ten games against the line, and the why behind it.
          </p>
          <p className="mt-3 text-sm text-ink-400">
            Props are in shadow while we build their record in public, so this one is tracked, not counted.
          </p>
          <button onClick={onStartTrial} className="mt-6 text-signal-pos font-semibold hover:underline">See every prop today</button>
        </div>
        <div className="max-w-xl">
          {top ? <PropCard p={top} /> : props ? (
            <div className="bg-ink-900 rounded-2xl border border-ink-700 p-5 text-sm text-ink-300">
              No prop clears our bar right now. Reads refresh twice a day, and the board fills up before each slate.
            </div>
          ) : <SkeletonCard />}
        </div>
      </div>
    </section>
  )
}

// Three reasons to trust it, then one record line. The full record lives
// on the ledger, one tap away.
function Proofs({ stats, sharpTake }) {
  const proofs = [
    ['Every pick is public', 'Published before the game, graded after, losers included. Nothing gets deleted.'],
    ['We name the traps', 'The popular side we rate below the book gets a "Don\'t bet this" label. Nobody else shows you that.'],
    ['No sportsbook owns us', 'No affiliate links, no revenue share, ever. We have no reason to push you toward a bet.'],
  ]
  return (
    <section className="border-t border-ink-800">
      <div className="max-w-5xl mx-auto px-4 py-14 md:py-20">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight max-w-2xl">Why you can trust the number</h2>
        <div className="mt-8 grid md:grid-cols-3 gap-4">
          {proofs.map(([t, d]) => (
            <div key={t} className="bg-ink-900 rounded-2xl border border-ink-700 p-5">
              <h3 className="font-semibold text-ink-100">{t}</h3>
              <p className="mt-2 text-sm text-ink-300 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
        <RecordLine stats={stats} sharpTake={sharpTake} />
      </div>
    </section>
  )
}

function RecordLine({ stats, sharpTake }) {
  const st = sharpTake && (sharpTake.wins + sharpTake.losses) > 0 ? sharpTake : null
  if (!st && stats?.hitRate == null) return null
  return (
    <p className="mt-6 text-sm text-ink-400">
      {st ? (
        <>Sharp Takes since May 10: <span className="font-semibold tabular-nums text-ink-100">{st.wins}-{st.losses}</span>
          {st.roiPct != null && <>, <span className={`font-semibold tabular-nums ${st.roiPct >= 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{st.roiPct >= 0 ? '+' : ''}{st.roiPct}% return</span></>}</>
      ) : (
        <>Every pick, last 30 days: <span className="font-semibold tabular-nums text-ink-100">{stats.hitRate}%</span> hit rate</>
      )}
      {' · '}
      <a href="#/ledger" className="text-signal-pos font-semibold hover:underline">See every pick</a>
    </p>
  )
}

function HowItWorks() {
  const steps = [
    ['We price every game and prop', 'Our model works out how likely each side really is, from the matchup, recent form, injuries and weather.'],
    ['We compare it to the book', 'Book says one chance, we say another. When ours is well above the book\'s, it\'s a play. When the popular side\'s is below, it\'s a trap.'],
    ['You see the why', 'Every card shows our number against the book\'s and a short explanation. Tap it and it opens up.'],
  ]
  return (
    <section className="border-t border-ink-800">
      <div className="max-w-5xl mx-auto px-4 py-14 md:py-20">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">How it works</h2>
        <ol className="mt-8 grid md:grid-cols-3 gap-6">
          {steps.map(([t, d], i) => (
            <li key={t} className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-signal-pos/15 text-signal-pos font-semibold flex items-center justify-center">{i + 1}</span>
              <div>
                <h3 className="font-semibold text-ink-100">{t}</h3>
                <p className="mt-1.5 text-sm text-ink-300 leading-relaxed">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function Pricing({ onStartTrial }) {
  const included = [
    'Every play and trap across the sports in season',
    'NFL player props with the why on every card',
    'Machine built parlays, settled in public',
    'The full record, every pick graded',
  ]
  return (
    <section className="border-t border-ink-800 bg-ink-900/40">
      <div className="max-w-5xl mx-auto px-4 py-14 md:py-20 grid md:grid-cols-2 gap-8 items-center">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">One plan. Try it free.</h2>
          <p className="mt-3 text-ink-300">Pay nothing for 7 days, no card needed. Join at launch and your price never goes up while you stay subscribed. Cancel anytime yourself.</p>
          <p className="mt-3 text-sm text-ink-400">The ledger, every Lean and every trap stay free forever.</p>
        </div>
        <div className="bg-ink-900 rounded-2xl border border-ink-700 p-6">
          <p className="text-ink-300">TrapHawk Pro</p>
          <p className="mt-1"><span className="text-4xl font-bold tabular-nums">{LAUNCH_PRICE}</span><span className="text-ink-400"> a month</span></p>
          <p className="mt-1 text-sm text-signal-pos">Founding price, or {LAUNCH_ANNUAL} a year, kept as long as you stay subscribed. First 250 members only, then {STANDARD_PRICE} a month.</p>
          <ul className="mt-5 flex flex-col gap-2.5">
            {included.map(f => (
              <li key={f} className="flex gap-2.5 text-sm text-ink-200">
                <svg viewBox="0 0 24 24" className="w-4 h-4 mt-0.5 flex-shrink-0 text-signal-pos" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
                {f}
              </li>
            ))}
          </ul>
          <button onClick={onStartTrial} className="mt-6 w-full px-6 py-4 rounded-xl bg-signal-pos text-ink-950 font-semibold hover:bg-signal-pos/90 active:scale-[0.98] transition">
            Start your free week
          </button>
          <p className="mt-3 text-xs text-ink-500 text-center">We send one email when the trial ends.</p>
        </div>
      </div>
    </section>
  )
}

function Questions() {
  const items = [
    ['What\'s a trap?', 'A side most bettors are drawn to, like a hot streak, a heavy favorite or a popular over, where we put its chance at least 2% below the book\'s. A bad bet nobody wants isn\'t a trap. A bad bet everybody wants is.'],
    ['Why show the sides not to bet?', 'Most of the betting market is bad prices. Showing only the good ones would hide the shape of it. Naming the traps is the thing a sportsbook partner can\'t do.'],
    ['How is this different from Action Network or OddsJam?', 'Action Network is owned by Better Collective, a publicly traded sportsbook affiliate, so it can\'t credibly warn you off a book. OddsJam is built for high volume bettors at $99 to $199 a month. We\'re built for everyday bettors who want the math without the price tag, and we show you what not to bet.'],
    ['Are props counted in the record?', 'Not yet. Props are in shadow: priced, published and graded in public, but kept out of the official record until their own record and the closing line clear our bar.'],
    ['Is this gambling advice?', 'No. It\'s information. We grade games from public data and publish the math. We\'re not a sportsbook and we never hold money. For entertainment and information only.'],
    ['Do I need to be 21?', 'Yes. Sports betting is 21 and over in every US state we know of.'],
    ['Where does my data go?', 'We collect your email, and Google sign in if you choose it. We don\'t share or sell it. Payment goes through Stripe, so we never see your card.'],
  ]
  const [open, setOpen] = useState(null)
  return (
    <section className="border-t border-ink-800">
      <div className="max-w-3xl mx-auto px-4 py-14 md:py-20">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Questions</h2>
        <div className="mt-8 bg-ink-900 rounded-2xl border border-ink-700 divide-y divide-ink-800">
          {items.map(([q, a], i) => {
            const isOpen = open === i
            return (
              <div key={q}>
                <button onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen} className="w-full flex items-center gap-4 px-5 py-4 text-left">
                  <span className="flex-1 font-medium text-ink-100">{q}</span>
                  <svg viewBox="0 0 24 24" className={`w-4 h-4 text-ink-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {isOpen && <p className="px-5 pb-5 -mt-1 text-sm text-ink-300 leading-relaxed">{a}</p>}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-ink-800">
      <div className="max-w-5xl mx-auto px-4 py-10 flex flex-col md:flex-row md:justify-between gap-3 text-xs text-ink-500">
        <p>For entertainment and information only, not gambling advice. 21+. If you or someone you know has a gambling problem, call 1-800-GAMBLER.</p>
        <p>© 2026 TrapHawk</p>
      </div>
    </footer>
  )
}
