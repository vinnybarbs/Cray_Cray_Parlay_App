// Debug endpoint to check roster cache stats
require('dotenv').config({ path: '../.env.local' });
require('dotenv').config({ path: '../.env' });

const rosterCache = require('../lib/services/roster-cache');

export default function handler(req, res) {
  try {
    const stats = rosterCache.getStats();
    
    res.json({
      status: 'ok',
      apiKey: process.env.API_SPORTS_KEY ? 'configured' : 'missing',
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
}
