import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'

// HashRouter, deliberately: the app has always lived at #/digest-style URLs
// (shared links, the digest→betslip localStorage hand-off, Railway static
// serving with no history-fallback config). Real routing with zero URL churn.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
)
