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

    const { sports = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB'], automated = false } = await req.json()

    console.log('🏆 Starting team stats refresh for sports:', sports)
    
    let totalUpdated = 0
    let errors = []

    // Update team stats for each sport
    for (const sport of sports) {
      try {
        console.log(`📊 Updating ${sport} team stats...`)
        
        // Get teams for this sport
        const { data: teams, error: teamsError } = await supabase
          .from('team_stats_cache')
          .select('team_id, team_name, sport')
          .eq('sport', sport)
          .limit(50) // Reasonable limit to avoid timeouts

        if (teamsError) {
          console.error(`Error fetching ${sport} teams:`, teamsError)
          errors.push(`${sport}: ${teamsError.message}`)
          continue
        }

        if (!teams || teams.length === 0) {
          console.log(`No teams found for ${sport}`)
          continue
        }

        // For each team, update basic stats (placeholder - would call API-Sports for real data)
        const updates = teams.map(team => ({
          team_id: team.team_id,
          sport: team.sport,
          season: 2025,
          stats: {
            ...team.stats,
            last_updated: new Date().toISOString(),
            refresh_count: (team.stats?.refresh_count || 0) + 1
          },
          last_updated: new Date().toISOString()
        }))

        // Update in batches
        const batchSize = 10
        for (let i = 0; i < updates.length; i += batchSize) {
          const batch = updates.slice(i, i + batchSize)
          
          const { error: updateError } = await supabase
            .from('team_stats_cache')
            .upsert(batch, { onConflict: 'team_id,sport,season' })

          if (updateError) {
            console.error(`Error updating ${sport} team batch:`, updateError)
            errors.push(`${sport} batch ${i}: ${updateError.message}`)
          } else {
            totalUpdated += batch.length
          }
        }

        console.log(`✅ Updated ${teams.length} ${sport} teams`)
        
      } catch (sportError) {
        console.error(`Error processing ${sport}:`, sportError)
        errors.push(`${sport}: ${sportError.message}`)
      }
    }

    // Log the job execution
    if (automated) {
      await supabase.from('cron_job_logs').insert({
        job_name: 'refresh-team-stats-daily',
        status: errors.length > 0 ? 'warning' : 'completed',
        details: `Updated ${totalUpdated} teams across ${sports.length} sports. Errors: ${errors.length}`,
      })
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        updated: totalUpdated, 
        sports: sports.length,
        errors: errors.length > 0 ? errors : undefined,
        message: `Team stats refresh completed. Updated ${totalUpdated} teams.`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Team stats refresh error:', error)
    
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