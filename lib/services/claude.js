/**
 * Shared Anthropic client + chat-completion convenience for every LLM call
 * in the app. Replaces the scattered raw fetch() calls to OpenAI's
 * chat/completions endpoint (migrated 2026-07-11).
 *
 * Model split by workload:
 *  - CHAT / NARRATION (claude-sonnet-5): user-facing chat (De-Genny), game
 *    analysis narration, pick selection. Best speed/intelligence combo.
 *  - JUDGMENT (claude-opus-4-8): post-mortem learning analysis, where
 *    getting the lesson right matters more than latency.
 *  - UTILITY (claude-haiku-4-5): mechanical extraction, parsing, and
 *    summarization. Fast and cheap, no thinking.
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const MODELS = {
  CHAT: 'claude-sonnet-5',
  NARRATION: 'claude-sonnet-5',
  JUDGMENT: 'claude-opus-4-8',
  UTILITY: 'claude-haiku-4-5',
};

let _client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 5 * 60 * 1000, // ms — generous for long narration batches
    });
  }
  return _client;
}

/**
 * Robust JSON extraction from model text. Handles markdown fences, leading
 * prose, and both object and array roots. Returns null when nothing parses.
 */
function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through to slicing */ }
  const firstObj = cleaned.indexOf('{');
  const firstArr = cleaned.indexOf('[');
  const useArr = firstArr !== -1 && (firstObj === -1 || firstArr < firstObj);
  const open = useArr ? '[' : '{';
  const close = useArr ? ']' : '}';
  const start = cleaned.indexOf(open);
  const end = cleaned.lastIndexOf(close);
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

/**
 * Chat-completions-shaped convenience: takes OpenAI-style messages (system
 * entries are hoisted into the Anthropic system param), returns the response
 * text — or a parsed object/array when json: true.
 *
 * Thinking stays off for Sonnet/Opus calls: these migrated call sites were
 * tuned for non-thinking models with small max_tokens budgets, and adaptive
 * thinking would eat the output budget. Haiku runs without thinking anyway.
 */
async function complete({ model = MODELS.UTILITY, system, messages = [], maxTokens = 1000, json = false }) {
  const client = getClient();
  if (!client) throw new Error('Server missing ANTHROPIC_API_KEY');

  const systemParts = [system, ...messages.filter(m => m.role === 'system').map(m => m.content)].filter(Boolean);
  const chatMessages = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));
  if (chatMessages.length === 0) throw new Error('complete() needs at least one user/assistant message');

  const params = {
    model,
    max_tokens: maxTokens,
    messages: chatMessages,
  };
  if (systemParts.length > 0) params.system = systemParts.join('\n\n');
  if (model !== MODELS.UTILITY) params.thinking = { type: 'disabled' };

  const resp = await client.messages.create(params);
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  if (!json) return text;
  return extractJson(text);
}

module.exports = { MODELS, getClient, complete, extractJson };
