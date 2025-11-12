import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function addTeamNameColumn(req: Request) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('🔄 Adding team_name column and populating with team names...');
    
    // First, try to add the column (will be ignored if exists)
    const { error: alterError } = await supabase.rpc('exec', {
      sql: 'ALTER TABLE players ADD COLUMN IF NOT EXISTS team_name text;'
    });
    
    if (alterError) {
      console.log('Note: Could not add column via RPC, may already exist');
    }
    
    // Get all players and their teams
    const { data: players, error: fetchError } = await supabase
      .from('players')
      .select(`
        id,
        team_id,
        teams!inner(name)
      `)
      .not('team_id', 'is', null);
    
    if (fetchError) throw fetchError;
    
    console.log(`Found ${players.length} players to update with team names`);
    
    // Update players in small batches to avoid timeouts
    let updated = 0;
    const batchSize = 50;
    
    for (let i = 0; i < players.length; i += batchSize) {
      const batch = players.slice(i, i + batchSize);
      
      for (const player of batch) {
        const { error: updateError } = await supabase
          .from('players')
          .update({ team_name: player.teams.name })
          .eq('id', player.id);
          
        if (!updateError) {
          updated++;
        }
      }
      
      console.log(`Updated ${Math.min(i + batchSize, players.length)}/${players.length} players`);
      
      // Small delay to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Get final stats
    const { data: stats } = await supabase
      .from('players')
      .select('sport, team_name')
      .in('sport', ['nfl', 'nba', 'mlb']);
    
    const summary = (stats || []).reduce((acc: any, p: any) => {
      if (!acc[p.sport]) acc[p.sport] = { total: 0, withTeam: 0 };
      acc[p.sport].total++;
      if (p.team_name) acc[p.sport].withTeam++;
      return acc;
    }, {});
    
    return new Response(JSON.stringify({
      success: true,
      message: `Updated ${updated} players with team names`,
      summary
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
    
  } catch (error) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

// @ts-ignore: Deno is available in Edge runtime
Deno.serve(addTeamNameColumn);