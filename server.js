// Load environment variables - try .env.local first, then .env
require('dotenv').config({ path: '.env.local' });
require('dotenv').config(); // This will load .env if .env.local doesn't exist

const express = require('express');
const cors = require('cors');
const generateParlayHandler = require('./api/generate-parlay');
const { suggestPicksHandler } = require('./api/suggest-picks');
const { logger } = require('./shared/logger');
const { parlayRateLimiter, generalRateLimiter } = require('./lib/middleware/rateLimiter');
const { validateParlayRequest, sanitizeInput } = require('./lib/middleware/validation');

const app = express();
const PORT = process.env.PORT || 5001;

const path = require('path');

// Progress tracking for SSE
const progressClients = new Map(); // requestId -> [response objects]

// Enhanced CORS for deployment
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.FRONTEND_URL, 'https://your-deployed-app.com'] 
    : true,
  credentials: true
}));

app.use(express.json());

// Apply general rate limiting to all routes
app.use(generalRateLimiter.middleware());

// Validate API keys on startup
const requiredKeys = ['ODDS_API_KEY', 'OPENAI_API_KEY'];
const missingKeys = requiredKeys.filter(key => !process.env[key]);
if (missingKeys.length > 0) {
  logger.warn('Missing required API keys', { missingKeys });
  logger.warn('Some features may not work. Check env.example for required keys.');
}

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

// Mirror health under /api for vite proxy convenience
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

// Real-time dashboard status endpoint
const { getDashboardStatus } = require('./api/dashboard-status');
app.get('/api/dashboard-status', getDashboardStatus);

// Serve static frontend in production and development (Vite build output)
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA fallback: use a middleware to avoid registering a route pattern that
// older router/path-to-regexp combinations may choke on.
app.use((req, res, next) => {
  // allow API and debug routes to pass through to the server
  if (req.path.startsWith('/api') || req.path.startsWith('/debug') || req.path.startsWith('/cron')) return next();
  // otherwise serve the built frontend
  res.sendFile(path.join(distPath, 'index.html'));
});

// Debug endpoint for roster cache stats
app.get('/debug/roster-cache', (req, res) => {
  try {
    const rosterCache = require('./lib/services/roster-cache');
    const stats = rosterCache.getStats();
    const hasKey = !!(process.env.APISPORTS_API_KEY || process.env.API_SPORTS_KEY);
    
    res.json({
      status: 'ok',
      apiKey: hasKey ? 'configured' : 'missing',
      apiKeyName: process.env.APISPORTS_API_KEY ? 'APISPORTS_API_KEY' : (process.env.API_SPORTS_KEY ? 'API_SPORTS_KEY' : 'none'),
      cache: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Debug endpoint for NFL Stats service
app.get('/debug/nfl-stats', (req, res) => {
  try {
    const nflStats = require('./lib/services/nfl-stats');
    const stats = nflStats.getStats();
    const hasKey = !!(process.env.APISPORTS_API_KEY || process.env.API_SPORTS_KEY);
    
    res.json({
      status: 'ok',
      service: 'NFL Stats',
      apiKey: hasKey ? 'configured' : 'missing',
      stats: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
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

// Debug endpoint for Supabase configuration
app.get('/debug/supabase', (req, res) => {
  try {
    const requiredEnvVars = {
      'SUPABASE_URL': process.env.SUPABASE_URL,
      'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'SUPABASE_ANON_KEY': process.env.SUPABASE_ANON_KEY
    };

    const apiKeys = {
      'ODDS_API_KEY': process.env.ODDS_API_KEY,
      'OPENAI_API_KEY': process.env.OPENAI_API_KEY,
      'SERPER_API_KEY': process.env.SERPER_API_KEY
    };

    const config = {};
    Object.entries(requiredEnvVars).forEach(([key, value]) => {
      config[key] = value ? 'configured' : 'missing';
    });

    const keys = {};
    Object.entries(apiKeys).forEach(([key, value]) => {
      keys[key] = value ? 'configured' : 'missing';
    });

    res.json({
      status: 'ok',
      environment: process.env.NODE_ENV || 'development',
      supabase: config,
      apiKeys: keys,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Removed debug refresh-odds endpoint after API cleanup
// app.post('/debug/refresh-odds', async (req, res) => {
//   // For debugging odds refresh manually
//   // const refreshOddsModule = require('./api/refresh-odds');
//   // await refreshOddsModule(req, res);
// });

// SSE endpoint for real-time progress updates
app.get('/api/generate-parlay-stream/:requestId', (req, res) => {
  const { requestId } = req.params;
  
  console.log(`🔌 SSE Client connected: ${requestId}`);
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders(); // Flush headers immediately
  
  // Add this client to the progress tracking
  if (!progressClients.has(requestId)) {
    progressClients.set(requestId, []);
  }
  progressClients.get(requestId).push(res);
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', requestId })}\n\n`);
  console.log(`✅ SSE Client registered: ${requestId} (${progressClients.get(requestId).length} clients)`);
  
  // Clean up on client disconnect
  req.on('close', () => {
    const clients = progressClients.get(requestId);
    if (clients) {
      const index = clients.indexOf(res);
      if (index > -1) clients.splice(index, 1);
      if (clients.length === 0) progressClients.delete(requestId);
    }
  });
});

// Helper function to emit progress to all connected clients
global.emitProgress = (requestId, phase, status, details = {}) => {
  const clients = progressClients.get(requestId);
  if (!clients || clients.length === 0) return;
  
  const message = JSON.stringify({ 
    type: 'progress',
    phase,      // 'odds', 'research', 'analysis'
    status,     // 'active', 'complete'
    details,    // optional: { gameCount, researchCount, etc }
    timestamp: Date.now()
  });
  
  clients.forEach(client => {
    try {
      client.write(`data: ${message}\n\n`);
    } catch (err) {
      // Client disconnected
    }
  });
};

// Helper to emit completion and close connections
global.emitComplete = (requestId) => {
  const clients = progressClients.get(requestId);
  if (!clients) return;
  
  const message = JSON.stringify({ type: 'complete', timestamp: Date.now() });
  clients.forEach(client => {
    try {
      client.write(`data: ${message}\n\n`);
      client.end();
    } catch (err) {
      // Already closed
    }
  });
  
  progressClients.delete(requestId);
};

// Apply stricter rate limiting and validation to parlay generation
app.post('/api/generate-parlay', 
  parlayRateLimiter.middleware(),
  sanitizeInput,
  validateParlayRequest,
  generateParlayHandler
);

// Add suggest-picks endpoint for pick builder
app.post('/api/suggest-picks',
  parlayRateLimiter.middleware(),
  sanitizeInput,
  validateParlayRequest,
  suggestPicksHandler
);

// Removed test endpoint for player props validation
// const testPlayerProps = require('./api/test-player-props');
// app.get('/api/test-player-props', testPlayerProps);

// Add refresh stats endpoint
// The following lines are unchanged and provide context for the surrounding code
// Add refresh stats endpoint
// Removed refresh stats endpoint after API cleanup
// const { refreshStatsCache } = require('./api/refresh-stats');
// app.get('/api/refresh-stats', refreshStatsCache);

// Add refresh news endpoint
// Removed refresh news endpoint after API cleanup
// const refreshNewsCache = require('./api/refresh-news');
// app.get('/api/refresh-news', refreshNewsCache);

// Add parlay outcome management endpoints
const { checkParlayOutcomes, manualParlayUpdate, getPendingParlays } = require('./api/parlay-outcomes');
app.post('/api/check-parlays', checkParlayOutcomes);
app.patch('/api/parlays/:id/outcome', ...manualParlayUpdate);
app.get('/api/parlays/pending', ...getPendingParlays);

// Add learning analysis endpoints
const { analyzeOutcomes, getLessons, getPerformanceSummary } = require('./api/analyze-outcomes');
app.post('/api/analyze-outcomes', analyzeOutcomes);
app.get('/api/lessons', getLessons);
app.get('/api/performance-summary', getPerformanceSummary);

// Add API-Sports sync endpoints
const { syncApiSports, getSyncStatus } = require('./api/sync-apisports');
app.post('/api/sync-apisports', syncApiSports);
app.get('/api/sync-apisports/status', getSyncStatus);

// Add user parlay management endpoints
const { getUserParlays, getUserStats, getParlayById, updateParlayOutcome } = require('./api/user-parlays');
app.get('/api/user/parlays', getUserParlays);
app.get('/api/user/stats', getUserStats);
app.get('/api/user/parlays/:id', getParlayById);
app.patch('/api/user/parlays/:id', updateParlayOutcome);

// Add cron endpoint to refresh odds cache (secured by CRON_SECRET)
// Removed cron refresh-odds endpoint after API cleanup
// const refreshOddsCache = require('./api/refresh-odds');
// app.post('/cron/refresh-odds', refreshOddsCache);

app.listen(PORT, () => {
  logger.info(`Backend server started`, { 
    port: PORT, 
    environment: process.env.NODE_ENV || 'development',
    url: `http://localhost:${PORT}`
  });
});