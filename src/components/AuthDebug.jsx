import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export const AuthDebug = () => {
  const [debugInfo, setDebugInfo] = useState({})

  useEffect(() => {
    setDebugInfo({
      windowOrigin: window.location.origin,
      windowLocation: window.location.href,
      supabaseConfigured: !!supabase,
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      nodeEnv: import.meta.env.NODE_ENV || 'development'
    })
  }, [])

  return (
    <div className="p-4 bg-gray-100 rounded-lg max-w-md">
      <h3 className="font-bold mb-2">🔍 Auth Debug Info</h3>
      <div className="space-y-1 text-sm">
        <div><strong>Window Origin:</strong> {debugInfo.windowOrigin}</div>
        <div><strong>Current URL:</strong> {debugInfo.windowLocation}</div>
        <div><strong>Supabase Configured:</strong> {debugInfo.supabaseConfigured ? '✅' : '❌'}</div>
        <div><strong>Supabase URL:</strong> {debugInfo.supabaseUrl}</div>
        <div><strong>Environment:</strong> {debugInfo.nodeEnv}</div>
        
        <div className="mt-3 p-2 bg-blue-50 rounded">
          <strong>Expected OAuth Redirect URLs:</strong>
          <div className="text-xs mt-1">
            • http://localhost:3001/ (development)
            <br />
            • https://your-app.vercel.app/ (production)
          </div>
        </div>
      </div>
    </div>
  )
}