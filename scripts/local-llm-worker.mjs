#!/usr/bin/env node
/**
 * Local LLM worker for the llm_jobs queue.
 *
 * Runs on the owner's MacBook against a local Ollama model, so deferrable
 * LLM work (post-mortem learning analysis first) costs zero API dollars.
 * Railway enqueues jobs into llm_jobs; this script claims them one at a
 * time, generates with the local model, writes the result back to the
 * target row, and marks the job done. The Mac being asleep just means
 * the queue waits.
 *
 * One-time setup on the Mac:
 *   1. Install Ollama: https://ollama.com/download (or `brew install ollama`)
 *   2. Pull a model:   ollama pull qwen2.5:14b   (8GB Macs: qwen2.5:7b)
 *   3. Env vars (put them in ~/.traphawk-worker.env and `source` it, or
 *      export in your shell profile):
 *        export SUPABASE_URL=...            (project URL)
 *        export SUPABASE_SERVICE_ROLE_KEY=... (service role key)
 *        export OLLAMA_MODEL=qwen2.5:14b    (optional, this is the default)
 *   4. Run it:  node scripts/local-llm-worker.mjs          (drain and exit)
 *               node scripts/local-llm-worker.mjs --watch  (keep polling)
 *
 * To run automatically whenever the Mac is awake, load a launchd job:
 *   ~/Library/LaunchAgents/io.traphawk.llmworker.plist with
 *   ProgramArguments [node, /path/to/scripts/local-llm-worker.mjs],
 *   StartInterval 900, and the env vars in EnvironmentVariables.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:14b';
const WATCH = process.argv.includes('--watch');
const POLL_MS = 15000;
const MAX_ATTEMPTS = 3;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function ollamaGenerate(system, prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  const text = data?.message?.content?.trim();
  if (!text) throw new Error('Empty response from local model');
  return text;
}

// Claim the oldest queued job. Single-worker design: the conditional
// update is the lock (status must still be queued when we claim).
async function claimJob() {
  const { data: rows, error } = await supabase
    .from('llm_jobs')
    .select('id, kind, payload, attempts')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error || !rows || rows.length === 0) return null;
  const job = rows[0];
  const { data: claimed, error: cErr } = await supabase
    .from('llm_jobs')
    .update({ status: 'running', claimed_at: new Date().toISOString(), attempts: job.attempts + 1 })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('id');
  if (cErr || !claimed || claimed.length === 0) return null; // someone else got it
  return job;
}

async function finishJob(id, fields) {
  await supabase.from('llm_jobs')
    .update({ ...fields, completed_at: new Date().toISOString() })
    .eq('id', id);
}

async function handlePostMortem(job) {
  const { pick_id, system, prompt } = job.payload || {};
  if (!pick_id || !prompt) throw new Error('post_mortem payload missing pick_id or prompt');
  const text = await ollamaGenerate(system, prompt);
  const { error } = await supabase
    .from('ai_suggestions')
    .update({
      post_analysis: text,
      lessons_learned: { source: 'local-llm', model: OLLAMA_MODEL },
      analyzed_at: new Date().toISOString(),
    })
    .eq('id', pick_id);
  if (error) throw new Error(`ai_suggestions write failed: ${error.message}`);
  return { chars: text.length };
}

const HANDLERS = { post_mortem: handlePostMortem };

async function drainOnce() {
  let processed = 0;
  for (;;) {
    const job = await claimJob();
    if (!job) break;
    const handler = HANDLERS[job.kind];
    try {
      if (!handler) throw new Error(`No handler for kind ${job.kind}`);
      const result = await handler(job);
      await finishJob(job.id, { status: 'done', result });
      processed++;
      console.log(`✓ job ${job.id} (${job.kind})`);
    } catch (err) {
      const dead = job.attempts + 1 >= MAX_ATTEMPTS;
      await finishJob(job.id, {
        status: dead ? 'failed' : 'queued',
        error: String(err.message || err).slice(0, 500),
      });
      console.error(`✗ job ${job.id} (${job.kind}): ${err.message}${dead ? ' [failed permanently]' : ' [requeued]'}`);
    }
  }
  return processed;
}

const n = await drainOnce();
console.log(`Drained ${n} job${n === 1 ? '' : 's'}.`);
if (WATCH) {
  console.log(`Watching queue every ${POLL_MS / 1000}s (${OLLAMA_MODEL} via ${OLLAMA_URL})...`);
  setInterval(drainOnce, POLL_MS);
}
