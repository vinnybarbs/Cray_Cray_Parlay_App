#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';
import fetch from 'node-fetch';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error('GEMINI_API_KEY not set in .env.local');
  process.exit(2);
}

async function main(){
  try{
    const url = `https://generativelanguage.googleapis.com/v1/models?key=${key}`;
    const res = await fetch(url);
    const text = await res.text();
    console.log('Gemini models list status:', res.status);
    try{ const json = JSON.parse(text); console.log('Model count:', (json.models||[]).length, 'Sample:', (json.models||[]).slice(0,5).map(m=>m.name)); }catch(e){ console.log('Response text:', text.slice(0,400)); }
  }catch(err){
    console.error('Gemini request failed:', err.message||err);
  }
}

main();
