#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const file = path.resolve(process.cwd(), '.env.local');
if (!fs.existsSync(file)) {
  console.error('.env.local not found');
  process.exit(2);
}

const raw = fs.readFileSync(file, 'utf8');
const lines = raw.split(/\r?\n/);

function parseValue(line) {
  const idx = line.indexOf('=');
  if (idx === -1) return null;
  return line.slice(idx + 1);
}

function mask(s) {
  if (s == null) return null;
  const trimmed = s.trim();
  const len = trimmed.length;
  if (len <= 8) return '*'.repeat(len);
  return `${trimmed.slice(0,8)}...${trimmed.slice(-8)}`;
}

function hexSnippet(s, n=8) {
  if (s == null) return null;
  const buf = Buffer.from(s, 'utf8');
  const start = buf.slice(0, n).toString('hex');
  const end = buf.slice(Math.max(0, buf.length-n)).toString('hex');
  return { start, end, length: buf.length };
}

const keysToCheck = ['OPENAI_API_KEY','ODDS_API_KEY'];
const results = {};

for (const key of keysToCheck) {
  const line = lines.find(l => l.startsWith(key + '='));
  const rawVal = line ? parseValue(line) : null;
  const hasQuotes = rawVal ? (/^".*"$/.test(rawVal) || /^'.*'$/.test(rawVal)) : false;
  const trimmed = rawVal ? rawVal.trim().replace(/^['\"]|['\"]$/g, '') : null;
  results[key] = {
    present: !!rawVal,
    masked: mask(trimmed),
    length: trimmed ? trimmed.length : 0,
    hasQuotes,
    hex: trimmed ? hexSnippet(trimmed) : null,
  };
}

console.log('Inspecting .env.local (masked outputs):');
for (const k of keysToCheck) {
  const r = results[k];
  console.log(`- ${k}: present=${r.present}, masked=${r.masked}, length=${r.length}, hasQuotes=${r.hasQuotes}`);
  if (r.hex) console.log(`  hex start=${r.hex.start} end=${r.hex.end} bytes=${r.hex.length}`);
}

// Also show any suspicious leading/trailing garbage in file
const firstNonEmpty = lines.find(l => l.trim().length > 0);
const lastNonEmpty = [...lines].reverse().find(l => l.trim().length > 0);
console.log('\nFirst non-empty line:', firstNonEmpty);
console.log('Last non-empty line:', lastNonEmpty);
