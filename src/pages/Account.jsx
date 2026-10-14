import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import BrandMark, { SignOutButton } from '../components/BrandMark'
import Auth from '../components/Auth'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch } from '../lib/api'

// Account and Pro (owner 2026-10-14): one plan. Launch members pay
// $9.99 a month and keep that price for life. Stripe hosts checkout and
// the billing portal, so no card field lives on this page.
export const LAUNCH_PRICE = '$9.99'
export const STANDARD_PRICE = '$19.99'

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null)

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

async function goTo(path, setBusy, setError) {
  setBusy(true)
  setError(null)
  try {
    const r = await apiFetch(path, { method: 'POST' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || !d.url) throw new Error(d.error || 'Something went wrong, try again')
    window.location.assign(d.url)
  } catch (e) {
    setError(e.message)
    setBusy(false)
  }
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

  const access = status?.access
  const subscribed = access?.reason === 'subscribed'
  const launchOffer = status?.offer === 'launch'
  const price = launchOffer ? LAUNCH_PRICE : STANDARD_PRICE

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <header className="sticky top-0 z-20 bg-ink-950/95 backdrop-blur border-b border-ink-800" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <BrandMark />
          <SignOutButton />
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
                  You are on Pro{status.launchMember ? ` at the ${LAUNCH_PRICE} launch price, locked in for life` : ''}.
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

            {access?.reason === 'comp' && <p className="text-ink-200">You have Pro on the house until {fmtDate(access.until)}.</p>}

            {!subscribed && (
              <>
                {access?.reason === 'trial' && <p className="text-ink-200">Your free week runs until {fmtDate(access.until)}.</p>}
                {access && !access.entitled && <p className="text-ink-200">Your free week is over. The ledger, every Lean and every trap stay free.</p>}
                <div>
                  <p><span className="text-4xl font-bold tabular-nums">{price}</span><span className="text-ink-400"> a month</span></p>
                  {launchOffer && (
                    <p className="mt-1 text-sm text-signal-pos">
                      Launch price, yours for as long as you stay.
                      {status.launchSeatsLeft != null && status.launchSeatsLeft <= 50 ? ` ${status.launchSeatsLeft} launch spots left.` : ''}
                    </p>
                  )}
                  {launchOffer && <p className="mt-1 text-xs text-ink-500">Goes to {STANDARD_PRICE} for new members after launch.</p>}
                </div>
                {status.billingReady ? (
                  <button disabled={busy} onClick={() => goTo('/api/billing/checkout', setBusy, setError)} className="w-full px-6 py-4 rounded-xl bg-signal-pos text-ink-950 font-semibold hover:bg-signal-pos/90 active:scale-[0.98] disabled:opacity-60 transition">
                    {busy ? 'Opening checkout' : `Get Pro for ${price} a month`}
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

        <button onClick={() => navigate('/today')} className="text-sm font-semibold text-signal-pos hover:underline self-center">Back to Today</button>
        <p className="text-[11px] text-ink-600 text-center">For information and entertainment. 21+. If gambling stops being fun, call 1-800-GAMBLER.</p>
      </main>
      {showAuth && <Auth onClose={() => setShowAuth(false)} />}
    </div>
  )
}
