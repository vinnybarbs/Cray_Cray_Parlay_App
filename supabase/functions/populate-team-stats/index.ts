import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NFLTeamStats {
  teamId: number;
  teamName: string;
  city: string;
  logo: string;
  conference: string;
  division: string;
  wins: number;
  losses: number;
  ties: number;
  winPercentage: number;
  pointsFor: number;
  pointsAgainst: number;
  netPoints: number;
  // Offensive stats
  totalYards: number;
  passingYards: number;
  rushingYards: number;
  turnovers: number;
  // Defensive stats
  sacksAllowed: number;
  interceptions: number;
  fumbleRecoveries: number;
  // Recent performance
  last5Games: string;
  streak: string;
}

interface APIResponse {
  success: boolean;
  message: string;
  stats_updated: number;
  errors: string[];
}

async function fetchNFLTeamStats(apiKey: string): Promise<NFLTeamStats[]> {
  const baseUrl = 'https://v1.american-football.api-sports.io';
  const currentSeason = new Date().getFullYear();
  
  // Get current week to determine if season is active
  const weekResponse = await fetch(`${baseUrl}/games?league=1&season=${currentSeason}`, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'v1.american-football.api-sports.io'
    }
  });
  
  if (!weekResponse.ok) {
    throw new Error(`Failed to fetch current week: ${weekResponse.status}`);
  }
  
  // Get team standings (includes basic team info and records)
  const standingsResponse = await fetch(`${baseUrl}/standings?league=1&season=${currentSeason}`, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'v1.american-football.api-sports.io'
    }
  });
  
  if (!standingsResponse.ok) {
    throw new Error(`Failed to fetch standings: ${standingsResponse.status}`);
  }
  
  const standingsData = await standingsResponse.json();
  const teams: NFLTeamStats[] = [];
  
  // Process each conference and division
  for (const conference of standingsData.response || []) {
    for (const group of conference || []) {
      for (const team of group || []) {
        const teamStats: NFLTeamStats = {
          teamId: team.team.id,
          teamName: team.team.name,
          city: team.team.name.split(' ').slice(0, -1).join(' '), // Extract city from full name
          logo: team.team.logo,
          conference: conference.name || 'Unknown',
          division: group.name || 'Unknown',
          wins: team.won || 0,
          losses: team.lost || 0,
          ties: team.ties || 0,
          winPercentage: parseFloat(team.percentage || '0'),
          pointsFor: team.points?.for || 0,
          pointsAgainst: team.points?.against || 0,
          netPoints: (team.points?.for || 0) - (team.points?.against || 0),
          // Initialize other stats (will be filled from team stats endpoint)
          totalYards: 0,
          passingYards: 0,
          rushingYards: 0,
          turnovers: 0,
          sacksAllowed: 0,
          interceptions: 0,
          fumbleRecoveries: 0,
          last5Games: team.form || 'N/A',
          streak: team.streak || 'N/A'
        };
        
        teams.push(teamStats);
      }
    }
  }
  
  console.log(`✅ Fetched stats for ${teams.length} NFL teams`);
  return teams;
}

async function populateTeamStats(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("APISPORTS_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ 
        error: "APISPORTS_API_KEY not configured" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ 
        error: "Supabase config missing" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("🚀 Starting NFL team stats population...");
    const startTime = Date.now();

    // Fetch team stats from API
    const teamStats = await fetchNFLTeamStats(apiKey);
    
    if (teamStats.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        message: "No team stats retrieved from API",
        stats_updated: 0,
        errors: ["API returned no team data"]
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Clear old team stats
    const { error: deleteError } = await supabase
      .from('team_stats_cache')
      .delete()
      .eq('sport', 'NFL');

    if (deleteError) {
      console.error('Error clearing old team stats:', deleteError);
    } else {
      console.log('✅ Cleared old NFL team stats');
    }

    // Insert new team stats
    const statsEntries = teamStats.map(team => ({
      sport: 'NFL',
      team_name: team.teamName,
      team_id: team.teamId.toString(),
      provider_id: team.teamId.toString(),
      stats_json: {
        basic: {
          wins: team.wins,
          losses: team.losses,
          ties: team.ties,
          winPercentage: team.winPercentage,
          conference: team.conference,
          division: team.division
        },
        offense: {
          pointsFor: team.pointsFor,
          totalYards: team.totalYards,
          passingYards: team.passingYards,
          rushingYards: team.rushingYards,
          turnovers: team.turnovers
        },
        defense: {
          pointsAgainst: team.pointsAgainst,
          netPoints: team.netPoints,
          sacksAllowed: team.sacksAllowed,
          interceptions: team.interceptions,
          fumbleRecoveries: team.fumbleRecoveries
        },
        recent: {
          last5Games: team.last5Games,
          streak: team.streak
        },
        meta: {
          logo: team.logo,
          city: team.city,
          lastUpdated: new Date().toISOString()
        }
      },
      last_updated: new Date().toISOString()
    }));

    const { data, error: insertError } = await supabase
      .from('team_stats_cache')
      .insert(statsEntries);

    if (insertError) {
      throw new Error(`Failed to insert team stats: ${insertError.message}`);
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Successfully populated ${teamStats.length} NFL team stats in ${duration}ms`);

    const response: APIResponse = {
      success: true,
      message: `Successfully populated ${teamStats.length} NFL team stats`,
      stats_updated: teamStats.length,
      errors: []
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('Error in populate-team-stats:', error);
    
    const response: APIResponse = {
      success: false,
      message: `Failed to populate team stats: ${error.message}`,
      stats_updated: 0,
      errors: [error.message]
    };

    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

Deno.serve(populateTeamStats);