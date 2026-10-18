import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import BrandMark, { SignOutButton } from '../components/BrandMark'
import { TopNav } from '../components/TabBar'
import Auth from '../components/Auth'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch } from '../lib/api'

// Account and Pro (owner 2026-10-14): one plan. Founding members pay
// $9.99 a month and keep that price while they stay subscribed. Stripe hosts checkout and
// the billing portal, so no card field lives on this page.
export const LAUNCH_PRICE = '$9.99'
export const LAUNCH_ANNUAL = '$89'
export const STANDARD_PRICE = '$19.99'
const STANDARD_ANNUAL = '$119.99'

const fmtDate = (iso) => (iso && iso !== 'infinity' ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null)

function useBillingStatus(isAuthenticated, poll) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let cancelled = false
    let tries = 0
    async function load() {
      try {
        const r = await apiFetch('/api/billing/status')
        if (!r.ok) throw new Error(`status ${r.status}`)
        const d = await r.json()
        if (cancelled) return
        setStatus(d)
        // Back from Checkout: the webhook can land a few seconds after
        // the redirect, so look again until the subscription shows.
        if (poll && d.access?.reason !== 'subscribed' && tries++ < 8) setTimeout(load, 2500)
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    }
    load()
    return () => { cancelled = true }
  }, [isAuthenticated, poll])
  return { status, error }
}

async function goTo(path, setBusy, setError, body = null) {
  setBusy(true)
  setError(null)
  try {
    const r = await apiFetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'POST' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || !d.url) throw new Error(d.error || 'Something went wrong, try again')
    window.location.assign(d.url)
  } catch (e) {
    setError(e.message)
    setBusy(false)
  }
}

// Owner promo codes: free Pro for friends who will spread the word.
function PromoCode({ onDone }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  async function submit(e) {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await apiFetch('/api/billing/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim() }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'That code does not work.')
      setMsg({ ok: true, text: d.until === 'infinity' ? 'Done. You have Pro free, for good.' : `Done. You have Pro free until ${fmtDate(d.until)}.` })
      setTimeout(onDone, 1500)
    } catch (err) {
      setMsg({ ok: false, text: err.message })
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="bg-ink-900 rounded-2xl border border-ink-700 p-4 flex flex-col gap-3">
      <label htmlFor="promo" className="text-sm text-ink-300">Have a code?</label>
      <div className="flex gap-2">
        <input
          id="promo"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={40}
          placeholder="CODE"
          className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-ink-950 border border-ink-700 text-ink-100 tracking-wider focus:outline-none focus:border-signal-pos"
        />
        <button type="submit" disabled={busy || !code.trim()} className="px-5 py-3 rounded-xl bg-ink-800 text-ink-100 font-semibold hover:bg-ink-700 disabled:opacity-60 transition">Apply</button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-signal-pos' : 'text-signal-neg'}`}>{msg.text}</p>}
    </form>
  )
}

export default function Account() {
  const navigate = useNavigate()
  const { search } = useLocation()
  const { isAuthenticated, user } = useAuth()
  const checkout = new URLSearchParams(search).get('checkout')
  const { status, error: loadError } = useBillingStatus(isAuthenticated, checkout === 'done')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [showAuth, setShowAuth] = useState(false)
  const [period, setPeriod] = useState('month')

  const access = status?.access
  const subscribed = access?.reason === 'subscribed'
  const comped = access?.reason === 'comp'
  const launchOffer = status?.offer === 'launch'
  const yearly = period === 'year' && status?.yearlyReady
  const price = yearly ? (launchOffer ? LAUNCH_ANNUAL : STANDARD_ANNUAL) : (launchOffer ? LAUNCH_PRICE : STANDARD_PRICE)
  const per = yearly ? 'a year' : 'a month'

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <header className="sticky top-0 z-20 bg-ink-950/95 backdrop-blur border-b border-ink-800" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-xl lg:max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <BrandMark />
          <div className="flex items-center gap-1">
            <TopNav className="mr-2" />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-6 pb-16 flex flex-col gap-6">
        <section className="flex flex-col gap-1">
          <p className="text-sm text-ink-400">{user?.email || 'Account'}</p>
          <h1 className="text-3xl font-bold tracking-tight">TrapHawk Pro</h1>
        </section>

        {checkout === 'done' && (
          <div className="bg-ink-900 rounded-2xl border border-signal-pos/50 px-4 py-4 text-sm text-ink-200">
            {subscribed ? 'You are in. Every play, prop and parlay is open.' : 'Payment received. Turning on Pro now, this takes a few seconds.'}
          </div>
        )}
        {checkout === 'cancelled' && (
          <div className="bg-ink-900 rounded-2xl border border-ink-700 px-4 py-4 text-sm text-ink-300">Checkout was cancelled. Nothing was charged.</div>
        )}

        {!isAuthenticated && (
          <div className="bg-ink-900 rounded-2xl border border-ink-700 p-6 flex flex-col gap-4">
            <p className="text-ink-200">Sign in or make a free account first. Your first 7 days are free with no card.</p>
            <button onClick={() => setShowAuth(true)} className="w-full px-6 py-4 rounded-xl bg-signal-pos text-ink-950 font-semibold hover:bg-signal-pos/90 active:scale-[0.98] transition">Sign in or sign up</button>
          </div>
        )}

        {isAuthenticated && !status && !loadError && <p className="text-sm text-ink-400">Loading your plan</p>}
        {loadError && <p className="text-sm text-ink-400">Your plan did not load. Try again in a minute.</p>}

        {isAuthenticated && status && (
          <div className="bg-ink-900 rounded-2xl border border-ink-700 p-6 flex flex-col gap-4">
            {subscribed && (
              <>
                <p className="text-ink-200">
                  You are on Pro{status.launchMember ? ', at the founding price for as long as you stay subscribed' : ''}.
                </p>
                {access.until && (
                  <p className="text-sm text-ink-400">
                    {access.cancelAtPeriodEnd ? `Ends ${fmtDate(access.until)}.` : `Renews ${fmtDate(access.until)}.`}
                    {access.status === 'past_due' ? ' Your last payment did not go through, update your card to keep Pro.' : ''}
                  </p>
                )}
                {status.hasBilling && (
                  <button disabled={busy} onClick={() => goTo('/api/billing/portal', setBusy, setError)} className="w-full px-6 py-4 rounded-xl border border-ink-600 text-ink-100 font-semibold hover:bg-ink-800 disabled:opacity-60 transition">
                    Manage billing or cancel
                  </button>
                )}
              </>
            )}

            {comped && (
              <p className="text-ink-200">
                {access.until === 'infinity' ? 'You have Pro free, for good.' : `You have Pro free until ${fmtDate(access.until)}.`}
              </p>
            )}

            {!subscribed && !comped && !status.paywall && (
              <p className="text-ink-200">Everything on TrapHawk is free right now. No card, nothing to do.</p>
            )}

            {!subscribed && !comped && status.paywall && (
              <>
                {access?.reason === 'trial' && <p className="text-ink-200">Your free week runs until {fmtDate(access.until)}.</p>}
                {access && !access.entitled && <p className="text-ink-200">Your free week is over. The ledger, every Lean and every trap stay free.</p>}
                {status.yearlyReady && (
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Billing period">
                    {[['month', 'Monthly'], ['year', 'Yearly']].map(([k, label]) => (
                      <button key={k} onClick={() => setPeriod(k)} aria-pressed={period === k}
                        className={`px-4 py-2 rounded-xl text-sm font-semibold border transition ${period === k ? 'border-signal-pos text-signal-pos' : 'border-ink-700 text-ink-300'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <div>
                  <p><span className="text-4xl font-bold tabular-nums">{price}</span><span className="text-ink-400"> {per}</span></p>
                  {launchOffer && (
                    <p className="mt-1 text-sm text-signal-pos">
                      Founding price, yours for as long as you stay subscribed.
                      {status.launchSeatsLeft != null && status.launchSeatsLeft <= 50 ? ` ${status.launchSeatsLeft} launch spots left.` : ''}
                    </p>
                  )}
                  {launchOffer && <p className="mt-1 text-xs text-ink-500">Open to the first 250 members, then {STANDARD_PRICE} a month.</p>}
                </div>
                {status.billingReady ? (
                  <button disabled={busy} onClick={() => goTo('/api/billing/checkout', setBusy, setError, { interval: yearly ? 'year' : 'month' })} className="w-full px-6 py-4 rounded-xl bg-signal-pos text-ink-950 font-semibold hover:bg-signal-pos/90 active:scale-[0.98] disabled:opacity-60 transition">
                    {busy ? 'Opening checkout' : `Get Pro for ${price} ${per}`}
                  </button>
                ) : (
                  <p className="text-sm text-ink-400">Pro opens soon.</p>
                )}
                <p className="text-xs text-ink-500">Payment goes through Stripe, so we never see your card. Cancel anytime yourself.</p>
              </>
            )}
            {error && <p className="text-sm text-signal-neg">{error}</p>}
          </div>
        )}

        {isAuthenticated && status && !subscribed && access?.until !== 'infinity' && (
          <PromoCode onDone={() => window.location.reload()} />
        )}

        <button onClick={() => navigate('/today')} className="text-sm font-semibold text-signal-pos hover:underline self-center">Back to Today</button>
        <p className="text-[11px] text-ink-600 text-center">For information and entertainment. 21+. If gambling stops being fun, call 1-800-GAMBLER.</p>
      </main>
      {showAuth && <Auth onClose={() => setShowAuth(false)} />}
    </div>
  )
}
