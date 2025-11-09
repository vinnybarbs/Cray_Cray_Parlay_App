import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Render the MainApp (includes Auth + Dashboard + Builder)
import MainApp from './components/MainApp.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  </StrictMode>,
)
