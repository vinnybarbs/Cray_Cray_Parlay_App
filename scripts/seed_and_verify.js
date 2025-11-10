#!/usr/bin/env node
// scripts/seed_and_verify.js
// Reads .env.local (if present), triggers /cron/refresh-odds on localhost:5001, then calls /api/generate-parlay and prints metadata

const fs = require('fs');
const path = require('path');
const fetch = global.fetch || require('node-fetch');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

const LOCAL_BASE = process.env.LOCAL_API_BASE || 'http://localhost:5001';
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  console.error('CRON_SECRET not found in environment or .env.local. Aborting.');
  process.exit(1);
}

async function postCron() {
  const url = `${LOCAL_BASE.replace(/\/$/, '')}/cron/refresh-odds`;
  console.log('POST', url);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CRON_SECRET}`
    }
  });

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch(e) { body = text; }
  console.log('Cron response status:', res.status);
  console.log('Cron response body:', body);
  return { status: res.status, body };
}

async function generateParlay() {
  const url = `${LOCAL_BASE.replace(/\/$/, '')}/api/generate-parlay`;
  console.log('POST', url);
  const payload = {
    selectedSports: ['NFL'],
    selectedBetTypes: ['Moneyline/Spread'],
    numLegs: 3,
    oddsPlatform: 'DraftKings',
    riskLevel: 'Medium',
    dateRange: 1
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch(e) { body = text; }
  console.log('Generate-parlay status:', res.status);
  // Print only metadata if present
  if (body && body.metadata) {
    console.log('metadata:', JSON.stringify(body.metadata, null, 2));
  } else {
    console.log('body:', body);
  }
  return { status: res.status, body };
}

(async () => {
  try {
    console.log('Using LOCAL_BASE =', LOCAL_BASE);
    console.log('Using CRON_SECRET (prefix):', CRON_SECRET ? CRON_SECRET.substring(0,8) + '...' : 'MISSING');

    console.log('\n1) Triggering cron to refresh odds cache...');
    const cronResult = await postCron();

    console.log('\n2) Waiting 3s for server processing...');
    await new Promise(r => setTimeout(r, 3000));

    console.log('\n3) Requesting generate-parlay to verify cached usage...');
    const genResult = await generateParlay();

    console.log('\nDone. Review the outputs above for cron response and parlay metadata.');
    process.exit(0);
  } catch (err) {
    console.error('Error during seed_and_verify:', err);
    process.exit(2);
  }
})();
