// Parse natural language betslip requests and generate deep links
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const AFFILIATE_ID = 'vinnybarbs';
const STATE = 'US-CO'; // Colorado

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'Please provide a message with your bet requests.' 
      });
    }

    console.log(`\n🤖 Parsing betslip request: "${message}"`);

    // Step 1: Get available games from odds cache
    const { data: cachedOdds, error: oddsError } = await supabase
      .from('odds_cache')
      .select('*')
      .gte('commence_time', new Date().toISOString())
      .order('commence_time', { ascending: true })
      .limit(50);

    if (oddsError || !cachedOdds || cachedOdds.length === 0) {
      console.log('❌ No cached odds available');
      return res.json({
        success: false,
        error: "I don't have any live odds right now. Try again in a few minutes!"
      });
    }

    console.log(`  ✅ Found ${cachedOdds.length} available games in cache`);

    // Step 2: Build context for AI about available games
    const gamesContext = cachedOdds.map(game => {
      const odds = game.odds_data;
      const bookmaker = odds.bookmakers?.[0];
      const markets = bookmaker?.markets || [];
      
      let marketInfo = [];
      
      // Moneyline
      const mlMarket = markets.find(m => m.key === 'h2h');
      if (mlMarket) {
        const awayML = mlMarket.outcomes?.find(o => o.name === odds.away_team);
        const homeML = mlMarket.outcomes?.find(o => o.name === odds.home_team);
        if (awayML && homeML) {
          marketInfo.push(`ML: ${odds.away_team} ${awayML.price}, ${odds.home_team} ${homeML.price}`);
        }
      }
      
      // Spread
      const spreadMarket = markets.find(m => m.key === 'spreads');
      if (spreadMarket) {
        const awaySpread = spreadMarket.outcomes?.find(o => o.name === odds.away_team);
        const homeSpread = spreadMarket.outcomes?.find(o => o.name === odds.home_team);
        if (awaySpread && homeSpread) {
          marketInfo.push(`Spread: ${odds.away_team} ${awaySpread.point} (${awaySpread.price}), ${odds.home_team} ${homeSpread.point} (${homeSpread.price})`);
        }
      }
      
      // Total
      const totalMarket = markets.find(m => m.key === 'totals');
      if (totalMarket) {
        const over = totalMarket.outcomes?.find(o => o.name === 'Over');
        const under = totalMarket.outcomes?.find(o => o.name === 'Under');
        if (over && under) {
          marketInfo.push(`Total: Over ${over.point} (${over.price}), Under ${under.point} (${under.price})`);
        }
      }
      
      return `${odds.away_team} @ ${odds.home_team} - ${marketInfo.join(' | ')}`;
    }).join('\n');

    // Step 3: Use AI to parse the request
    const aiPrompt = `You are a sports betting assistant. Parse the user's bet request and match it to available games.

AVAILABLE GAMES AND ODDS:
${gamesContext}

USER REQUEST: "${message}"

Your task:
1. Extract the bets the user wants (team names, bet types, lines)
2. Match them to the available games above
3. If you can't find a match, say so clearly
4. Return in JSON format

IMPORTANT RULES:
- Only match bets that are clearly available in the games above
- If user says "Chiefs", match "Kansas City Chiefs"
- If user says "spread" without a number, use the available spread line
- If you can't find something, include it in "notFound" array
- Bet types: "Moneyline", "Spread", "Total"

Response format:
{
  "picks": [
    {
      "team": "Kansas City Chiefs",
      "betType": "Moneyline",
      "game": "Kansas City Chiefs @ Buffalo Bills",
      "odds": "-150",
      "point": null
    }
  ],
  "notFound": ["Any bets you couldn't match"],
  "message": "Friendly confirmation message"
}`;

    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful sports betting assistant. Always return valid JSON.' },
        { role: 'user', content: aiPrompt }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(aiResponse.choices[0].message.content);
    console.log('  🤖 AI parsed:', parsed);

    if (!parsed.picks || parsed.picks.length === 0) {
      return res.json({
        success: false,
        error: parsed.message || "I couldn't find those bets in the current odds. Can you be more specific?"
      });
    }

    // Step 4: Enrich picks with full data from cache
    const enrichedPicks = parsed.picks.map(pick => {
      // Find the game in cache
      const game = cachedOdds.find(g => {
        const odds = g.odds_data;
        return pick.game.includes(odds.away_team) && pick.game.includes(odds.home_team);
      });
      
      if (game) {
        return {
          ...pick,
          gameId: game.game_id,
          sport: game.sport,
          commenceTime: game.commence_time
        };
      }
      return pick;
    });

    // Step 5: Generate deep links with affiliate params
    const deepLinks = generateDeepLinks(enrichedPicks);

    // Build response message
    let responseMessage = `✅ Found ${enrichedPicks.length} pick${enrichedPicks.length > 1 ? 's' : ''}!\n\n`;
    
    if (parsed.notFound && parsed.notFound.length > 0) {
      responseMessage += `⚠️ Couldn't find: ${parsed.notFound.join(', ')}\n(You can add these manually in the sportsbook)\n\n`;
    }
    
    responseMessage += enrichedPicks.length > 1 
      ? `🎯 Your ${enrichedPicks.length}-leg parlay is ready!`
      : `🎯 Your single bet is ready!`;

    return res.json({
      success: true,
      message: responseMessage,
      picks: enrichedPicks,
      deepLinks: deepLinks
    });

  } catch (error) {
    console.error('❌ Error parsing betslip:', error);
    return res.status(500).json({
      success: false,
      error: 'Sorry, something went wrong. Please try again.'
    });
  }
};

/**
 * Generate deep links with affiliate parameters
 */
function generateDeepLinks(picks) {
  // DraftKings Affiliate Link
  // Base: https://sportsbook.draftkings.com/r/sb/vinnybarbs/US-CO-SB/US-CO
  const dkLink = `https://sportsbook.draftkings.com/r/sb/${AFFILIATE_ID}/${STATE}-SB/${STATE}`;
  
  // FanDuel Affiliate Link (if you have one)
  // FanDuel deep links are more complex and require specific market IDs
  // For now, just link to the main sportsbook with affiliate tracking
  const fdLink = null; // Add when you have FanDuel affiliate setup
  
  return {
    draftkings: dkLink,
    fanduel: fdLink
  };
}
