#!/usr/bin/env node
/**
 * Fine-Tune Pipeline for Cray Cray Parlay App
 *
 * Usage:
 *   node scripts/fine-tune.js export      — Export graded picks to JSONL training file
 *   node scripts/fine-tune.js train       — Start fine-tune job on OpenAI
 *   node scripts/fine-tune.js status      — Check fine-tune job status
 *   node scripts/fine-tune.js deploy      — Update ai_instructions with new model ID
 *   node scripts/fine-tune.js all         — Run export + train in sequence
 */

require('dotenv').config({ silent: true });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Try supabaseAuth first (has hardcoded creds), fall back to env vars
let supabase;
try {
  supabase = require('../lib/middleware/supabaseAuth').supabase;
} catch (e) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OUTPUT_DIR = path.join(__dirname, '..', 'training-data');
const TRAINING_FILE = path.join(OUTPUT_DIR, 'picks-training.jsonl');
const BASE_MODEL = 'gpt-4o-mini-2024-07-18';

// ─── Export graded picks to JSONL ────────────────────────────────────────────

async function exportTrainingData() {
  console.log('📊 Exporting graded picks from ai_suggestions...');

  const { data: picks, error } = await supabase
    .from('ai_suggestions')
    .select('sport, home_team, away_team, game_date, bet_type, pick, point, odds, confidence, reasoning, actual_outcome, risk_level, generate_mode')
    .in('actual_outcome', ['won', 'lost'])
    .not('reasoning', 'is', null)
    .order('game_date', { ascending: true });

  if (error) {
    console.error('❌ DB error:', error.message);
    process.exit(1);
  }

  console.log(`  Found ${picks.length} graded picks`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const lines = [];

  for (const pick of picks) {
    // Build the context the model would see when making a pick
    const gameDate = new Date(pick.game_date).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });

    const systemPrompt = `You are a sports betting analyst. Analyze the matchup and make a betting pick. Your goal is to identify real edges, not just pick favorites. Be specific about WHY a pick has value. Rate your confidence 1-10 honestly.`;

    const userPrompt = `Sport: ${pick.sport}
Matchup: ${pick.away_team} @ ${pick.home_team}
Date: ${gameDate}
Bet Type: ${pick.bet_type}
${pick.point ? `Line: ${pick.point}` : ''}
${pick.odds ? `Odds: ${pick.odds}` : ''}

What is your pick and why?`;

    // The "ideal" response — what the model SHOULD have said
    // For wins: reinforce the reasoning
    // For losses: show what went wrong so the model learns to avoid similar patterns
    let assistantResponse;

    if (pick.actual_outcome === 'won') {
      assistantResponse = `PICK: ${pick.pick}${pick.point ? ` (${pick.point})` : ''}
CONFIDENCE: ${pick.confidence}/10
OUTCOME: WON ✅

REASONING: ${pick.reasoning}

This pick hit because the analysis correctly identified the edge.`;
    } else {
      assistantResponse = `PICK: ${pick.pick}${pick.point ? ` (${pick.point})` : ''}
CONFIDENCE: ${pick.confidence}/10
OUTCOME: LOST ❌

REASONING: ${pick.reasoning}

LESSON: This pick lost. The confidence of ${pick.confidence}/10 was ${pick.confidence >= 7 ? 'too high — should have been lower given the risk' : 'appropriately cautious'}. ${pick.bet_type === 'Spread' ? 'Spread picks require stronger data support than moneyline.' : ''} ${pick.confidence >= 8 ? 'Reserve 8+ confidence for picks with multiple confirming data points.' : ''}`;
    }

    lines.push(JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: assistantResponse }
      ]
    }));
  }

  fs.writeFileSync(TRAINING_FILE, lines.join('\n'));
  console.log(`✅ Wrote ${lines.length} training examples to ${TRAINING_FILE}`);

  // Stats
  const won = picks.filter(p => p.actual_outcome === 'won').length;
  const lost = picks.filter(p => p.actual_outcome === 'lost').length;
  const sports = [...new Set(picks.map(p => p.sport))];
  const betTypes = [...new Set(picks.map(p => p.bet_type))];

  console.log(`\n📋 Training Data Summary:`);
  console.log(`  Total examples: ${lines.length}`);
  console.log(`  Won: ${won} (${(won/(won+lost)*100).toFixed(1)}%)`);
  console.log(`  Lost: ${lost} (${(lost/(won+lost)*100).toFixed(1)}%)`);
  console.log(`  Sports: ${sports.join(', ')}`);
  console.log(`  Bet types: ${betTypes.join(', ')}`);
  console.log(`  File size: ${(fs.statSync(TRAINING_FILE).size / 1024).toFixed(1)} KB`);

  return TRAINING_FILE;
}

// ─── Upload file and start fine-tune job ─────────────────────────────────────

async function startFineTune() {
  if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set');
    process.exit(1);
  }

  if (!fs.existsSync(TRAINING_FILE)) {
    console.log('No training file found, exporting first...');
    await exportTrainingData();
  }

  // 1. Upload the training file
  console.log('\n📤 Uploading training file to OpenAI...');

  const formData = new FormData();
  formData.append('purpose', 'fine-tune');
  formData.append('file', new Blob([fs.readFileSync(TRAINING_FILE)]), 'picks-training.jsonl');

  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: formData
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error('❌ Upload failed:', err);
    process.exit(1);
  }

  const uploadData = await uploadRes.json();
  console.log(`✅ File uploaded: ${uploadData.id} (${uploadData.bytes} bytes)`);

  // 2. Start fine-tune job
  console.log(`\n🚀 Starting fine-tune job with ${BASE_MODEL}...`);

  const ftRes = await fetch('https://api.openai.com/v1/fine_tuning/jobs', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      training_file: uploadData.id,
      model: BASE_MODEL,
      suffix: 'cray-cray-picks',
      hyperparameters: {
        n_epochs: 3
      }
    })
  });

  if (!ftRes.ok) {
    const err = await ftRes.text();
    console.error('❌ Fine-tune failed:', err);
    process.exit(1);
  }

  const ftData = await ftRes.json();
  console.log(`✅ Fine-tune job started!`);
  console.log(`  Job ID: ${ftData.id}`);
  console.log(`  Model: ${ftData.model}`);
  console.log(`  Status: ${ftData.status}`);
  console.log(`\nRun 'node scripts/fine-tune.js status' to check progress.`);

  // Save job ID for status checks
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'latest-job.json'),
    JSON.stringify({ jobId: ftData.id, startedAt: new Date().toISOString(), baseModel: BASE_MODEL }, null, 2)
  );

  return ftData;
}

// ─── Check fine-tune job status ──────────────────────────────────────────────

async function checkStatus() {
  const jobFile = path.join(OUTPUT_DIR, 'latest-job.json');
  if (!fs.existsSync(jobFile)) {
    console.error('❌ No job found. Run "node scripts/fine-tune.js train" first.');
    process.exit(1);
  }

  const { jobId } = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  console.log(`🔍 Checking job ${jobId}...`);

  const res = await fetch(`https://api.openai.com/v1/fine_tuning/jobs/${jobId}`, {
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
  });

  const data = await res.json();
  console.log(`\n📋 Fine-Tune Job Status:`);
  console.log(`  Status: ${data.status}`);
  console.log(`  Model: ${data.model}`);
  if (data.fine_tuned_model) {
    console.log(`  ✅ Fine-tuned model: ${data.fine_tuned_model}`);
    console.log(`\n  Ready to deploy! Run: node scripts/fine-tune.js deploy`);

    // Update job file with model ID
    const jobData = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
    jobData.fineTunedModel = data.fine_tuned_model;
    jobData.completedAt = new Date().toISOString();
    fs.writeFileSync(jobFile, JSON.stringify(jobData, null, 2));
  }
  if (data.error) {
    console.log(`  ❌ Error: ${data.error.message}`);
  }
  if (data.trained_tokens) {
    console.log(`  Tokens trained: ${data.trained_tokens}`);
    const estimatedCost = (data.trained_tokens * 0.000003).toFixed(2);
    console.log(`  Estimated cost: ~$${estimatedCost}`);
  }

  return data;
}

// ─── Deploy: save model ID to ai_instructions ────────────────────────────────

async function deploy() {
  const jobFile = path.join(OUTPUT_DIR, 'latest-job.json');
  if (!fs.existsSync(jobFile)) {
    console.error('❌ No job found.');
    process.exit(1);
  }

  const jobData = JSON.parse(fs.readFileSync(jobFile, 'utf8'));

  if (!jobData.fineTunedModel) {
    console.log('Model not ready yet, checking status...');
    const status = await checkStatus();
    if (!status.fine_tuned_model) {
      console.error('❌ Model not ready. Wait for training to complete.');
      process.exit(1);
    }
    jobData.fineTunedModel = status.fine_tuned_model;
  }

  const modelId = jobData.fineTunedModel;
  console.log(`\n🚀 Deploying model: ${modelId}`);

  // Save to ai_instructions so the pre-analyzer can read it
  const { error } = await supabase
    .from('ai_instructions')
    .upsert({
      key: 'fine_tuned_model',
      category: 'system',
      title: 'Fine-Tuned Model ID',
      content: modelId,
      priority: 100,
      active: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });

  if (error) {
    console.error('❌ DB error:', error.message);
    process.exit(1);
  }

  console.log(`✅ Model ID saved to ai_instructions table`);
  console.log(`\n📋 To use in pre-analyzer, update the model constant:`);
  console.log(`   From: 'gpt-4o-mini'`);
  console.log(`   To:   '${modelId}'`);
  console.log(`\n   Or read it dynamically from ai_instructions where key='fine_tuned_model'`);

  return modelId;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const command = process.argv[2] || 'export';

(async () => {
  switch (command) {
    case 'export':
      await exportTrainingData();
      break;
    case 'train':
      await startFineTune();
      break;
    case 'status':
      await checkStatus();
      break;
    case 'deploy':
      await deploy();
      break;
    case 'all':
      await exportTrainingData();
      await startFineTune();
      break;
    default:
      console.log('Usage: node scripts/fine-tune.js [export|train|status|deploy|all]');
  }
})().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
