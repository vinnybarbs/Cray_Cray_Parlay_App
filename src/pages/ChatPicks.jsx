import React, { useState, useRef, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://craycrayparlayapp-production.up.railway.app'

const STARTERS = [
  "What NCAAB games are on tonight?",
  "Give me 3 safe moneyline picks for today",
  "Who's the best underdog value in the NBA?",
  "Build me a 4-leg parlay with good value",
  "How has the AI model been performing lately?",
  "What's the best bet for March Madness tonight?"
]

function ChatMessage({ role, content }) {
  if (role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div className="bg-yellow-600 text-white rounded-2xl rounded-br-sm px-4 py-3 max-w-[80%] text-sm leading-relaxed">
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start mb-3">
      <div className="bg-gray-800 border border-gray-700 text-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    </div>
  )
}

export default function ChatPicks({ onBack }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingPhase, setLoadingPhase] = useState(0)
  const [conversationHistory, setConversationHistory] = useState([])
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const scrollContainerRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return

    const userMessage = { role: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setLoadingPhase(0)
    const phaseInterval = setInterval(() => {
      setLoadingPhase(p => p < 5 ? p + 1 : p)
    }, 2500)

    // Blur input on mobile to dismiss keyboard after send
    if (window.innerWidth < 768) {
      inputRef.current?.blur()
    }

    try {
      const response = await fetch(`${API_BASE}/api/chat-picks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [userMessage],
          conversationHistory
        })
      })

      const data = await response.json()

      if (data.success) {
        const assistantMessage = { role: 'assistant', content: data.message }
        setMessages(prev => [...prev, assistantMessage])
        setConversationHistory(prev => [...prev, userMessage, assistantMessage])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, something went wrong: ${data.error}` }])
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Connection error: ${err.message}` }])
    } finally {
      setLoading(false)
      clearInterval(phaseInterval)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    sendMessage(input)
  }

  return (
    <div className="flex flex-col" style={{ height: '100dvh', minHeight: '100dvh' }}>
      {/* Header - big tap target for back */}
      <header className="flex-shrink-0 flex items-center px-3 py-2 bg-gray-800 border-b border-gray-700 safe-top">
        <button
          onClick={onBack}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white text-xl transition-colors"
          aria-label="Go back"
        >
          &larr;
        </button>
        <h1 className="flex-1 text-center text-base font-bold bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent pr-10">
          Try asking De-Genny anything!
        </h1>
      </header>

      {/* Messages - scrollable area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {messages.length === 0 && (
          <div className="text-center mt-6">
            <div className="text-4xl mb-3">🎰</div>
            <h2 className="text-lg font-bold text-gray-300 mb-2">What are you feeling?</h2>
            <p className="text-gray-500 text-sm mb-5">
              Tell me what you're looking for and I'll search our database for the best plays.
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto px-2">
              {STARTERS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s)}
                  className="px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700 active:bg-gray-600 hover:border-yellow-500 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <ChatMessage key={i} role={msg.role} content={msg.content} />
        ))}

        {loading && (
          <div className="flex justify-start mb-3">
            <div className="bg-gray-800 border border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3 max-w-[85%]">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs font-semibold text-yellow-400">De-Genny is researching...</span>
              </div>
              <div className="space-y-0.5 text-[10px] text-gray-400">
                {loadingPhase >= 0 && <div className="flex items-center gap-1"><span className="text-green-400">✓</span> Searching odds database</div>}
                {loadingPhase >= 1 && <div className="flex items-center gap-1"><span className="text-green-400">✓</span> Checking injury reports</div>}
                {loadingPhase >= 2 && <div className="flex items-center gap-1"><span className="text-green-400">✓</span> Pulling recent scores & standings</div>}
                {loadingPhase >= 3 && <div className="flex items-center gap-1"><span className="text-green-400">✓</span> Reading news & analysis</div>}
                {loadingPhase >= 4 && <div className="flex items-center gap-1"><span className="text-yellow-400 animate-pulse">◉</span> Forming picks from intel...</div>}
                {loadingPhase >= 5 && <div className="flex items-center gap-1"><span className="text-yellow-400 animate-pulse">◉</span> Almost done...</div>}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input - pinned to bottom, respects mobile keyboard */}
      <form onSubmit={handleSubmit} className="flex-shrink-0 px-3 py-2 bg-gray-800 border-t border-gray-700 safe-bottom">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about odds, picks, matchups..."
            disabled={loading}
            autoComplete="off"
            className="flex-1 min-w-0 bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 text-base text-white placeholder-gray-400 focus:outline-none focus:border-yellow-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="flex-shrink-0 px-5 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white font-bold rounded-xl text-sm disabled:opacity-50 disabled:cursor-not-allowed active:from-yellow-700 active:to-orange-700 transition-colors"
          >
            Send
          </button>
        </div>
        <p className="text-center text-gray-600 text-xs mt-1">For entertainment only. Gamble responsibly.</p>
      </form>
    </div>
  )
}
