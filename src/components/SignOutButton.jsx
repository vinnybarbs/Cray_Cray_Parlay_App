import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

// Persistent sign-out affordance. Every page's top nav renders this at the
// far right, so logging out never requires hunting for the one page that has
// the button. Renders nothing for anonymous visitors, which lets public pages
// (Ledger) include it unconditionally. After sign-out we navigate home
// explicitly: routes aren't auth-guarded, so without it the user would stay
// on a member page with dead data instead of seeing the landing page.
export default function SignOutButton({ className = '' }) {
  const { isAuthenticated, signOut } = useAuth()
  const navigate = useNavigate()
  if (!isAuthenticated) return null

  const handleSignOut = async () => {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <button
      onClick={handleSignOut}
      className={`px-3 py-1.5 text-xs font-semibold bg-ink-900 hover:bg-ink-800 text-ink-400 hover:text-ink-100 rounded-sharp border border-ink-700 transition-colors active:scale-95 ${className}`}
    >
      Sign out
    </button>
  )
}
