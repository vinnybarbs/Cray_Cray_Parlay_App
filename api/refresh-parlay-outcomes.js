import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * API endpoint to refresh parlay outcomes from ESPN API
 * Focuses on locked parlays and updates individual leg outcomes
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    console.log('🔄 Starting parlay outcome refresh...')
    
    // Get all locked parlays that are still pending
    const { data: parlays, error: parlayError } = await supabase
      .from('parlays')
      .select(`
        id, user_id, final_outcome, is_lock_bet,
        parlay_legs (
          id, home_team, away_team, game_date, bet_type, bet_details, 
          game_completed, leg_result, odds
        )
      `)
      .eq('is_lock_bet', true)
      .is('final_outcome', null)
      .order('created_at', { ascending: false })

    if (parlayError) {
      console.error('Error fetching parlays:', parlayError)
      return res.status(500).json({ error: 'Failed to fetch parlays' })
    }

    console.log(`📊 Found ${parlays.length} locked parlays to check`)

    let updatedLegs = 0
    let resolvedParlays = 0

    for (const parlay of parlays) {
      console.log(`\n🎯 Checking parlay ${parlay.id} (${parlay.parlay_legs.length} legs)`)
      
      let allLegsResolved = true
      let winningLegs = 0

      for (const leg of parlay.parlay_legs) {
        // Skip if already resolved
        if (leg.game_completed && leg.leg_result) {
          if (leg.leg_result === 'win') winningLegs++
          continue
        }

        // Check if game should be completed (4+ hours after game date)
        const gameDate = new Date(leg.game_date)
        const now = new Date()
        const hoursSinceGame = (now - gameDate) / (1000 * 60 * 60)

        if (hoursSinceGame >= 4) {
          // Game should be completed, fetch result from ESPN
          const result = await fetchGameResult(leg)
          
          if (result) {
            // Update leg with result
            const { error: updateError } = await supabase
              .from('parlay_legs')
              .update({
                game_completed: true,
                leg_result: result.outcome,
                final_score: result.score || null
              })
              .eq('id', leg.id)

            if (updateError) {
              console.error(`Error updating leg ${leg.id}:`, updateError)
            } else {
              console.log(`✅ Updated leg ${leg.id}: ${leg.away_team} @ ${leg.home_team} = ${result.outcome}`)
              updatedLegs++
              if (result.outcome === 'win') winningLegs++
            }
          } else {
            // Game should be done but no result found
            console.log(`⚠️  Game should be complete but no ESPN data: ${leg.away_team} @ ${leg.home_team}`)
            allLegsResolved = false
          }
        } else {
          // Game hasn't started or is still in progress
          allLegsResolved = false
        }
      }

      // If all legs resolved, determine parlay outcome
      if (allLegsResolved) {
        const totalLegs = parlay.parlay_legs.length
        const parlayOutcome = winningLegs === totalLegs ? 'win' : 'loss'
        
        // Calculate profit/loss (simplified)
        const stake = 100 // Default stake
        const odds = parlay.parlay_legs.reduce((total, leg) => {
          const legOdds = parseFloat(leg.odds) || 100
          return total * (legOdds > 0 ? (legOdds / 100) + 1 : (100 / Math.abs(legOdds)) + 1)
        }, 1)
        
        const profitLoss = parlayOutcome === 'win' ? (stake * odds) - stake : -stake

        // Update parlay final outcome
        const { error: parlayUpdateError } = await supabase
          .from('parlays')
          .update({
            final_outcome: parlayOutcome,
            profit_loss: profitLoss.toFixed(2),
            status: parlayOutcome
          })
          .eq('id', parlay.id)

        if (parlayUpdateError) {
          console.error(`Error updating parlay ${parlay.id}:`, parlayUpdateError)
        } else {
          console.log(`🎉 Parlay ${parlay.id} resolved as: ${parlayOutcome.toUpperCase()} (${winningLegs}/${totalLegs} legs won)`)
          resolvedParlays++
        }
      }
    }

    const response = {
      success: true,
      message: 'Parlay outcomes refreshed successfully',
      stats: {
        parlaysChecked: parlays.length,
        legsUpdated: updatedLegs,
        parlaysResolved: resolvedParlays
      }
    }

    console.log('✨ Refresh complete:', response.stats)
    res.status(200).json(response)

  } catch (error) {
    console.error('Error refreshing parlay outcomes:', error)
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    })
  }
}

/**
 * Fetch game result from ESPN API
 */
async function fetchGameResult(leg) {
  try {
    // Format date for ESPN API (YYYYMMDD)
    const gameDate = new Date(leg.game_date)
    const dateStr = gameDate.toISOString().split('T')[0].replace(/-/g, '')
    
    // Determine sport (college-football vs nfl)
    const isCollegeFootball = !isNFLTeam(leg.home_team)
    const sport = isCollegeFootball ? 'college-football' : 'nfl'
    const league = isCollegeFootball ? 'college-football' : 'nfl'
    
    console.log(`🏈 Fetching ${sport} game: ${leg.away_team} @ ${leg.home_team} on ${dateStr}`)
    
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/${league}/scoreboard?dates=${dateStr}`
    
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`ESPN API error: ${response.status}`)
    }
    
    const data = await response.json()
    
    // Find the specific game
    const game = data.events?.find(event => {
      const homeTeam = event.competitions[0].competitors.find(c => c.homeAway === 'home')
      const awayTeam = event.competitions[0].competitors.find(c => c.homeAway === 'away')
      
      return (
        normalizeTeamName(homeTeam.team.displayName).includes(normalizeTeamName(leg.home_team)) ||
        normalizeTeamName(leg.home_team).includes(normalizeTeamName(homeTeam.team.displayName))
      ) && (
        normalizeTeamName(awayTeam.team.displayName).includes(normalizeTeamName(leg.away_team)) ||
        normalizeTeamName(leg.away_team).includes(normalizeTeamName(awayTeam.team.displayName))
      )
    })
    
    if (!game || !game.competitions[0].status.type.completed) {
      return null
    }

    // Get final scores
    const homeTeam = game.competitions[0].competitors.find(c => c.homeAway === 'home')
    const awayTeam = game.competitions[0].competitors.find(c => c.homeAway === 'away')
    
    const homeScore = parseInt(homeTeam.score)
    const awayScore = parseInt(awayTeam.score)
    const spread = parseSpread(leg.bet_details)
    const total = parseTotal(leg.bet_details)
    
    console.log(`📊 Final Score: ${leg.away_team} ${awayScore} - ${leg.home_team} ${homeScore}`)
    
    // Determine bet outcome based on bet type
    let outcome = 'loss'
    
    if (leg.bet_type === 'moneyline') {
      const betDetails = JSON.parse(leg.bet_details)
      const pickedTeam = betDetails.pick?.toLowerCase()
      const homeWon = homeScore > awayScore
      
      if ((pickedTeam?.includes(leg.home_team.toLowerCase()) && homeWon) ||
          (pickedTeam?.includes(leg.away_team.toLowerCase()) && !homeWon)) {
        outcome = 'win'
      }
    } else if (leg.bet_type === 'spread' && spread !== null) {
      const adjustedHomeScore = homeScore + spread
      if (adjustedHomeScore > awayScore) {
        outcome = 'win'
      }
    } else if (leg.bet_type === 'total' && total !== null) {
      const gameTotal = homeScore + awayScore
      const betDetails = JSON.parse(leg.bet_details)
      const isOver = betDetails.pick?.toLowerCase().includes('over')
      
      if ((isOver && gameTotal > total) || (!isOver && gameTotal < total)) {
        outcome = 'win'
      }
    }
    
    return {
      outcome,
      score: `${leg.away_team} ${awayScore} - ${leg.home_team} ${homeScore}`,
      homeScore,
      awayScore
    }
    
  } catch (error) {
    console.error(`Error fetching game result for ${leg.away_team} @ ${leg.home_team}:`, error)
    return null
  }
}

// Helper functions
function isNFLTeam(teamName) {
  const nflTeams = [
    'Cardinals', 'Falcons', 'Ravens', 'Bills', 'Panthers', 'Bears', 'Bengals', 'Browns',
    'Cowboys', 'Broncos', 'Lions', 'Packers', 'Texans', 'Colts', 'Jaguars', 'Chiefs',
    'Raiders', 'Chargers', 'Rams', 'Dolphins', 'Vikings', 'Patriots', 'Saints', 'Giants',
    'Jets', 'Eagles', 'Steelers', '49ers', 'Seahawks', 'Buccaneers', 'Titans', 'Commanders'
  ]
  return nflTeams.some(team => teamName.includes(team))
}

function normalizeTeamName(name) {
  return name.toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseSpread(betDetails) {
  try {
    const details = JSON.parse(betDetails)
    const pick = details.pick || ''
    const spreadMatch = pick.match(/([+-]?\d+(?:\.\d+)?)/)
    return spreadMatch ? parseFloat(spreadMatch[1]) : null
  } catch {
    return null
  }
}

function parseTotal(betDetails) {
  try {
    const details = JSON.parse(betDetails)
    const pick = details.pick || ''
    const totalMatch = pick.match(/(?:over|under)\s+(\d+(?:\.\d+)?)/i)
    return totalMatch ? parseFloat(totalMatch[1]) : null
  } catch {
    return null
  }
}