// Parse natural language betslip requests and generate deep links
const { createClient } = require('@supabase/supabase-js');
const { complete, MODELS } = require('../lib/services/claude');

const AFFILIATE_ID = 'vinnybarbs';
const STATE = 'US-CO'; // Colorado

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

    // Step 1: Get available games from odds cache. Rows are one per
    // (game, bookmaker, market_type) with an `outcomes` jsonb — this handler
    // previously read a long-gone `odds_data` column and threw on every
    // request, which is why the digest's Build Parlay hand-off 500'd.
    const { data: oddsRows, error: oddsError } = await supabase
      .from('odds_cache')
      .select('sport, game_id, external_game_id, commence_time, home_team, away_team, bookmaker, market_type, outcomes')
      .gte('commence_time', new Date().toISOString())
      .in('market_type', ['h2h', 'spreads', 'totals'])
      .order('commence_time', { ascending: true })
      .limit(600);

    if (oddsError || !oddsRows || oddsRows.length === 0) {
      console.log('❌ No cached odds available');
      return res.json({
        success: false,
        error: "I don't have any live odds right now. Try again in a few minutes!"
      });
    }

    // Group rows per game, preferring DraftKings prices when present.
    const gamesByKey = new Map();
    for (const row of oddsRows) {
      const key = row.external_game_id || `${row.away_team}@${row.home_team}`;
      if (!gamesByKey.has(key)) {
        gamesByKey.set(key, {
          sport: row.sport,
          game_id: row.game_id,
          commence_time: row.commence_time,
          home_team: row.home_team,
          away_team: row.away_team,
          markets: {},
        });
      }
      const g = gamesByKey.get(key);
      const isDK = (row.bookmaker || '').toLowerCase() === 'draftkings';
      const existing = g.markets[row.market_type];
      if (!existing || (isDK && !existing.isDK)) {
        let outcomes = row.outcomes;
        if (typeof outcomes === 'string') {
          try { outcomes = JSON.parse(outcomes); } catch { outcomes = []; }
        }
        g.markets[row.market_type] = { outcomes: outcomes || [], isDK };
      }
    }
    const cachedGames = [...gamesByKey.values()].slice(0, 50);
    console.log(`  ✅ Found ${cachedGames.length} available games in cache`);

    // Step 2: Build context for AI about available games
    const gamesContext = cachedGames.map(game => {
      const marketInfo = [];

      const ml = game.markets.h2h?.outcomes;
      if (ml) {
        const awayML = ml.find(o => o.name === game.away_team);
        const homeML = ml.find(o => o.name === game.home_team);
        if (awayML && homeML) {
          marketInfo.push(`ML: ${game.away_team} ${awayML.price}, ${game.home_team} ${homeML.price}`);
        }
      }

      const spreads = game.markets.spreads?.outcomes;
      if (spreads) {
        const awaySpread = spreads.find(o => o.name === game.away_team);
        const homeSpread = spreads.find(o => o.name === game.home_team);
        if (awaySpread && homeSpread) {
          marketInfo.push(`Spread: ${game.away_team} ${awaySpread.point} (${awaySpread.price}), ${game.home_team} ${homeSpread.point} (${homeSpread.price})`);
        }
      }

      const totals = game.markets.totals?.outcomes;
      if (totals) {
        const over = totals.find(o => o.name === 'Over');
        const under = totals.find(o => o.name === 'Under');
        if (over && under) {
          marketInfo.push(`Total: Over ${over.point} (${over.price}), Under ${under.point} (${under.price})`);
        }
      }

      return `${game.away_team} @ ${game.home_team} - ${marketInfo.join(' | ')}`;
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

    const parsed = await complete({
      model: MODELS.UTILITY,
      system: 'You are a helpful sports betting assistant. Always return valid JSON.',
      messages: [{ role: 'user', content: aiPrompt }],
      maxTokens: 1000,
      json: true,
    });
    console.log('  🤖 AI parsed:', parsed);

    if (!parsed) {
      return res.json({
        success: false,
        error: "I couldn't parse those picks. Try being more specific — team name + bet type works best."
      });
    }

    if (!parsed.picks || parsed.picks.length === 0) {
      return res.json({
        success: false,
        error: parsed.message || "I couldn't find those bets in the current odds. Can you be more specific?"
      });
    }

    // Step 4: Enrich picks with full data from cache
    const enrichedPicks = parsed.picks.map(pick => {
      const game = cachedGames.find(g =>
        pick.game && pick.game.includes(g.away_team) && pick.game.includes(g.home_team)
      );

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
 * Generate deep links with affiliate parameters that PRE-FILL the betslip
 * 
 * DraftKings Deep Link Format:
 * Gateway: https://sportsbook.draftkings.com/gateway?s=SELECTION_ID&wager=AMOUNT
 * Multiple: https://sportsbook.draftkings.com/gateway?s=ID1&s=ID2&s=ID3&wager=25
 * 
 * The Odds API provides these selection IDs in the outcome data
 */
function generateDeepLinks(picks) {
  if (!picks || picks.length === 0) {
    return { draftkings: null, fanduel: null };
  }

  // Extract selection IDs from The Odds API data
  // These come from the outcome objects in the cached odds
  const dkSelections = [];
  const fdSelections = [];

  for (const pick of picks) {
    // The Odds API includes selection IDs in outcome metadata
    // We need to parse them from the cached odds data
    if (pick.draftKingsId) {
      dkSelections.push(pick.draftKingsId);
    }
    if (pick.fanduelId) {
      fdSelections.push(pick.fanduelId);
    }
  }

  // Build DraftKings Gateway Link
  let dkLink = null;
  if (dkSelections.length > 0) {
    const selectionParams = dkSelections.map(id => `s=${id}`).join('&');
    dkLink = `https://sportsbook.draftkings.com/gateway?${selectionParams}&wager=25&aff=${AFFILIATE_ID}`;
  } else {
    // Fallback to affiliate homepage if no selection IDs
    dkLink = `https://sportsbook.draftkings.com/r/sb/${AFFILIATE_ID}/${STATE}-SB/${STATE}`;
  }

  // Build FanDuel Link (when available)
  let fdLink = null;
  if (fdSelections.length > 0) {
    // FanDuel uses a different format: /betslip?market=ID&selection=ID
    // This is simplified - actual implementation depends on FD API structure
    fdLink = `https://sportsbook.fanduel.com/betslip?${fdSelections.map(id => `selection=${id}`).join('&')}`;
  }

  return {
    draftkings: dkLink,
    fanduel: fdLink
  };
}
