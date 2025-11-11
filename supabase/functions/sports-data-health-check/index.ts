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

    console.log('🏥 Starting sports data health check...')
    
    const healthReport = {
      timestamp: new Date().toISOString(),
      checks: {},
      overall_status: 'healthy',
      issues: []
    }

    // Check team stats cache
    try {
      const { count: teamCount, error: teamError } = await supabase
        .from('team_stats_cache')
        .select('*', { count: 'exact', head: true })

      if (teamError) throw teamError

      healthReport.checks.team_stats = {
        status: teamCount > 900 ? 'healthy' : 'warning',
        count: teamCount,
        expected_minimum: 900,
        message: teamCount > 900 ? 'Team cache healthy' : 'Team cache below expected count'
      }

      if (teamCount < 900) {
        healthReport.issues.push('Team stats cache below expected count')
        healthReport.overall_status = 'warning'
      }

    } catch (error) {
      healthReport.checks.team_stats = {
        status: 'error',
        error: error.message
      }
      healthReport.issues.push('Team stats cache check failed')
      healthReport.overall_status = 'error'
    }

    // Check odds cache freshness
    try {
      const { data: oddsData, error: oddsError } = await supabase
        .from('odds_cache')
        .select('last_updated')
        .order('last_updated', { ascending: false })
        .limit(1)

      if (oddsError) throw oddsError

      if (oddsData && oddsData.length > 0) {
        const lastUpdated = new Date(oddsData[0].last_updated)
        const hoursOld = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60)
        
        healthReport.checks.odds_cache = {
          status: hoursOld < 24 ? 'healthy' : 'warning',
          last_updated: oddsData[0].last_updated,
          hours_old: Math.round(hoursOld * 100) / 100,
          message: hoursOld < 24 ? 'Odds cache fresh' : 'Odds cache stale'
        }

        if (hoursOld >= 24) {
          healthReport.issues.push('Odds cache is stale (>24 hours)')
          healthReport.overall_status = 'warning'
        }
      } else {
        healthReport.checks.odds_cache = {
          status: 'warning',
          message: 'No odds data found'
        }
        healthReport.issues.push('No odds data available')
        healthReport.overall_status = 'warning'
      }

    } catch (error) {
      healthReport.checks.odds_cache = {
        status: 'error',
        error: error.message
      }
      healthReport.issues.push('Odds cache check failed')
      healthReport.overall_status = 'error'
    }

    // Check news cache freshness
    try {
      const { data: newsData, error: newsError } = await supabase
        .from('news_cache')
        .select('last_updated')
        .order('last_updated', { ascending: false })
        .limit(1)

      if (newsError) throw newsError

      if (newsData && newsData.length > 0) {
        const lastUpdated = new Date(newsData[0].last_updated)
        const hoursOld = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60)
        
        healthReport.checks.news_cache = {
          status: hoursOld < 12 ? 'healthy' : 'warning',
          last_updated: newsData[0].last_updated,
          hours_old: Math.round(hoursOld * 100) / 100,
          message: hoursOld < 12 ? 'News cache fresh' : 'News cache stale'
        }

        if (hoursOld >= 12) {
          healthReport.issues.push('News cache is stale (>12 hours)')
          if (healthReport.overall_status === 'healthy') {
            healthReport.overall_status = 'warning'
          }
        }
      } else {
        healthReport.checks.news_cache = {
          status: 'warning',
          message: 'No news data found'
        }
        healthReport.issues.push('No news data available')
        if (healthReport.overall_status === 'healthy') {
          healthReport.overall_status = 'warning'
        }
      }

    } catch (error) {
      healthReport.checks.news_cache = {
        status: 'error',
        error: error.message
      }
      healthReport.issues.push('News cache check failed')
      healthReport.overall_status = 'error'
    }

    // Check cron job logs for recent failures
    try {
      const { data: cronLogs, error: cronError } = await supabase
        .from('cron_job_logs')
        .select('job_name, status, created_at')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .eq('status', 'error')
        .limit(10)

      if (cronError) throw cronError

      healthReport.checks.cron_jobs = {
        status: cronLogs.length === 0 ? 'healthy' : 'warning',
        recent_errors: cronLogs.length,
        message: cronLogs.length === 0 ? 'No recent cron errors' : `${cronLogs.length} recent cron errors`
      }

      if (cronLogs.length > 0) {
        healthReport.issues.push(`${cronLogs.length} recent cron job errors`)
        if (healthReport.overall_status === 'healthy') {
          healthReport.overall_status = 'warning'
        }
      }

    } catch (error) {
      healthReport.checks.cron_jobs = {
        status: 'error',
        error: error.message
      }
      healthReport.issues.push('Cron job logs check failed')
      healthReport.overall_status = 'error'
    }

    // Log the health check
    await supabase.from('cron_job_logs').insert({
      job_name: 'sports-data-health-check',
      status: healthReport.overall_status === 'healthy' ? 'completed' : 'warning',
      details: `Health check completed. Status: ${healthReport.overall_status}. Issues: ${healthReport.issues.length}`,
    })

    console.log('✅ Health check completed:', healthReport.overall_status)

    return new Response(
      JSON.stringify({
        success: true,
        ...healthReport
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Health check error:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        overall_status: 'error'
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})