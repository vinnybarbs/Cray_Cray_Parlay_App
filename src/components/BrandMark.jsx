import React from 'react'
import { useAuth } from '../contexts/AuthContext'

// TrapHawk logo and wordmark for the page top bars. Lives inside each
// page's existing sticky header (Vince: one banner, not two). Plain
// anchor into the hash router so it works on public pages without a
// Router context assumption.
// Same treatment as the Landing Nav wordmark (two-tone, bold, hover
// accent) so the brand reads identically on every page.
export default function BrandMark() {
  return (
    <a href="#/digest" className="flex items-center gap-2.5 flex-shrink-0 group">
      <img src="/traphawk-mark.png" alt="" className="h-7 w-7 object-contain" />
      <span className="text-sm font-bold uppercase tracking-[0.18em] transition-colors">
        <span className="text-signal-pos">Trap</span>
        <span className="text-ink-100 group-hover:text-signal-pos">Hawk</span>
      </span>
    </a>
  )
}

// Sign out for every page header. Shared devices need an exit anywhere,
// not just on the board. Renders nothing for visitors, so it is safe on
// public pages like the ledger.
export function SignOutButton() {
  const { isAuthenticated, signOut } = useAuth()
  if (!isAuthenticated) return null
  return (
    <button onClick={signOut} className="px-3 py-1.5 text-xs text-ink-400 hover:text-white transition-colors flex-shrink-0">
      Sign out
    </button>
  )
}
