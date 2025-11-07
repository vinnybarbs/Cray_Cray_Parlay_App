// Load environment variables - try .env.local first, then .env
require('dotenv').config({ path: '.env.local' });
require('dotenv').config(); // This will load .env if .env.local doesn't exist

const express = require('express');
const cors = require('cors');
const generateParlayHandler = require('./api/generate-parlay');
const { logger } = require('./shared/logger');
const { parlayRateLimiter, generalRateLimiter } = require('./lib/middleware/rateLimiter');
const { validateParlayRequest, sanitizeInput } = require('./lib/middleware/validation');

const app = express();
const PORT = process.env.PORT || 5001;

// Progress tracking for SSE
const progressClients = new Map(); // requestId -> [response objects]

// Enhanced CORS for deployment
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server or curl without Origin
    if (!origin) return callback(null, true);
    // Allow everything in non-production
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    // If no list configured, allow
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','Accept'],
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

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
    // Never redirect preflight; let CORS respond
    if (req.method === 'OPTIONS') return next();
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

// Debug CORS config
app.get('/debug/cors', (req, res) => {
  res.json({
    allowedOrigins: allowedOrigins,
    requestOrigin: req.headers.origin || 'none',
    nodeEnv: process.env.NODE_ENV,
    rawAllowedOriginsEnv: process.env.ALLOWED_ORIGINS || 'not set',
    rawFrontendUrlEnv: process.env.FRONTEND_URL || 'not set'
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

// Main parlay generation endpoint (legacy - will be deprecated)
import { generateParlayHandler } from './api/generate-parlay.js';
import { validateParlayRequest, sanitizeInput } from './lib/middleware/validation.js';

app.post('/api/generate-parlay',
  parlayRateLimiter.middleware(),
  validateParlayRequest,
  sanitizeInput,
  generateParlayHandler
);

// New endpoint: Suggest individual picks (not full parlays)
import { suggestPicksHandler } from './api/suggest-picks.js';

app.post('/api/suggest-picks',
  parlayRateLimiter.middleware(),
  validateParlayRequest, // Reuse same validation
  sanitizeInput,
  suggestPicksHandler
);

// User parlay management endpoints (protected)
import { authenticateUser } from './lib/middleware/supabaseAuth.js';
import { getUserParlays, getUserStats, getParlayById, updateParlayOutcome } from './api/user-parlays.js';

app.get('/api/user/parlays', authenticateUser, getUserParlays);
app.get('/api/user/stats', authenticateUser, getUserStats);
app.get('/api/user/parlays/:id', authenticateUser, getParlayById);
app.patch('/api/user/parlays/:id', authenticateUser, updateParlayOutcome);

app.listen(PORT, () => {
  logger.info(`Backend server started`, { 
    port: PORT, 
    environment: process.env.NODE_ENV || 'development',
    url: `http://localhost:${PORT}`
  });
});