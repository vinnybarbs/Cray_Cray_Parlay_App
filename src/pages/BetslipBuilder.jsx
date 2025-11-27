import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Link2, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import { API_BASE_URL } from '../config';

const BetslipBuilder = () => {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "👋 Hey! Tell me what bets you want and I'll build your betslip.\n\nExamples:\n• \"Chiefs moneyline and Ravens -6.5\"\n• \"Give me a 3-leg parlay with Lions, 49ers spread, and Bills\"\n• \"I want Cowboys ML, Eagles under, and Mahomes over 2.5 TDs\"",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/parse-betslip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input })
      });

      const data = await response.json();

      if (data.success) {
        const botMessage = {
          role: 'assistant',
          content: data.message,
          picks: data.picks,
          deepLinks: data.deepLinks,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, botMessage]);
      } else {
        const errorMessage = {
          role: 'assistant',
          content: data.error || 'Sorry, I had trouble understanding that. Can you be more specific?',
          isError: true,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error('Error parsing betslip:', error);
      const errorMessage = {
        role: 'assistant',
        content: '❌ Connection error. Please try again.',
        isError: true,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg p-2">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Betslip Builder</h1>
              <p className="text-sm text-slate-400">Natural language → Deep links</p>
            </div>
          </div>
          <div className="hidden md:flex items-center space-x-2 text-xs text-slate-400">
            <Link2 className="w-4 h-4" />
            <span>Powered by AI + Live Odds</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] ${msg.role === 'user' ? 'bg-blue-600' : msg.isError ? 'bg-red-900/30 border border-red-500/50' : 'bg-slate-800'} rounded-2xl px-5 py-3 shadow-lg`}>
                {/* Message Content */}
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {msg.content}
                </div>

                {/* Picks Display */}
                {msg.picks && msg.picks.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {msg.picks.map((pick, i) => (
                      <div key={i} className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-white">{pick.pick}</div>
                            <div className="text-xs text-slate-400">{pick.betType} • {pick.game}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono font-bold text-emerald-400">{pick.odds}</div>
                            {pick.point && <div className="text-xs text-slate-400">{pick.point}</div>}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Combined Odds */}
                    {msg.picks.length > 1 && (
                      <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-lg p-3 border border-purple-500/30 mt-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Combined Parlay Odds</span>
                          <span className="text-lg font-bold text-purple-300">{calculateCombinedOdds(msg.picks)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Deep Links */}
                {msg.deepLinks && (
                  <div className="mt-4 space-y-2">
                    {msg.deepLinks.draftkings && (
                      <a
                        href={msg.deepLinks.draftkings}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between bg-green-600 hover:bg-green-500 rounded-lg px-4 py-3 font-semibold transition-colors group"
                      >
                        <span className="flex items-center space-x-2">
                          <ExternalLink className="w-4 h-4" />
                          <span>Open in DraftKings</span>
                        </span>
                        <span className="text-xs opacity-75 group-hover:opacity-100">→</span>
                      </a>
                    )}
                    {msg.deepLinks.fanduel && (
                      <a
                        href={msg.deepLinks.fanduel}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-3 font-semibold transition-colors group"
                      >
                        <span className="flex items-center space-x-2">
                          <ExternalLink className="w-4 h-4" />
                          <span>Open in FanDuel</span>
                        </span>
                        <span className="text-xs opacity-75 group-hover:opacity-100">→</span>
                      </a>
                    )}
                  </div>
                )}

                {/* Timestamp */}
                <div className="mt-2 text-xs text-slate-500">
                  {msg.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}

          {/* Loading Indicator */}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-slate-800 rounded-2xl px-5 py-3 shadow-lg">
                <div className="flex items-center space-x-2 text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Analyzing picks...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Bar */}
      <div className="bg-slate-800 border-t border-slate-700 px-6 py-4 sticky bottom-0">
        <div className="max-w-4xl mx-auto flex items-end space-x-3">
          <div className="flex-1 bg-slate-900 rounded-xl border border-slate-700 focus-within:border-blue-500 transition-colors">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your picks... (e.g., 'Chiefs ML and Ravens -6.5')"
              className="w-full bg-transparent px-4 py-3 text-sm resize-none focus:outline-none"
              rows={1}
              disabled={isLoading}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-xl p-3 transition-colors"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Helper function to calculate combined parlay odds
const calculateCombinedOdds = (picks) => {
  if (!picks || picks.length === 0) return '+0';
  
  // Convert American odds to decimal, multiply, convert back
  const decimalOdds = picks.map(pick => {
    const odds = parseInt(pick.odds);
    if (odds > 0) {
      return (odds / 100) + 1;
    } else {
      return (100 / Math.abs(odds)) + 1;
    }
  });
  
  const combined = decimalOdds.reduce((acc, val) => acc * val, 1);
  const american = combined >= 2 ? Math.round((combined - 1) * 100) : Math.round(-100 / (combined - 1));
  
  return american > 0 ? `+${american}` : `${american}`;
};

export default BetslipBuilder;
