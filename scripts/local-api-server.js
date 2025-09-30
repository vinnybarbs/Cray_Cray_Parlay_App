#!/usr/bin/env node
/*
  Local dev server to mount serverless handlers under /api for testing.
  Usage: node scripts/local-api-server.js
  Loads .env.local via dotenv.
*/
import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env.local (if present)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));

// import the serverless handler
const handlerModule = await import(path.resolve(__dirname, '../api/generate-parlay.js'));
const handler = handlerModule.default;

app.post('/api/generate-parlay', async (req, res) => {
  try {
    // Adapt Express req/res to the serverless handler
    await handler(req, res);
  } catch (err) {
    console.error('local-api-server handler error:', err);
    res.status(500).json({ error: err.message || 'local server error' });
  }
});

const port = process.env.LOCAL_API_PORT || 8787;
app.listen(port, () => {
  console.log(`Local API server listening on http://localhost:${port}`);
  console.log('Using env keys present:', {
    OPENAI_KEY: !!process.env.OPENAI_API_KEY,
    GEMINI_KEY: !!process.env.GEMINI_API_KEY,
    ODDS_KEY: !!process.env.ODDS_API_KEY,
  });
});
