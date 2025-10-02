// Check whether dotenv loads VITE_ env vars (prints booleans, no secrets)
require('dotenv').config();
const keys = ['VITE_OPENAI_API_KEY','VITE_GEMINI_API_KEY','VITE_ODDS_API_KEY','VITE_TEST_VARIABLE'];
console.log('Process.cwd():', process.cwd());
keys.forEach(k => console.log(k + ':', !!process.env[k]));
console.log('All VITE keys in env:', Object.keys(process.env).filter(k => k.startsWith('VITE_')));
