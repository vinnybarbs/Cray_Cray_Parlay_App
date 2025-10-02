// Load environment variables
require('dotenv').config({ path: '../.env.local' });
require('dotenv').config({ path: '../.env' });

export default async function handler(req, res) {
  const ODDS_KEY = process.env.ODDS_API_KEY;
  
  if (!ODDS_KEY) {
    return res.json({ error: 'No ODDS_API_KEY' });
  }

  try {
    const testUrl = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?regions=us&markets=h2h&oddsFormat=american&bookmakers=draftkings&apiKey=${ODDS_KEY}`;
    
    const response = await fetch(testUrl);
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
}