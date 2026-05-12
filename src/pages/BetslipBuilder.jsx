import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Link2, ExternalLink, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../config';

// Convert structured digest picks → natural-language string for /api/parse-betslip.
// The parser is LLM-based so we keep it simple ("Lakers ML, Celtics −4.5, Over 220.5").
function picksToMessage(picks) {
  return picks.map(p => p.pick).filter(Boolean).join(', ');
}

const BetslipBuilder = () => {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        "Type your picks — I'll build the slip and hand you the DraftKings/FanDuel deep links. Plain English works.\n\nExamples:\n• \"Chiefs ML and Ravens −6.5\"\n• \"3-leg parlay: Lions, 49ers spread, Bills\"\n• \"Cowboys ML, Eagles under, Mahomes over 2.5 TDs\"",
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

  // Mount-time pickup: the digest's "Build Parlay" sticky bar stages picks in
  // localStorage.digest_parlay_picks. Without this consumer the entire lock-
  // and-build flow on the digest dead-ends here (user sees a chatbot with no
  // awareness of what they just locked). Convert to natural language, render
  // the hand-off in the chat, and auto-call the parser so the user lands on
  // their picks + deep-link buttons without typing.
  useEffect(() => {
    let raw;
    try { raw = localStorage.getItem('digest_parlay_picks'); } catch (e) { return; }
    if (!raw) return;
    let staged;
    try { staged = JSON.parse(raw); } catch (e) { return; }
    if (!Array.isArray(staged) || staged.length === 0) return;

    const message = picksToMessage(staged);
    if (!message) return;

    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: `Locked from your digest: ${staged.length} pick${staged.length !== 1 ? 's' : ''}. Building the slip…`,
        timestamp: new Date()
      },
      {
        role: 'user',
        content: message,
        timestamp: new Date()
      }
    ]);
    sendToParser(message);

    // Consume once — back-nav shouldn't replay.
    try { localStorage.removeItem('digest_parlay_picks'); } catch (e) { /* */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared submit path — used by handleSend (typed) and the digest auto-handoff.
  const sendToParser = async (message) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/parse-betslip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await response.json();
      const botMessage = data.success
        ? {
            role: 'assistant',
            content: data.message,
            picks: data.picks,
            deepLinks: data.deepLinks,
            timestamp: new Date()
          }
        : {
            role: 'assistant',
            content: data.error || "Couldn't parse those picks. Try being more specific — team name + bet type works best.",
            isError: true,
            timestamp: new Date()
          };
      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      console.error('Error parsing betslip:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Connection error. Try again in a moment.',
        isError: true,
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    const message = input.trim();
    setMessages(prev => [...prev, {
      role: 'user',
      content: message,
      timestamp: new Date()
    }]);
    setInput('');
    sendToParser(message);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100 flex flex-col font-sans">
      {/* Header */}
      <div className="bg-ink-900 border-b border-ink-700 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-signal-pos rounded-sharp p-2 flex-shrink-0">
              <Sparkles className="w-5 h-5 text-ink-950" />
            </div>
            <div className="min-w-0">
              <h1 className="font-mono text-base font-semibold uppercase tracking-[0.08em] text-ink-100">Betslip Builder</h1>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 truncate">Picks → DraftKings · FanDuel</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-ink-400 flex-shrink-0">
            <Link2 className="w-3 h-3" />
            <span>Live odds · auto-parsed</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-5">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-sharp px-5 py-3 ${
                msg.role === 'user'
                  ? 'bg-signal-pos text-ink-950'
                  : msg.isError
                    ? 'bg-signal-neg-dim/30 shadow-hairline-neg text-ink-100'
                    : 'bg-ink-900 shadow-hairline text-ink-100'
              }`}>
                <div className={`whitespace-pre-wrap text-sm leading-relaxed ${msg.role === 'user' ? 'font-medium' : ''}`}>
                  {msg.content}
                </div>

                {/* Picks Display */}
                {msg.picks && msg.picks.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {msg.picks.map((pick, i) => (
                      <div key={i} className="bg-ink-850 shadow-hairline rounded-sharp px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-mono font-medium text-ink-100 text-sm truncate">{pick.pick}</div>
                            <div className="font-mono text-[10px] text-ink-400 uppercase tracking-[0.14em] mt-0.5 truncate">
                              {pick.betType} · {pick.game}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="font-mono font-semibold text-signal-pos tabular-nums">{pick.odds}</div>
                            {pick.point && <div className="font-mono text-[10px] text-ink-400 tabular-nums">{pick.point}</div>}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Combined parlay payout — the moment the user is looking for */}
                    {msg.picks.length > 1 && (
                      <div className="bg-ink-850 shadow-hairline-pos rounded-sharp px-3 py-2.5 mt-3">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-300">Combined Parlay</span>
                          <span className="font-mono text-xl font-bold tabular-nums text-signal-pos">{calculateCombinedOdds(msg.picks)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Deep-link buttons — keep DraftKings green / FanDuel blue brand colors */}
                {msg.deepLinks && (
                  <div className="mt-4 space-y-2">
                    {msg.deepLinks.draftkings && (
                      <a
                        href={msg.deepLinks.draftkings}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between bg-[#53d337] hover:bg-[#4ac42d] rounded-sharp px-4 py-3 font-mono font-bold uppercase tracking-[0.10em] text-sm text-ink-950 transition-colors group"
                      >
                        <span className="flex items-center gap-2">
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
                        className="flex items-center justify-between bg-[#1d92e2] hover:bg-[#1684cd] rounded-sharp px-4 py-3 font-mono font-bold uppercase tracking-[0.10em] text-sm text-ink-100 transition-colors group"
                      >
                        <span className="flex items-center gap-2">
                          <ExternalLink className="w-4 h-4" />
                          <span>Open in FanDuel</span>
                        </span>
                        <span className="text-xs opacity-75 group-hover:opacity-100">→</span>
                      </a>
                    )}
                  </div>
                )}

                <div className={`mt-2 font-mono text-[10px] tabular-nums ${msg.role === 'user' ? 'text-ink-950/60' : 'text-ink-500'}`}>
                  {msg.timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-ink-900 shadow-hairline rounded-sharp px-5 py-3">
                <div className="flex items-center gap-2 text-ink-300">
                  <Loader2 className="w-4 h-4 animate-spin text-signal-pos" />
                  <span className="font-mono text-xs uppercase tracking-[0.14em]">Parsing picks…</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Bar */}
      <div className="bg-ink-900 border-t border-ink-700 px-6 py-4 sticky bottom-0 safe-bottom">
        <div className="max-w-4xl mx-auto flex items-end gap-3">
          <div className="flex-1 bg-ink-850 shadow-hairline rounded-sharp focus-within:shadow-hairline-pos transition-shadow">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your picks… (e.g., 'Chiefs ML and Ravens −6.5')"
              className="w-full bg-transparent text-ink-100 placeholder:text-ink-500 px-4 py-3 text-sm resize-none focus:outline-none"
              rows={1}
              disabled={isLoading}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="bg-signal-pos hover:bg-signal-pos/90 disabled:bg-ink-800 disabled:cursor-not-allowed rounded-sharp p-3 transition-colors flex-shrink-0"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-ink-950" />
            ) : (
              <Send className="w-5 h-5 text-ink-950" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// American-odds parlay multiplier: convert each leg → decimal, multiply, convert back.
const calculateCombinedOdds = (picks) => {
  if (!picks || picks.length === 0) return '+0';
  const decimalOdds = picks.map(pick => {
    const odds = parseInt(pick.odds);
    if (odds > 0) return (odds / 100) + 1;
    return (100 / Math.abs(odds)) + 1;
  });
  const combined = decimalOdds.reduce((acc, val) => acc * val, 1);
  const american = combined >= 2 ? Math.round((combined - 1) * 100) : Math.round(-100 / (combined - 1));
  return american > 0 ? `+${american}` : `${american}`;
};

export default BetslipBuilder;
