import React, { useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Landing from './pages/Landing'
import Auth from './components/Auth'
import DailyDigest from './pages/DailyDigest'
import GeneratorPage from './pages/GeneratorPage'
import ChatPicks from './pages/ChatPicks'
import ResultsPage from './pages/ResultsPage'
import AdminDashboard from './pages/AdminDashboard'
import HouseLedger from './pages/HouseLedger'

// App-level router. HashRouter (mounted in main.jsx) keeps every pre-existing
// #/digest-style URL working unchanged. The old MainApp flag-and-overlay
// navigation is gone — browser Back/Forward now work everywhere.

// While AuthContext hydrates the Supabase session, isAuthenticated is briefly
// false — which would flash Landing (or bounce a deep link) for a returning
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
// signups — the digest. That closes audit-40 funnel leak #1.
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

function ChatRoute() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-ink-950">
      <ChatPicks onBack={() => navigate('/digest')} />
    </div>
  )
}

function ResultsRoute() {
  const navigate = useNavigate()
  return <ResultsPage onBack={() => navigate('/digest')} />
}

function AdminRoute() {
  const navigate = useNavigate()
  return <AdminDashboard onBack={() => navigate('/digest')} />
}

export default function App() {
  const { loading: authLoading } = useAuth()

  if (authLoading) return <Splash />

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/digest" element={<DigestRoute />} />
      <Route path="/generator" element={<GeneratorPage />} />
      <Route path="/chat" element={<ChatRoute />} />
      <Route path="/results" element={<ResultsRoute />} />
      {/* The House Ledger is deliberately public — it IS the marketing. */}
      <Route path="/ledger" element={<HouseLedger />} />
      <Route path="/admin" element={<AdminRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
