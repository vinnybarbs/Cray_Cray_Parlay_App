#!/usr/bin/env node
/**
 * Verify deployed Railway backend is working.
 * Tests:
 * 1. Health check
 * 2. Trigger cron (seed odds cache)
 * 3. Generate parlay and verify cached usage
 */

const RAILWAY_URL = process.env.RAILWAY_URL || 'https://craycrayparlayapp-production.up.railway.app';
const CRON_SECRET = process.env.CRON_SECRET || 'dev-secret';

async function verify() {
  console.log(`\n🚀 Verifying Railway deployment at ${RAILWAY_URL}\n`);

  try {
    // 1. Health check
    console.log('1️⃣  Testing /api/health...');
    const healthRes = await fetch(`${RAILWAY_URL}/api/health`);
    if (!healthRes.ok) {
      console.error(`❌ Health check failed: ${healthRes.status}`);
      return;
    }
    const healthData = await healthRes.json();
    console.log('✅ Health check passed:', JSON.stringify(healthData, null, 2));

    // 2. Trigger cron
    console.log('\n2️⃣  Triggering /cron/refresh-odds...');
    const cronRes = await fetch(`${RAILWAY_URL}/cron/refresh-odds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': CRON_SECRET
      },
      body: JSON.stringify({})
    });
    if (!cronRes.ok) {
      console.warn(`⚠️  Cron returned ${cronRes.status} (may be expected if CRON_SECRET mismatch)`);
      const text = await cronRes.text();
      console.log('Response:', text.substring(0, 200));
    } else {
      const cronData = await cronRes.json();
      console.log('✅ Cron triggered:', JSON.stringify(cronData, null, 2));
    }

    // 3. Generate parlay and check metadata
    console.log('\n3️⃣  Generating parlay and checking cache usage...');
    const genRes = await fetch(`${RAILWAY_URL}/api/generate-parlay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        numLegs: 3,
        riskLevel: 'Medium',
        selectedSports: ['NFL'],
        selectedBetTypes: ['Moneyline/Spread'],
        oddsPlatform: 'DraftKings',
        dateRange: 1
      })
    });
    if (!genRes.ok) {
      console.error(`❌ Generate-parlay failed: ${genRes.status}`);
      const text = await genRes.text();
      console.log('Response:', text.substring(0, 300));
      return;
    }
    const genData = await genRes.json();
    const metadata = genData.metadata || {};
    console.log('✅ Generate-parlay succeeded');
    console.log('   Metadata:', JSON.stringify(metadata, null, 2));

    if (metadata.fallbackUsed === false) {
      console.log('   ✅ Cache was used (fallbackUsed: false)');
    } else if (metadata.fallbackUsed === true) {
      console.log('   ⚠️  Fallback was used (odds_cache may be empty; run cron to seed it)');
    }

    console.log('\n✨ Verification complete!\n');
  } catch (err) {
    console.error('❌ Error during verification:', err.message);
  }
}

verify();
