// Load environment variables
require('dotenv').config({ path: '../.env.local' });
require('dotenv').config({ path: '../.env' });

export default function handler(req, res) {
  const hasOddsKey = !!process.env.ODDS_API_KEY;
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasSerperKey = !!process.env.SERPER_API_KEY;
  
  res.json({ 
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    apis: {
      odds: hasOddsKey,
      anthropic: hasAnthropicKey,
      serper: hasSerperKey
    },
    timestamp: new Date().toISOString()
  });
}