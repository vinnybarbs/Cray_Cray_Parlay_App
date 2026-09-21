import React, { useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Landing from './pages/Landing'
import Auth from './components/Auth'
import DailyDigest from './pages/DailyDigest'
import GeneratorPage from './pages/GeneratorPage'
import AdminDashboard from './pages/AdminDashboard'
import DialsDashboard from './pages/DialsDashboard'
import HouseLedger from './pages/HouseLedger'

// App-level router. HashRouter (mounted in main.jsx) keeps every pre-existing
// #/digest-style URL working unchanged. The old MainApp flag-and-overlay
// navigation is gone. Browser Back/Forward now work everywhere.

// While AuthContext hydrates the Supabase session, isAuthenticated is briefly
// false, which would flash Landing (or bounce a deep link) for a returning
// user. Block every route behind a minimal splash until auth resolves.
function Splash() {
  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.20em] text-ink-400 flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-signal-pos animate-pulse" />
        Loading
      </div>
    </div>
  )
}

// Root: marketing landing for visitors, digest for members. Because this is
// a plain redirect on auth state (not a sign-in-transition listener), Google
// OAuth's full-redirect round trip gets the same first screen as email
// signups, the digest. That closes audit-40 funnel leak #1.
function Home() {
  const { isAuthenticated } = useAuth()
  const [showAuth, setShowAuth] = useState(false)

  if (isAuthenticated) return <Navigate to="/digest" replace />

  return (
    <>
      <Landing
        onStartTrial={() => setShowAuth(true)}
        onSignIn={() => setShowAuth(true)}
      />
      {showAuth && <Auth onClose={() => setShowAuth(false)} />}
    </>
  )
}

function DigestRoute() {
  const navigate = useNavigate()
  // The digest is home. Its "Full Pick Generator" CTA (the onBack prop) is a
  // forward navigation, not an escape hatch.
  return <DailyDigest onBack={() => navigate('/generator')} />
}

// De-Genny chat is off since 2026-09-21 (owner). The page and the API
// stay in the repo; this route says so and sends people back to the
// board. Restore by rendering ChatPicks here and setting DEGENNY_CHAT=on.
function ChatRoute() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-ink-900 rounded-sharp shadow-hairline p-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-500 mb-3">De-Genny</p>
        <h1 className="text-xl font-semibold text-ink-100 mb-2">Chat is off for now</h1>
        <p className="text-sm text-ink-400 mb-6">The board and the ledger carry every pick and every grade. Chat comes back when there is something behind it worth the cost.</p>
        <button onClick={() => navigate('/digest')} className="px-5 py-2.5 bg-signal-pos hover:bg-signal-pos/90 rounded-sharp font-mono font-bold uppercase tracking-[0.12em] text-xs text-ink-950 transition-all active:scale-[0.98]">Back to the board</button>
      </div>
    </div>
  )
}

function AdminRoute() {
  const navigate = useNavigate()
  return <AdminDashboard onBack={() => navigate('/digest')} />
}

export default function App() {
  const { loading: authLoading } = useAuth()

  if (authLoading) return <Splash />

  return <AppRoutes />
}

// The brand mark lives inside each page's own sticky header
// (components/BrandMark.jsx), not a second app-level banner. Vince:
// one banner, not two.
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/digest" element={<DigestRoute />} />
      <Route path="/generator" element={<GeneratorPage />} />
      <Route path="/chat" element={<ChatRoute />} />
      {/* The old Results page is gone. The House Ledger IS the results
          surface now, so stale bookmarks land there. */}
      <Route path="/results" element={<Navigate to="/ledger" replace />} />
      {/* The House Ledger is deliberately public. It IS the marketing. */}
      <Route path="/ledger" element={<HouseLedger />} />
      <Route path="/admin" element={<AdminRoute />} />
      <Route path="/admin/dials" element={<DialsDashboard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
