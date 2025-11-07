import React, { useState } from 'react'
import ParlayBuilderApp from './components/ParlayBuilderApp'
import AppLegacy from './AppLegacy'

export default function App() {
  const [useNewUI, setUseNewUI] = useState(true)

  return (
    <div>
      {/* Toggle Button */}
      <div className="fixed top-4 right-4 z-50">
        <button
          onClick={() => setUseNewUI(!useNewUI)}
          className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg shadow-lg border border-gray-600 text-sm font-semibold"
        >
          {useNewUI ? '🔄 Switch to Legacy' : '🔄 Switch to New Builder'}
        </button>
      </div>

      {/* Render appropriate UI */}
      {useNewUI ? <ParlayBuilderApp /> : <AppLegacy />}
    </div>
  )
}
