// Load environment variables - try .env.local first, then .env
require('dotenv').config({ path: '.env.local' });
require('dotenv').config(); // This will load .env if .env.local doesn't exist

const express = require('express');
const cors = require('cors');
const generateParlayHandler = require('./api/generate-parlay');

const app = express();
const PORT = process.env.PORT || 5001;

// Enhanced CORS for deployment
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.FRONTEND_URL, 'https://your-deployed-app.com'] 
    : true,
  credentials: true
}));

app.use(express.json());

// Force HTTPS in production (but not in local development)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers.host?.includes('localhost')) {
      next(); // Skip HTTPS redirect for localhost
    } else if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// Enhanced health check with environment info
app.get('/health', (req, res) => {
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

// Debug endpoint to test Odds API directly
app.get('/debug/odds-test', async (req, res) => {
  const ODDS_KEY = process.env.ODDS_API_KEY;
  
  if (!ODDS_KEY) {
    return res.json({ error: 'No ODDS_API_KEY' });
  }

  try {
    let fetcher = globalThis.fetch;
    if (!fetcher) {
      const nf = await import('node-fetch');
      fetcher = nf.default || nf;
    }

    const testUrl = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?regions=us&markets=h2h&oddsFormat=american&bookmakers=draftkings&apiKey=${ODDS_KEY}`;
    
    const response = await fetcher(testUrl);
    const data = await response.json();
    
    res.json({
      status: response.status,
      hasData: Array.isArray(data),
      gameCount: Array.isArray(data) ? data.length : 0,
      firstGame: Array.isArray(data) && data.length > 0 ? {
        home: data[0].home_team,
        away: data[0].away_team,
        time: data[0].commence_time
      } : null,
      error: data.error || data.message || null
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post('/api/generate-parlay', generateParlayHandler);

app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});