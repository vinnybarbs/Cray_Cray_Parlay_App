import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabaseClient'

export default function Auth({ onClose }) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Signup succeeded but Supabase requires email confirmation — the user has
  // no session yet. Closing the modal here silently dropped them back on the
  // landing page with no explanation (audit 40, funnel leak 2).
  const [confirmationSent, setConfirmationSent] = useState(false)
  const { signIn, signUp } = useAuth()

  const handleGoogleSignIn = async () => {
    if (!supabase) {
      setError('Authentication not configured')
      return
    }

    try {
      // The OAuth round trip must return to wherever the app is actually
      // served — origin covers localhost and production alike.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`
        }
      })

      if (error) {
        setError(error.message)
      }
      // User will be redirected to Google, then back to app
    } catch (err) {
      setError(err.message)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { data, error } = isSignUp
        ? await signUp(email, password)
        : await signIn(email, password)

      if (error) {
        setError(error.message)
      } else if (isSignUp && data && !data.session) {
        // Account created, confirmation email pending — no session until the
        // user clicks the link. Show them what to do instead of vanishing.
        setConfirmationSent(true)
      } else {
        if (onClose) onClose()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (confirmationSent) {
    return (
      <div className="fixed inset-0 bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-ink-900 rounded-sharp shadow-hairline p-8 max-w-md w-full mx-4 text-center">
          <div className="text-3xl mb-4">📬</div>
          <h2 className="font-mono text-xl font-semibold uppercase tracking-[0.08em] text-ink-100 mb-3">
            Check your email
          </h2>
          <p className="text-sm text-ink-300 leading-relaxed mb-2">
            We sent a confirmation link to
          </p>
          <p className="font-mono text-sm text-signal-pos mb-4 break-all">{email}</p>
          <p className="text-xs text-ink-400 leading-relaxed mb-6">
            Click the link to activate your account, then come back and sign
            in. If it isn't in your inbox within a minute, check spam.
          </p>
          <button
            onClick={onClose}
            className="w-full bg-ink-800 shadow-hairline text-ink-100 py-2 px-4 rounded-sharp hover:bg-ink-700 font-mono font-medium uppercase tracking-[0.12em] text-sm transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-ink-900 rounded-sharp shadow-hairline p-8 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-mono text-xl font-semibold uppercase tracking-[0.08em] text-ink-100">
            {isSignUp ? 'Create Account' : 'Sign In'}
          </h2>
          {onClose && (
            <button
              onClick={onClose}
              className="text-ink-400 hover:text-ink-100 font-mono"
            >
              ✕
            </button>
          )}
        </div>

        {/* Google Sign In */}
        <button
          onClick={handleGoogleSignIn}
          className="w-full bg-ink-800 shadow-hairline text-ink-100 py-2 px-4 rounded-sharp hover:bg-ink-700 font-mono font-medium text-sm flex items-center justify-center gap-2 mb-4 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-ink-700"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-ink-900 text-ink-400">Or continue with email</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-300 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-ink-850 shadow-hairline rounded-sharp text-ink-100 font-mono text-sm placeholder:text-ink-500 focus:outline-none focus:shadow-hairline-bright focus:ring-1 focus:ring-signal-pos transition-shadow"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-300 mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2 bg-ink-850 shadow-hairline rounded-sharp text-ink-100 font-mono text-sm placeholder:text-ink-500 focus:outline-none focus:shadow-hairline-bright focus:ring-1 focus:ring-signal-pos transition-shadow"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="text-signal-neg text-sm bg-signal-neg-dim/30 shadow-hairline-neg p-3 rounded-sharp font-mono">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-signal-pos text-ink-950 py-2 px-4 rounded-sharp hover:bg-signal-pos/90 disabled:opacity-50 disabled:cursor-not-allowed font-mono font-bold uppercase tracking-[0.12em] text-sm"
          >
            {loading ? 'Loading...' : isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => {
              setIsSignUp(!isSignUp)
              setError('')
            }}
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-signal-pos/80 hover:text-signal-pos"
          >
            {isSignUp 
              ? 'Already have an account? Sign in' 
              : "Don't have an account? Sign up"}
          </button>
        </div>

      </div>
    </div>
  )
}
