const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
)

async function fetchESPNGame(homeTeam, awayTeam, gameDate) {
  try {
    const dateStr = gameDate.split('T')[0]
    const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${dateStr.replace(/-/g, '')}`
    
    const response = await fetch(espnUrl)
    const data = await response.json()
    
    if (!data.events) return null
    
    for (const event of data.events) {
      const competitors = event.competitions[0].competitors
      const home = competitors.find(c => c.homeAway === 'home')
      const away = competitors.find(c => c.homeAway === 'away')
      
      if (home && away) {
        const homeMatch = home.team.displayName.toLowerCase().includes(homeTeam.toLowerCase()) ||
                          home.team.shortDisplayName.toLowerCase().includes(homeTeam.toLowerCase())
        const awayMatch = away.team.displayName.toLowerCase().includes(awayTeam.toLowerCase()) ||
                          away.team.shortDisplayName.toLowerCase().includes(awayTeam.toLowerCase())
        
        if (homeMatch && awayMatch) {
          return {
            homeScore: parseInt(home.score),
            awayScore: parseInt(away.score),
            completed: event.competitions[0].status.type.completed,
            homeTeam: home.team.displayName,
            awayTeam: away.team.displayName
          }
        }
      }
    }
    
    return null
  } catch (error) {
    console.error('ESPN API error:', error)
    return null
  }
}

async function updateParlayOutcomes() {
  try {
    console.log('Starting parlay outcome refresh...')
    
    // Get locked parlays that are pending
    const { data: parlays, error: parlayError } = await supabase
      .from('parlays')
      .select(`
        id, user_id, is_lock_bet,
        parlay_legs (
          id, home_team, away_team, game_date, bet_type, bet_details, outcome
        )
      `)
      .eq('is_lock_bet', true)
      .is('final_outcome', null)
    
    if (parlayError) {
      console.error('Error fetching parlays:', parlayError)
      return { error: 'Database error' }
    }
    
    console.log(`Found ${parlays.length} locked parlays to check`)
    
    let updatedLegs = 0
    
    for (const parlay of parlays) {
      for (const leg of parlay.parlay_legs) {
        // Skip if already resolved
        if (leg.outcome) continue
        
        const gameResult = await fetchESPNGame(leg.home_team, leg.away_team, leg.game_date)
        
        if (gameResult && gameResult.completed) {
          console.log(`Found completed game: ${gameResult.awayTeam} @ ${gameResult.homeTeam} (${gameResult.awayScore}-${gameResult.homeScore})`)
          
          // Determine leg outcome based on bet type
          let legOutcome = null
          
          try {
            const betDetails = typeof leg.bet_details === 'string' ? JSON.parse(leg.bet_details) : leg.bet_details
            
            if (leg.bet_type === 'moneyline') {
              const pickedTeam = betDetails.pick
              if (pickedTeam.includes(gameResult.homeTeam) || gameResult.homeTeam.includes(pickedTeam)) {
                legOutcome = gameResult.homeScore > gameResult.awayScore ? 'win' : 'loss'
              } else {
                legOutcome = gameResult.awayScore > gameResult.homeScore ? 'win' : 'loss'
              }
            } else if (leg.bet_type === 'spread') {
              const spread = parseFloat(betDetails.line)
              const pickedTeam = betDetails.pick
              
              if (pickedTeam.includes(gameResult.homeTeam) || gameResult.homeTeam.includes(pickedTeam)) {
                legOutcome = (gameResult.homeScore + spread) > gameResult.awayScore ? 'win' : 'loss'
              } else {
                legOutcome = (gameResult.awayScore + spread) > gameResult.homeScore ? 'win' : 'loss'
              }
            } else if (leg.bet_type === 'total') {
              const total = gameResult.homeScore + gameResult.awayScore
              const line = parseFloat(betDetails.line)
              const overUnder = betDetails.pick.toLowerCase()
              
              if (overUnder.includes('over')) {
                legOutcome = total > line ? 'win' : 'loss'
              } else {
                legOutcome = total < line ? 'win' : 'loss'
              }
            }
            
            if (legOutcome) {
              const { error: updateError } = await supabase
                .from('parlay_legs')
                .update({ outcome: legOutcome })
                .eq('id', leg.id)
              
              if (!updateError) {
                updatedLegs++
                console.log(`Updated leg ${leg.id}: ${leg.bet_type} -> ${legOutcome}`)
              }
            }
          } catch (parseError) {
            console.error('Error parsing bet details:', parseError)
          }
        }
      }
    }
    
    console.log(`Updated ${updatedLegs} parlay legs`)
    return { updated: updatedLegs }
    
  } catch (error) {
    console.error('Error in updateParlayOutcomes:', error)
    return { error: error.message }
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  
  const result = await updateParlayOutcomes()
  
  if (result.error) {
    return res.status(500).json(result)
  }
  
  return res.status(200).json({
    message: 'Parlay outcomes refreshed',
    ...result
  })
}