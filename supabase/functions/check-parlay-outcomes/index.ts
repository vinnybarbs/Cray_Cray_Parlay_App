// Supabase Edge Function: Check Parlay Outcomes
// Runs daily to automatically check pending parlays against game results

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

interface GameResult {
  homeScore: number
  awayScore: number
  status: string
  source: string
}

interface LegUpdate {
  legId: string
  result: 'won' | 'lost' | 'push'
  actualValue: number
  marginOfVictory: number
}

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('🔍 Starting parlay outcome check...')

    // Get all pending parlays with their legs
    const { data: pendingParlays, error: fetchError } = await supabase
      .from('parlays')
      .select(`
        *,
        parlay_legs (*)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (fetchError) {
      throw new Error(`Error fetching parlays: ${fetchError.message}`)
    }

    if (!pendingParlays?.length) {
      console.log('No pending parlays found')
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No pending parlays found',
          checked: 0,
          updated: 0
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    console.log(`Found ${pendingParlays.length} pending parlays`)

    let updatedCount = 0
    const results = []

    for (const parlay of pendingParlays) {
      try {
        console.log(`Checking parlay ${parlay.id} with ${parlay.parlay_legs.length} legs`)

        let allLegsResolved = true
        let wonLegs = 0
        let lostLegs = 0
        let pushLegs = 0
        
        const legUpdates: LegUpdate[] = []

        for (const leg of parlay.parlay_legs) {
          // Skip legs that are already resolved
          if (leg.game_completed) {
            if (leg.leg_result === 'won') wonLegs++
            else if (leg.leg_result === 'lost') lostLegs++
            else if (leg.leg_result === 'push') pushLegs++
            continue
          }

          // Check if the game has completed
          const gameResult = await getGameResult(leg)
          
          if (!gameResult) {
            allLegsResolved = false
            continue // Game not completed yet
          }

          // Determine leg outcome based on bet type
          const legOutcome = determineLegOutcome(leg, gameResult)
          
          if (legOutcome) {
            legUpdates.push({
              legId: leg.id,
              result: legOutcome.result,
              actualValue: legOutcome.actualValue,
              marginOfVictory: legOutcome.marginOfVictory
            })

            if (legOutcome.result === 'won') wonLegs++
            else if (legOutcome.result === 'lost') lostLegs++
            else if (legOutcome.result === 'push') pushLegs++
          } else {
            allLegsResolved = false
          }
        }

        // Update individual legs
        for (const update of legUpdates) {
          await updateLegOutcome(update)
        }

        // If all legs are resolved, update parlay outcome
        if (allLegsResolved) {
          const parlayOutcome = calculateParlayOutcome(wonLegs, lostLegs, pushLegs)
          await updateParlayOutcome(parlay.id, parlayOutcome, parlay)
          
          console.log(`✅ Updated parlay ${parlay.id}: ${parlayOutcome.outcome}`)
          updatedCount++
          
          results.push({
            parlayId: parlay.id,
            outcome: parlayOutcome.outcome,
            wonLegs,
            lostLegs,
            pushLegs
          })
        } else {
          console.log(`⏳ Parlay ${parlay.id} still has unresolved games`)
          results.push({
            parlayId: parlay.id,
            outcome: 'pending',
            reason: 'Games still pending'
          })
        }

      } catch (error) {
        console.error(`Error checking parlay ${parlay.id}:`, error)
        results.push({
          parlayId: parlay.id,
          error: error.message
        })
      }
    }

    console.log(`✅ Parlay outcome check complete: ${updatedCount}/${pendingParlays.length} updated`)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Checked ${pendingParlays.length} parlays, updated ${updatedCount}`,
        checked: pendingParlays.length,
        updated: updatedCount,
        results
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Error in parlay outcome checker:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})

/**
 * Get game result from ESPN API (free)
 */
async function getGameResult(leg: any): Promise<GameResult | null> {
  try {
    const gameDate = new Date(leg.game_date)
    const today = new Date()
    
    // Only check games from the past (be more aggressive - check any game from yesterday or earlier)
    if (gameDate > new Date(today.getTime() - 12 * 60 * 60 * 1000)) {
      return null // Game likely not finished yet
    }

    // ESPN API endpoints by sport
    const espnEndpoints: { [key: string]: string } = {
      'NFL': 'http://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
      'NCAA': 'http://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
      'NCAAF': 'http://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
      'College Football': 'http://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
      'NBA': 'http://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
      'MLB': 'http://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
      'NHL': 'http://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard'
    }

    const endpoint = espnEndpoints[leg.sport]
    if (!endpoint) return null

    // Game dates are now stored in Mountain Time, so use them directly
    const dateStr = gameDate.toISOString().split('T')[0].replace(/-/g, '')
    
    console.log(`Checking ${leg.away_team} @ ${leg.home_team} on date: ${dateStr} (stored in MT)`)
    
    const response = await fetch(`${endpoint}?dates=${dateStr}`)
    if (!response.ok) return null

    const data = await response.json()
    
    // Find matching game
    const game = data.events?.find((event: any) => {
      const competition = event.competitions[0]
      const homeTeam = competition.competitors.find((c: any) => c.homeAway === 'home')
      const awayTeam = competition.competitors.find((c: any) => c.homeAway === 'away')
      
      return teamsMatch(homeTeam.team.displayName, leg.home_team) &&
             teamsMatch(awayTeam.team.displayName, leg.away_team)
    })

    if (!game) return null

    const competition = game.competitions[0]
    const status = competition.status
    
    // Check if game is completed
    if (status.type.completed !== true) {
      return null
    }

    const homeTeam = competition.competitors.find((c: any) => c.homeAway === 'home')
    const awayTeam = competition.competitors.find((c: any) => c.homeAway === 'away')

    return {
      homeScore: parseInt(homeTeam.score) || 0,
      awayScore: parseInt(awayTeam.score) || 0,
      status: 'completed',
      source: 'espn'
    }

  } catch (error) {
    console.error('Error fetching game result:', error)
    return null
  }
}

/**
 * Check if team names match accounting for variations
 */
function teamsMatch(apiTeamName: string, legTeamName: string): boolean {
  if (!apiTeamName || !legTeamName) return false
  
  const apiLower = apiTeamName.toLowerCase().trim()
  const legLower = legTeamName.toLowerCase().trim()
  
  // Direct match
  if (apiLower === legLower) {
    return true
  }

  // Remove common suffixes and try again
  const cleanApi = apiLower.replace(/\s+(gamecocks|miners|falcons|eagles|flames|bears)$/, '')
  const cleanLeg = legLower.replace(/\s+(gamecocks|miners|falcons|eagles|flames|bears)$/, '')
  
  if (cleanApi === cleanLeg) {
    return true
  }

  // Check if one contains the other (for partial matches)
  return apiLower.includes(legLower) || legLower.includes(apiLower)
}

/**
 * Determine leg outcome based on bet type and game result
 */
function determineLegOutcome(leg: any, gameResult: GameResult): any {
  try {
    const betDetails = typeof leg.bet_details === 'string' 
      ? JSON.parse(leg.bet_details) 
      : leg.bet_details

    const homeScore = gameResult.homeScore
    const awayScore = gameResult.awayScore
    const scoreDiff = homeScore - awayScore // Positive = home wins

    switch (leg.bet_type?.toLowerCase()) {
      case 'moneyline':
      case 'moneyline/spread':
        return checkMoneylineOutcome(betDetails, scoreDiff, leg)
        
      case 'spread':
        return checkSpreadOutcome(betDetails, scoreDiff, leg)
        
      case 'total':
      case 'over/under':
        return checkTotalOutcome(betDetails, homeScore + awayScore)
        
      default:
        console.warn(`Unknown bet type: ${leg.bet_type}`)
        return null
    }
    
  } catch (error) {
    console.error('Error determining leg outcome:', error)
    return null
  }
}

/**
 * Check moneyline bet outcome
 */
function checkMoneylineOutcome(betDetails: any, scoreDiff: number, leg: any): any {
  const pick = betDetails.pick?.toLowerCase() || betDetails.description?.toLowerCase() || ''
  
  if (!pick) return null
  
  // Parse which team was picked
  let teamWon = false
  
  // Check if the picked team matches home or away team
  if (pick.includes(leg.home_team.toLowerCase()) || 
      teamsMatch(pick, leg.home_team)) {
    teamWon = scoreDiff > 0 // Home team won
  } else if (pick.includes(leg.away_team.toLowerCase()) || 
             teamsMatch(pick, leg.away_team)) {
    teamWon = scoreDiff < 0 // Away team won  
  } else {
    console.warn(`Could not match pick "${pick}" to teams: ${leg.home_team} vs ${leg.away_team}`)
    return null
  }

  if (scoreDiff === 0) {
    return { result: 'push', actualValue: 0, marginOfVictory: 0 }
  }

  return {
    result: teamWon ? 'won' : 'lost',
    actualValue: scoreDiff,
    marginOfVictory: Math.abs(scoreDiff)
  }
}

/**
 * Check spread bet outcome
 */
function checkSpreadOutcome(betDetails: any, scoreDiff: number, leg: any): any {
  const pick = betDetails.pick || ''
  
  // Extract spread value from pick like "Bowling Green Falcons (2.5)"
  const spreadMatch = pick.match(/\(([\d.-]+)\)/)
  if (!spreadMatch) return null
  
  const spread = parseFloat(spreadMatch[1])
  
  // Determine which team was picked by checking team name in pick
  let isHomePick = false
  if (pick.toLowerCase().includes(leg.home_team.toLowerCase())) {
    isHomePick = true
  } else if (pick.toLowerCase().includes(leg.away_team.toLowerCase())) {
    isHomePick = false
  } else {
    return null
  }
  
  // Calculate adjusted score difference
  let adjustedDiff
  if (isHomePick) {
    adjustedDiff = scoreDiff - spread // Home team minus spread
  } else {
    adjustedDiff = -scoreDiff - spread // Away team minus spread
  }

  if (adjustedDiff === 0) {
    return { result: 'push', actualValue: adjustedDiff, marginOfVictory: 0 }
  }

  return {
    result: adjustedDiff > 0 ? 'won' : 'lost',
    actualValue: adjustedDiff,
    marginOfVictory: Math.abs(adjustedDiff)
  }
}

/**
 * Check total (over/under) bet outcome
 */
function checkTotalOutcome(betDetails: any, totalScore: number): any {
  const pick = betDetails.pick || betDetails.description || ''
  
  // Extract over/under and line from pick like "Over (50.5)"
  const totalMatch = pick.match(/(Over|Under)\s*\(([\d.]+)\)/i)
  if (!totalMatch) return null
  
  const isOver = totalMatch[1].toLowerCase() === 'over'
  const line = parseFloat(totalMatch[2])
  const diff = totalScore - line

  if (diff === 0) {
    return { result: 'push', actualValue: diff, marginOfVictory: 0 }
  }

  const won = isOver ? diff > 0 : diff < 0
  
  return {
    result: won ? 'won' : 'lost',
    actualValue: diff,
    marginOfVictory: Math.abs(diff)
  }
}

/**
 * Calculate overall parlay outcome
 */
function calculateParlayOutcome(wonLegs: number, lostLegs: number, pushLegs: number): any {
  // If any leg lost, parlay loses
  if (lostLegs > 0) {
    return {
      outcome: 'lost',
      hitPercentage: (wonLegs / (wonLegs + lostLegs + pushLegs)) * 100
    }
  }

  // If all legs won (pushes don't count as losses)
  if (wonLegs > 0 && lostLegs === 0) {
    return {
      outcome: 'won',
      hitPercentage: 100
    }
  }

  // All pushes
  if (pushLegs > 0 && wonLegs === 0 && lostLegs === 0) {
    return {
      outcome: 'push',
      hitPercentage: 0
    }
  }

  return {
    outcome: 'pending',
    hitPercentage: 0
  }
}

/**
 * Update individual leg outcome in database
 */
async function updateLegOutcome(update: LegUpdate): Promise<void> {
  try {
    const { error } = await supabase
      .from('parlay_legs')
      .update({
        game_completed: true,
        leg_result: update.result,
        actual_value: update.actualValue,
        margin_of_victory: update.marginOfVictory,
        resolved_at: new Date().toISOString()
      })
      .eq('id', update.legId)

    if (error) throw error
    
    console.log(`Updated leg ${update.legId}: ${update.result}`)
    
  } catch (error) {
    console.error(`Error updating leg ${update.legId}:`, error)
    throw error
  }
}

/**
 * Update parlay outcome in database
 */
async function updateParlayOutcome(parlayId: string, outcome: any, parlay: any): Promise<void> {
  try {
    // Calculate profit/loss if parlay won
    let profitLoss = 0
    const betAmount = parlay.bet_amount || 100 // Use actual bet amount or default to $100
    if (outcome.outcome === 'won') {
      const payout = parlay.potential_payout || 0
      profitLoss = payout - betAmount
    } else if (outcome.outcome === 'lost') {
      profitLoss = -betAmount // Lost the bet amount
    }

    const { error } = await supabase
      .from('parlays')
      .update({
        status: 'completed',
        final_outcome: outcome.outcome,
        hit_percentage: outcome.hitPercentage,
        profit_loss: profitLoss
      })
      .eq('id', parlayId)

    if (error) throw error
    
    console.log(`Updated parlay ${parlayId}: ${outcome.outcome} (P&L: $${profitLoss})`)
    
  } catch (error) {
    console.error(`Error updating parlay ${parlayId}:`, error)
    throw error
  }
}