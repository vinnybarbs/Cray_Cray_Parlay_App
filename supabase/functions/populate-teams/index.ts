import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ESPNTeam {
  id: string;
  name: string;
  displayName: string;
  shortDisplayName: string;
  abbreviation: string;
  location: string;
  color: string;
  alternateColor: string;
  logo: string;
  logos: any[];
  conference?: string;
  division?: string;
}

interface TeamRecord {
  name: string;
  sport: string;
  api_sports_id?: number;
  provider_ids: {
    espn_team_id: string;
    display_name: string;
    short_name: string;
    abbreviation: string;
    location: string;
    colors: {
      primary: string;
      secondary: string;
    };
    logos: any[];
    conference?: string;
    division?: string;
    last_updated: string;
  };
}

async function fetchESPNTeams(sport: string): Promise<ESPNTeam[]> {
  const espnSportPaths = {
    // American Football
    'NFL': 'football/nfl',
    'NCAAF': 'football/college-football',
    // Basketball
    'NBA': 'basketball/nba',
    'NCAAB': 'basketball/mens-college-basketball',
    // Baseball
    'MLB': 'baseball/mlb',
    // Hockey
    'NHL': 'hockey/nhl',
    // Soccer
    'EPL': 'soccer/eng.1',
    'MLS': 'soccer/usa.1'
  };

  const sportPath = espnSportPaths[sport as keyof typeof espnSportPaths];
  if (!sportPath) {
    console.log(`⚠️  ESPN path not found for sport: ${sport}`);
    return [];
  }

  // Use the working ESPN site API endpoint format
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/teams`;
  
  console.log(`🔍 Fetching ${sport} teams from ESPN: ${url}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sport} teams: ${response.status}`);
  }
  
  const data = await response.json();
  const teams: ESPNTeam[] = [];
  
  // Process teams directly from ESPN site API format
  for (const team of data.sports?.[0]?.leagues?.[0]?.teams || []) {
    try {
      const teamData = team.team;
      
      teams.push({
        id: teamData.id,
        name: teamData.name || teamData.displayName,
        displayName: teamData.displayName,
        shortDisplayName: teamData.shortDisplayName,
        abbreviation: teamData.abbreviation,
        location: teamData.location,
        color: teamData.color,
        alternateColor: teamData.alternateColor,
        logo: teamData.logos?.[0]?.href || '',
        logos: teamData.logos || [],
        conference: teamData.groups?.[0]?.name,
        division: teamData.groups?.[1]?.name
      });
      
    } catch (error) {
      console.warn(`Failed to process team:`, error);
    }
  }
  
  console.log(`✅ Fetched ${teams.length} ${sport} teams`);
  return teams;
}

async function populateTeams(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // @ts-ignore: Deno is available in Edge runtime
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    // @ts-ignore: Deno is available in Edge runtime
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

    console.log("🚀 Starting ESPN teams population...");
    const startTime = Date.now();

    // Teams for ALL sports, players only for prop betting sports
    const allSports = ['NFL', 'NCAAF', 'NBA', 'NHL', 'MLB', 'EPL']; // All sports in your app
    const playerPropSports = ['NFL', 'NBA', 'MLB']; // Only these get player updates
    let totalTeamsInserted = 0;
    const errors: string[] = [];

    for (const sport of allSports) {
      try {
        console.log(`\n📊 Processing ${sport}...`);
        
        // Fetch teams from ESPN
        const espnTeams = await fetchESPNTeams(sport);
        
        if (espnTeams.length === 0) {
          console.log(`⚠️  No teams found for ${sport}`);
          continue;
        }

        // Clear existing teams for this sport
        const { error: deleteError } = await supabase
          .from('teams')
          .delete()
          .eq('sport', sport.toLowerCase());

        if (deleteError) {
          console.error(`Error clearing ${sport} teams:`, deleteError);
          errors.push(`Failed to clear ${sport} teams: ${deleteError.message}`);
        }

        // Prepare team records for insertion
        const teamRecords: TeamRecord[] = espnTeams.map(team => ({
          name: team.name,
          sport: sport.toLowerCase(),
          provider_ids: {
            espn_team_id: team.id,
            display_name: team.displayName,
            short_name: team.shortDisplayName,
            abbreviation: team.abbreviation,
            location: team.location,
            colors: {
              primary: team.color,
              secondary: team.alternateColor
            },
            logos: team.logos,
            conference: team.conference,
            division: team.division,
            last_updated: new Date().toISOString()
          }
        }));

        // Insert teams
        const { data: insertedTeams, error: insertError } = await supabase
          .from('teams')
          .insert(teamRecords)
          .select();

        if (insertError) {
          console.error(`Error inserting ${sport} teams:`, insertError);
          errors.push(`Failed to insert ${sport} teams: ${insertError.message}`);
        } else {
          const inserted = insertedTeams?.length || 0;
          totalTeamsInserted += inserted;
          console.log(`✅ Inserted ${inserted} ${sport} teams`);
        }

        // Rate limiting between sports
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Error processing ${sport}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${sport}: ${errorMessage}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`\n✅ Teams population complete: ${totalTeamsInserted} teams in ${duration}ms`);

    // Now update players with team_id mappings (only for prop sports)
    console.log('\n🔗 Updating player team mappings...');
    let playersUpdated = 0;

    for (const sport of playerPropSports) {
      try {
        // Get teams for this sport
        const { data: teams } = await supabase
          .from('teams')
          .select('id, name, provider_ids')
          .eq('sport', sport.toLowerCase());

        if (!teams || teams.length === 0) continue;

        // Get players for this sport that need team mapping
        const { data: players } = await supabase
          .from('players')
          .select('id, provider_ids')
          .eq('sport', sport.toLowerCase())
          .is('team_id', null);

        if (!players || players.length === 0) continue;

        // Update players with team_id based on team name matching
        for (const player of players) {
          // Parse provider_ids if it's a string
          let playerProviderIds;
          try {
            playerProviderIds = typeof player.provider_ids === 'string' 
              ? JSON.parse(player.provider_ids)
              : player.provider_ids || {};
          } catch (e) {
            console.warn(`Failed to parse provider_ids for player ${player.id}`);
            continue;
          }
          
          const playerTeamName = playerProviderIds.team_name;

          if (playerTeamName) {
            // Find matching team by name patterns or abbreviation
            const matchingTeam = teams.find((team: any) => {
              const teamName = team.name.toLowerCase();
              const playerTeam = playerTeamName.toLowerCase();
              
              // Parse team provider_ids if needed
              let teamProviderIds;
              try {
                teamProviderIds = typeof team.provider_ids === 'string' 
                  ? JSON.parse(team.provider_ids)
                  : team.provider_ids || {};
              } catch (e) {
                teamProviderIds = {};
              }
              
              return (
                // Exact match
                teamName === playerTeam ||
                // Player team contains team name (e.g., "Arizona Cardinals" contains "Cardinals")
                playerTeam.includes(teamName) ||
                // Team name contains player team (less likely but possible)
                teamName.includes(playerTeam) ||
                // Abbreviation match
                teamProviderIds?.abbreviation?.toLowerCase() === playerTeam ||
                // Display name match
                teamProviderIds?.display_name?.toLowerCase() === playerTeam
              );
            });

            if (matchingTeam) {
              const { error: updateError } = await supabase
                .from('players')
                .update({ team_id: matchingTeam.id })
                .eq('id', player.id);

              if (!updateError) {
                playersUpdated++;
              }
            }
          }
        }

        console.log(`✅ Updated ${playersUpdated} ${sport} player team mappings`);

      } catch (error) {
        console.error(`Error updating ${sport} player mappings:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Player mapping ${sport}: ${errorMessage}`);
      }
    }

    const response = {
      success: errors.length === 0,
      message: `Successfully populated ${totalTeamsInserted} teams and updated ${playersUpdated} player mappings`,
      teams_inserted: totalTeamsInserted,
      players_updated: playersUpdated,
      all_sports_processed: allSports,
      player_prop_sports: playerPropSports,
      errors: errors
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('Error in populate-teams:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(JSON.stringify({
      success: false,
      message: `Failed to populate teams: ${errorMessage}`,
      teams_inserted: 0,
      players_updated: 0,
      errors: [errorMessage]
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

// @ts-ignore: Deno is available in Edge runtime
Deno.serve(populateTeams);