import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

interface EspnStat {
  name: string
  value?: number
  displayValue?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const sportParam = (url.searchParams.get('sport') || 'NFL').toUpperCase()
    const seasonParam = url.searchParams.get('season')
    const seasonTypeParam = url.searchParams.get('seasonType') || url.searchParams.get('seasontype')

    const now = new Date()
    const currentYear = now.getFullYear()
    const season = seasonParam ? parseInt(seasonParam, 10) || currentYear : currentYear
    const seasonType = seasonTypeParam ? parseInt(seasonTypeParam, 10) || 2 : 2

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.warn('[ingest-standings] Missing Supabase env, DB writes disabled')
    }

    if (sportParam !== 'NFL') {
      return new Response(
        JSON.stringify({
          success: false,
          message: `Sport ${sportParam} not yet supported. Only NFL is implemented.`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
      )
    }

    // Get all NFL teams that have an ESPN team id stored
    let nflTeams: any[] = []

    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('id, name, provider_ids')
      .eq('sport', 'nfl')

    if (teamsError) {
      throw new Error(`Error fetching teams: ${teamsError.message}`)
    }

    if (teams && teams.length > 0) {
      nflTeams = teams
    }

    // If no NFL teams exist yet, bootstrap them from ESPN teams endpoint
    if (!nflTeams || nflTeams.length === 0) {
      const teamsUrl = 'http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams'
      console.log('[ingest-standings] No NFL teams in DB, bootstrapping from', teamsUrl)

      const teamsResp = await fetch(teamsUrl)
      if (!teamsResp.ok) {
        throw new Error(`ESPN teams request failed: ${teamsResp.status} ${teamsResp.statusText}`)
      }

      const teamsData: any = await teamsResp.json()
      const espnTeams: any[] = Array.isArray(teamsData?.sports?.[0]?.leagues?.[0]?.teams)
        ? teamsData.sports[0].leagues[0].teams
        : []

      if (!espnTeams.length) {
        throw new Error('Failed to bootstrap NFL teams from ESPN teams endpoint')
      }

      for (const t of espnTeams) {
        const team = t.team || t
        if (!team || !team.displayName || !team.id) continue

        const providerIds = {
          espn_id: team.id,
          espn_abbreviation: team.abbreviation,
        }

        const { error: upsertError } = await supabase
          .from('teams')
          .upsert(
            {
              sport: 'nfl',
              name: team.displayName,
              provider_ids: providerIds,
            },
            { onConflict: 'sport,name' },
          )

        if (upsertError) {
          console.warn('[ingest-standings] Error bootstrapping team', team.displayName, upsertError.message)
        }
      }

      // Re-fetch teams after bootstrapping
      const { data: bootstrappedTeams, error: refetchError } = await supabase
        .from('teams')
        .select('id, name, provider_ids')
        .eq('sport', 'nfl')

      if (refetchError) {
        throw new Error(`Error refetching teams after bootstrap: ${refetchError.message}`)
      }

      nflTeams = bootstrappedTeams || []
    }

    let teamsUpserted = 0
    let statsUpserted = 0

    for (const teamRow of nflTeams) {
      let providerIds: any = (teamRow as any).provider_ids || {}

      // Handle provider_ids stored as JSON string or object
      if (typeof providerIds === 'string') {
        try {
          providerIds = JSON.parse(providerIds)
        } catch (_e) {
          providerIds = {}
        }
      }
      const espnId = providerIds.espn_id || providerIds.espnId || providerIds.ESPN_ID
      const teamName: string = (teamRow as any).name

      if (!espnId) {
        console.warn('[ingest-standings] Skipping team with no espn_id', teamName)
        continue
      }

      const recordUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/${seasonType}/teams/${espnId}/record`
      console.log('[ingest-standings] Fetching record from', recordUrl)

      const recordResp = await fetch(recordUrl)
      if (!recordResp.ok) {
        console.warn('[ingest-standings] Record request failed for', teamName, recordResp.status, recordResp.statusText)
        continue
      }

      const recordData: any = await recordResp.json()

      const items: any[] = Array.isArray(recordData.items) ? recordData.items : []
      if (!items.length) {
        console.warn('[ingest-standings] No record items for team', teamName)
        continue
      }

      // Prefer overall/total record if available, otherwise fall back to first item
      const overall =
        items.find((it) =>
          it.type?.id === '0' ||
          it.type?.name === 'total' ||
          it.type?.description?.toLowerCase() === 'overall',
        ) || items[0]

      const statsArray: EspnStat[] = Array.isArray(overall.stats) ? overall.stats : []
      if (!statsArray.length) {
        console.warn('[ingest-standings] No stats array for team record', teamName)
        continue
      }

      const statMap: Record<string, number> = {}
      for (const s of statsArray) {
        if (!s || !s.name) continue
        const v = typeof s.value === 'number' ? s.value : Number(s.value)
        if (!Number.isNaN(v)) {
          statMap[s.name] = v
        }
      }

      const metrics: Record<string, unknown> = {
        wins: statMap['winsOverall'] ?? statMap['wins'],
        losses: statMap['lossesOverall'] ?? statMap['losses'],
        ties: statMap['tiesOverall'] ?? statMap['ties'],
        win_pct: statMap['winPercentOverall'] ?? statMap['winPercent'] ?? statMap['winPct'],
        points_for: statMap['pointsFor'] ?? statMap['points_scored'],
        points_against: statMap['pointsAgainst'] ?? statMap['points_allowed'],
        raw_stats: statsArray,
      }

      const { error: statsError } = await supabase
        .from('team_stats_season')
        .upsert(
          {
            team_id: (teamRow as any).id,
            season,
            metrics,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'team_id,season' },
        )

      if (statsError) {
        console.error('[ingest-standings] Error upserting team_stats_season for', teamName, statsError.message)
        continue
      }

      teamsUpserted += 1
      statsUpserted += 1
    }

    return new Response(
      JSON.stringify({
        success: true,
        season,
        sport: sportParam,
        teamsProcessed: teamsUpserted,
        teamsUpserted,
        statsUpserted,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[ingest-standings] Error:', message)
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    )
  }
})
