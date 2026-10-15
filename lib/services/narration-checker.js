/**
 * Inline narration checker (owner 2026-10-11, build_queue 90, plan of
 * record decision 10). Before each narration write one Haiku 5.5 call
 * reads the draft against the context it was written from (records,
 * numbers, report words, team names) and returns pass or fail with the
 * claims it could not find in the context.
 *
 * SHADOW for two weeks from the ship date: the verdict is logged to
 * narration_checks and no write is blocked. After two weeks the exec
 * assistant brings the shadow numbers to the owner, and only on his go
 * does a failing draft get one rewrite (then the math only) and
 * fact-check-picks get unscheduled.
 *
 * Never throws. A checker failure is logged as verdict error and the
 * narration writes exactly as it would have without the checker.
 */

'use strict';

const { MODELS, extractJson, thinkingOff, estimateCost } = require('./claude.js');

const CHECKER_MODEL = MODELS.UTILITY;

function buildCheckerPrompt(context, draft) {
  return `You are a fact checker for a sports betting research site. A writer produced the DRAFT below from the CONTEXT below. Your only job is to find claims in the draft that the context does not support.

Check every specific claim: win-loss records, scores, streaks, rankings, spreads, totals, prices, player names, injury report words (out, doubtful, questionable), team names and which team is home. A claim is unsupported when the context does not state it or states something different. General handicapping language with no specific fact in it is fine. Do not judge the pick or the writing.

CONTEXT:
${context}

DRAFT:
${draft}

Respond in EXACTLY this JSON format (no markdown):
{"verdict": "pass" or "fail", "issues": [{"claim": "the draft words", "problem": "what the context says instead, or not in context"}]}
Use "pass" with an empty issues list when every specific claim is supported.`;
}

function draftText(result) {
  const factors = Array.isArray(result?.key_factors) ? result.key_factors : [];
  return [result?.analysis_snippet, ...factors.map(f => `- ${f}`)].filter(Boolean).join('\n');
}

function normalizeVerdict(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const verdict = String(parsed.verdict || '').toLowerCase();
  if (verdict !== 'pass' && verdict !== 'fail') return null;
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.filter(i => i && typeof i === 'object').slice(0, 10)
    : [];
  // A fail with nothing named is not actionable, and a pass that names
  // problems is a fail.
  if (verdict === 'fail' && issues.length === 0) return { verdict: 'pass', issues };
  if (verdict === 'pass' && issues.length > 0) return { verdict: 'fail', issues };
  return { verdict, issues };
}

/**
 * Check one draft. Returns { verdict: 'pass' | 'fail' | 'error', issues,
 * model, input_tokens, output_tokens, cost_usd, error }.
 */
async function checkNarration({ client, context, result }) {
  const out = { verdict: 'error', issues: [], model: CHECKER_MODEL, input_tokens: 0, output_tokens: 0, cost_usd: 0, error: null };
  const draft = draftText(result);
  if (!client || !context || !draft) {
    out.error = !client ? 'no client' : !context ? 'no context' : 'no draft';
    return out;
  }
  try {
    const params = {
      model: CHECKER_MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: buildCheckerPrompt(context, draft) }],
    };
    const thinking = thinkingOff(CHECKER_MODEL);
    if (thinking) params.thinking = thinking;
    const data = await client.messages.create(params);
    out.input_tokens = data.usage?.input_tokens || 0;
    out.output_tokens = data.usage?.output_tokens || 0;
    out.cost_usd = Number(estimateCost(CHECKER_MODEL, out.input_tokens, out.output_tokens).toFixed(6));
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const verdict = normalizeVerdict(extractJson(text));
    if (!verdict) {
      out.error = `unparseable checker response: ${text.slice(0, 120)}`;
      return out;
    }
    out.verdict = verdict.verdict;
    out.issues = verdict.issues;
    return out;
  } catch (err) {
    out.error = err.message;
    return out;
  }
}

module.exports = { checkNarration, buildCheckerPrompt, draftText, normalizeVerdict, CHECKER_MODEL };
