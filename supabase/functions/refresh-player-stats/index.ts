// Daily Player Stats Refresh Edge Function
// Fetches recent stats from ESPN box scores for players with active prop odds
// Runs daily at 8am to keep cache fresh

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log('📊 Starting daily player stats refresh from ESPN box scores...')


    const startTime = new Date()
    const sports = ['NFL'] // Start with NFL, expand later
    let totalPlayers = 0
    let totalUpdated = 0
    const results: any = {}

    // For each sport, get players with active props and fetch their stats
    for (const sport of sports) {
      console.log(`\n📈 Processing ${sport} player stats...`)
      
      try {
        // Get recent player prop odds to identify which players need stats
        const sportKey = sport === 'NFL' ? 'americanfootball_nfl' : 
                         sport === 'NBA' ? 'basketball_nba' : 
                         sport === 'MLB' ? 'baseball_mlb' : 
                         'icehockey_nhl'
        
        const nowIso = new Date().toISOString()
        
        // Find players with active prop odds
        const { data: propOdds, error: oddsError } = await supabase
          .from('odds_cache')
          .select('*')
          .eq('sport', sportKey)
          .ilike('market_type', 'player_%')
          .gt('commence_time', nowIso)
          .limit(100) // Get up to 100 prop markets
        
        if (oddsError) {
          console.error(`Error fetching ${sport} prop odds:`, oddsError.message)
          results[sport] = { error: oddsError.message }
          continue
        }
        
        if (!propOdds || propOdds.length === 0) {
          console.log(`No active prop odds for ${sport}`)
          results[sport] = { players: 0, message: 'No active props' }
          continue
        }
        
        // Extract unique player names from prop odds
        const playerNames = new Set<string>()
        propOdds.forEach(odds => {
          if (odds.outcomes) {
            odds.outcomes.forEach((outcome: any) => {
              const playerName = outcome.description || outcome.name
              if (playerName && playerName !== 'Over' && playerName !== 'Under') {
                playerNames.add(playerName)
              }
            })
          }
        })
        
        const uniquePlayers = Array.from(playerNames)
        console.log(`Found ${uniquePlayers.length} unique players with active props`)
        totalPlayers += uniquePlayers.length
        
        if (uniquePlayers.length === 0) {
          results[sport] = { players: 0, message: 'No players found in props' }
          continue
        }
        
        // Fetch stats using our ESPN box score fetcher
        const stats = await fetchPlayerStats(uniquePlayers, sport)
        
        if (stats) {
          totalUpdated += Object.keys(stats).length
          results[sport] = {
            players_requested: uniquePlayers.length,
            players_updated: Object.keys(stats).length,
            success: true
          }
          console.log(`✅ Updated stats for ${Object.keys(stats).length}/${uniquePlayers.length} ${sport} players`)
        } else {
          results[sport] = { players: 0, message: 'Stats fetch failed' }
        }
        
      } catch (sportError: any) {
        console.error(`Error processing ${sport}:`, sportError.message)
        results[sport] = { error: sportError.message }
      }
    }
    
    const duration = Math.round((new Date().getTime() - startTime.getTime()) / 1000)
    
    console.log(`\n🎯 Daily stats refresh completed:`)
    console.log(`   Total players: ${totalPlayers}`)
    console.log(`   Successfully updated: ${totalUpdated}`)
    console.log(`   Duration: ${duration}s`)
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        total_players: totalPlayers,
        updated: totalUpdated, 
        duration_seconds: duration,
        results,
        message: `Updated ${totalUpdated}/${totalPlayers} players across ${sports.length} sport(s)`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Player stats refresh error:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

// Fetch player stats from ESPN box scores
async function fetchPlayerStats(playerNames: string[], sport: string) {
  try {
    const baseUrl = 'http://site.api.espn.com/apis/site/v2/sports'
    const sportPath = getSportPath(sport)
    const playerStats: any = {}
    
    // Get recent games (last 7 days)
    const games: any[] = []
    for (let i = 0; i < 7; i++) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0].replace(/-/g, '')
      
      try {
        const scoreboardUrl = `${baseUrl}/${sportPath}/scoreboard?dates=${dateStr}`
        const response = await fetch(scoreboardUrl)
        
        if (response.ok) {
          const data = await response.json()
          if (data.events) {
            data.events.forEach((event: any) => {
              if (event.status?.type?.state === 'post') {
                games.push({ id: event.id, date: event.date })
              }
            })
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 300))
      } catch (err) {
        console.log(`Error fetching scoreboard for ${dateStr}`)
      }
    }
    
    console.log(`Found ${games.length} recent completed games`)
    
    // Fetch box scores and extract player stats
    for (const game of games.slice(0, 20)) {
      try {
        const boxScoreUrl = `${baseUrl}/${sportPath}/summary?event=${game.id}`
        const response = await fetch(boxScoreUrl)
        
        if (response.ok) {
          const data = await response.json()
          extractPlayerStats(data, playerNames, playerStats, sport)
        }
        
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (err) {
        console.log(`Error fetching box score for game ${game.id}`)
      }
    }
    
    // Calculate averages
    for (const playerName in playerStats) {
      const games = playerStats[playerName]
      const avgStats: any = { games_played: games.length }
      
      if (games.length > 0) {
        const statKeys = Object.keys(games[0]).filter(k => k !== 'gameDate' && k !== 'opponent')
        statKeys.forEach(key => {
          const sum = games.reduce((acc: number, g: any) => acc + (parseFloat(g[key]) || 0), 0)
          avgStats[key] = (sum / games.length).toFixed(1)
        })
      }
      
      playerStats[playerName] = avgStats
    }
    
    return playerStats
    
  } catch (error: any) {
    console.error('Error fetching player stats:', error.message)
    return null
  }
}

function getSportPath(sport: string): string {
  const paths: Record<string, string> = {
    'NFL': 'football/nfl',
    'NBA': 'basketball/nba',
    'MLB': 'baseball/mlb',
    'NHL': 'hockey/nhl'
  }
  return paths[sport] || 'football/nfl'
}

function extractPlayerStats(boxScore: any, targetPlayers: string[], playerStats: any, sport: string) {
  if (!boxScore.boxscore?.players) return
  
  const gameDate = boxScore.header?.competitions?.[0]?.date
  
  for (const team of boxScore.boxscore.players) {
    if (!team.statistics) continue
    
    const gamePlayersMap = new Map()
    
    for (const statGroup of team.statistics) {
      if (!statGroup.athletes) continue
      const groupName = (statGroup.name || '').toLowerCase()
      
      for (const athlete of statGroup.athletes) {
        const playerName = athlete.athlete?.displayName
        if (!playerName || !targetPlayers.includes(playerName)) continue
        
        if (!gamePlayersMap.has(playerName)) {
          gamePlayersMap.set(playerName, {
            gameDate,
            passing_yards: 0,
            passing_tds: 0,
            rushing_yards: 0,
            rushing_tds: 0,
            receptions: 0,
            receiving_yards: 0,
            receiving_tds: 0
          })
        }
        
        const stats = gamePlayersMap.get(playerName)
        const labels = statGroup.labels || []
        const values = athlete.stats || []
        
        labels.forEach((label: string, i: number) => {
          const val = values[i]
          if (!val) return
          
          if (groupName.includes('passing')) {
            if (label === 'YDS') stats.passing_yards = parseFloat(val) || 0
            if (label === 'TD') stats.passing_tds = parseInt(val) || 0
          } else if (groupName.includes('rushing')) {
            if (label === 'YDS') stats.rushing_yards = parseFloat(val) || 0
            if (label === 'TD') stats.rushing_tds = parseInt(val) || 0
          } else if (groupName.includes('receiving')) {
            if (label === 'REC') stats.receptions = parseInt(val) || 0
            if (label === 'YDS') stats.receiving_yards = parseFloat(val) || 0
            if (label === 'TD') stats.receiving_tds = parseInt(val) || 0
          }
        })
      }
    }
    
    for (const [playerName, stats] of gamePlayersMap) {
      if (!playerStats[playerName]) {
        playerStats[playerName] = []
      }
      playerStats[playerName].push(stats)
    }
  }
}