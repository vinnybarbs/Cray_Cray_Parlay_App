// Super minimal server - copying ONLY the working parts
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 5004;

// CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.FRONTEND_URL, 'https://your-deployed-app.com'] 
    : true,
  credentials: true
}));

app.use(express.json());

// Simple health endpoint - copied from original
app.get('/api/health', (req, res) => {
  const hasOddsKey = !!process.env.ODDS_API_KEY;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const hasSerperKey = !!process.env.SERPER_API_KEY;
  res.json({
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    apis: {
      odds: hasOddsKey,
      openai: hasOpenAIKey,
      serper: hasSerperKey
    },
    timestamp: new Date().toISOString()
  });
});

console.log('About to call app.listen...');

app.listen(PORT, () => {
  console.log(`Minimal server listening on port ${PORT}`);
  console.log(`Health endpoint: http://localhost:${PORT}/api/health`);
});