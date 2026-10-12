import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Get the app (owner 2026-10-12). PR 214 made TrapHawk installable, but
// nothing on screen said so. iPhone and iPad Safari never offer an install
// prompt, so the only way in was Share, then Add to Home Screen, which
// nobody finds alone. This button shows on every browser tab and hides
// once the app is running from the home screen.
//
// Android and desktop Chrome fire beforeinstallprompt once, often before
// React mounts, so the listener lives at module load and keeps the event
// for the first button that asks.

let deferredPrompt = null
const listeners = new Set()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    listeners.forEach(fn => fn())
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    listeners.forEach(fn => fn())
  })
}

export function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

// iPadOS reports itself as a Mac, so a touch screen on "Macintosh" is an iPad.
export function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="inline-block w-4 h-4 -mt-0.5 text-signal-pos" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  )
}

function InstallSheet({ onClose }) {
  const ios = isIOS()
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70" onClick={onClose} role="dialog" aria-modal="true" aria-label="Get the TrapHawk app">
      <div
        className="w-full sm:max-w-sm bg-ink-900 shadow-hairline rounded-t-2xl sm:rounded-2xl px-5 pt-5 text-left"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <img src="/apple-touch-icon.png" alt="" className="w-12 h-12 rounded-xl" />
          <div className="min-w-0">
            <p className="font-sans font-semibold text-ink-100">TrapHawk on your home screen</p>
            <p className="font-sans text-xs text-ink-400">Free. Opens straight to today's plays.</p>
          </div>
        </div>
        {ios ? (
          <ol className="font-sans text-sm text-ink-200 flex flex-col gap-3 mb-5">
            <li className="flex gap-3"><span className="font-mono text-signal-pos">1</span><span>Tap <ShareIcon /> Share in Safari's toolbar.</span></li>
            <li className="flex gap-3"><span className="font-mono text-signal-pos">2</span><span>Scroll down and tap <span className="font-semibold text-ink-100">Add to Home Screen</span>.</span></li>
            <li className="flex gap-3"><span className="font-mono text-signal-pos">3</span><span>Tap <span className="font-semibold text-ink-100">Add</span>. TrapHawk opens like any other app.</span></li>
          </ol>
        ) : (
          <p className="font-sans text-sm text-ink-200 mb-5">
            Open <span className="font-semibold text-ink-100">traphawk.io</span> on your iPhone or iPad in Safari, then tap Share and Add to Home Screen. On Android, open it in Chrome and choose Install app from the menu.
          </p>
        )}
        <button onClick={onClose} className="w-full py-3 rounded-xl bg-ink-800 text-ink-100 font-sans font-semibold text-sm active:scale-[0.98] transition-transform">
          Got it
        </button>
      </div>
    </div>
  )
}

const VARIANTS = {
  // Full width secondary button, for heroes and page footers.
  block: 'w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-4 rounded-sharp shadow-hairline hover:shadow-hairline-bright text-ink-100 text-xs font-mono font-bold uppercase tracking-[0.18em] transition-shadow',
  // Small pill for page headers.
  header: 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-signal-pos/10 text-signal-pos text-xs font-semibold hover:bg-signal-pos/20 transition-colors flex-shrink-0',
}

export default function InstallButton({ variant = 'header', className = '' }) {
  const [, force] = useState(0)
  const [open, setOpen] = useState(false)
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    const fn = () => force(n => n + 1)
    listeners.add(fn)
    const mq = window.matchMedia?.('(display-mode: standalone)')
    const onMode = () => setInstalled(isStandalone())
    mq?.addEventListener?.('change', onMode)
    return () => {
      listeners.delete(fn)
      mq?.removeEventListener?.('change', onMode)
    }
  }, [])

  if (installed) return null

  const onClick = async () => {
    if (deferredPrompt) {
      const evt = deferredPrompt
      deferredPrompt = null
      evt.prompt()
      try {
        const { outcome } = await evt.userChoice
        if (outcome === 'accepted') setInstalled(true)
      } catch { /* prompt dismissed */ }
      return
    }
    setOpen(true)
  }

  return (
    <>
      <button onClick={onClick} className={`${VARIANTS[variant]} ${className}`}>
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4v11" />
          <path d="M7 10l5 5 5-5" />
          <path d="M5 20h14" />
        </svg>
        Get the app
      </button>
      {/* Portal to body. Sticky headers use backdrop-blur, which traps a
          fixed child inside the header box. */}
      {open && createPortal(<InstallSheet onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}
