#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';
import fetch from 'node-fetch';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('OPENAI_API_KEY not set in .env.local');
  process.exit(2);
}

async function main(){
  try{
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    const text = await res.text();
    console.log('OpenAI status:', res.status);
    try{ const json = JSON.parse(text); console.log('Models (first 8 chars):', (json.data||[]).slice(0,5).map(m => m.id?.slice(0,40))); }catch(e){ console.log('Response text:', text.slice(0,400)); }
  }catch(err){
    console.error('OpenAI request failed:', err.message||err);
  }
}

main();
