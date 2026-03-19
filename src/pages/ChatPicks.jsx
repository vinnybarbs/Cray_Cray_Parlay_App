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
      <div className="flex justify-end mb-4">
        <div className="bg-yellow-600 text-white rounded-2xl rounded-br-sm px-4 py-3 max-w-[85%] text-sm leading-relaxed">
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start mb-4">
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
  const [conversationHistory, setConversationHistory] = useState([])
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return

    const userMessage = { role: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

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
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    sendMessage(input)
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm">
          &larr; Back
        </button>
        <h1 className="text-lg font-bold bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
          Ask the Degen AI
        </h1>
        <div className="w-12" />
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="text-center mt-8">
            <div className="text-4xl mb-4">🎰</div>
            <h2 className="text-xl font-bold text-gray-300 mb-2">What are you feeling?</h2>
            <p className="text-gray-500 text-sm mb-6">
              Tell me what you're looking for and I'll search our database for the best plays.
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
              {STARTERS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s)}
                  className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700 hover:border-yellow-500 transition-colors"
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
          <div className="flex justify-start mb-4">
            <div className="bg-gray-800 border border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 py-3 bg-gray-800 border-t border-gray-700">
        <div className="flex gap-2 max-w-2xl mx-auto">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about odds, picks, matchups..."
            disabled={loading}
            className="flex-1 bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-yellow-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="px-5 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white font-bold rounded-xl text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:from-yellow-600 hover:to-orange-600 transition-colors"
          >
            Send
          </button>
        </div>
        <p className="text-center text-gray-600 text-xs mt-2">For entertainment only. Gamble responsibly.</p>
      </form>
    </div>
  )
}
