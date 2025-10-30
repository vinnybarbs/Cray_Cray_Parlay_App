#!/usr/bin/env node
// Check which API keys are configured
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

console.log('\n🔑 API Key Configuration Check\n');
console.log('=' .repeat(60));

const keys = {
  'ODDS_API_KEY': process.env.ODDS_API_KEY,
  'SERPER_API_KEY': process.env.SERPER_API_KEY,
  'OPENAI_API_KEY': process.env.OPENAI_API_KEY,
  'APISPORTS_API_KEY': process.env.APISPORTS_API_KEY || process.env.API_SPORTS_KEY
};

let allConfigured = true;
let missingKeys = [];

Object.entries(keys).forEach(([name, value]) => {
  const status = value ? '✅ Configured' : '❌ Missing';
  const preview = value ? `(${value.substring(0, 8)}...)` : '';
  console.log(`${status} ${name} ${preview}`);
  
  if (!value) {
    allConfigured = false;
    missingKeys.push(name);
  }
});

console.log('=' .repeat(60));

if (!allConfigured) {
  console.log('\n⚠️  Missing API Keys:');
  missingKeys.forEach(key => {
    console.log(`   - ${key}`);
  });
  console.log('\n💡 To fix:');
  console.log('   1. Copy env.example to .env');
  console.log('   2. Add your API keys to .env');
  console.log('   3. Restart the server\n');
} else {
  console.log('\n✅ All API keys configured!\n');
}

// Check specifically for research capability
console.log('\n📊 Feature Status:\n');
console.log(`   Odds Data: ${keys.ODDS_API_KEY ? '✅ Enabled' : '❌ Disabled'}`);
console.log(`   External Research (Serper): ${keys.SERPER_API_KEY ? '✅ Enabled' : '❌ Disabled - No research will be performed'}`);
console.log(`   AI Analysis (OpenAI): ${keys.OPENAI_API_KEY ? '✅ Enabled' : '❌ Disabled'}`);
console.log(`   Player Verification: ${keys.APISPORTS_API_KEY ? '✅ Enabled' : '❌ Disabled - Player props may have errors'}`);
console.log('');
