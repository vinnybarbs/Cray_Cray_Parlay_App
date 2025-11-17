#!/usr/bin/env node

// scripts/espn-populate-nfl-teams.js
// One-off helper to seed NFL teams from ESPN into public.teams using Supabase service role.
// - Fetches https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams
// - Maps ESPN payload to an ESPN-centric identifier (team_id / espn_id)
// - Upserts into public.teams using conflict target (sport,name)
//
// NOTE: This is meant to be simple and robust. It only uses columns that are
// known to exist from the schema + fix_core_schema.sql: sport, name, team_id,
// espn_id, provider_ids.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in your environment');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function fetchNflTeamsFromEspn() {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams';
  console.log(`📡 Fetching NFL teams from ESPN: ${url}`);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'CrayCrayParlay/espn-nfl-teams-sync' }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ESPN teams fetch failed: ${res.status} ${res.statusText} ${text}`);
  }

  const json = await res.json();
  const rawTeams = (json?.sports?.[0]?.leagues?.[0]?.teams) || json?.teams || [];

  if (!Array.isArray(rawTeams) || rawTeams.length === 0) {
    console.warn('⚠️ ESPN response contained no teams. Raw keys:', Object.keys(json || {}));
  } else {
    console.log(`📋 ESPN returned ${rawTeams.length} team entries`);
  }

  return rawTeams.map((t) => {
    const team = t.team || t;
    return {
      team_id: String(team.id || team.teamId || team.uid || team.slug || team.abbreviation),
      espn_id: team.id ?? null,
      team_name: team.displayName || team.name || team.fullName || null,
      city: team.location || team.shortDisplayName || null,
      abbreviation: team.abbreviation || team.abbr || null,
      logo: (team.logos && team.logos[0] && team.logos[0].href) || team.logo || null,
      provider_ids: { espn: team.id }
    };
  });
}

async function main() {
  try {
    console.log('🏈 Starting ESPN → Supabase NFL teams sync...');

    const teams = await fetchNflTeamsFromEspn();
    if (!teams || teams.length === 0) {
      console.error('❌ No teams returned from ESPN; aborting');
      process.exit(1);
    }

    // Optionally clear out old NFL teams to keep things clean
    console.log('🧹 Removing existing NFL teams from public.teams (sport = NFL/nfl)...');
    const { error: deleteError } = await supabase
      .from('teams')
      .delete()
      .in('sport', ['NFL', 'nfl']);

    if (deleteError) {
      console.warn('⚠️ Failed to delete existing NFL teams (continuing anyway):', deleteError.message);
    }

    const upsertRows = teams.map((t) => {
      // Fallback for name if ESPN team_name is missing
      const fallbackNameParts = [];
      if (t.city) fallbackNameParts.push(t.city);
      if (t.abbreviation && !fallbackNameParts.includes(t.abbreviation)) {
        fallbackNameParts.push(t.abbreviation);
      }
      const fallbackName = fallbackNameParts.join(' ').trim() || t.team_id;

      return {
        sport: 'NFL',
        name: t.team_name || fallbackName,
        team_id: t.team_id,
        espn_id: t.espn_id,
        provider_ids: t.provider_ids
      };
    });

    console.log(`📝 Inserting ${upsertRows.length} NFL teams into public.teams...`);

    const { data, error } = await supabase
      .from('teams')
      .insert(upsertRows);

    if (error) {
      console.error('❌ Supabase insert error:', error.message || error);
      process.exit(1);
    }

    const count = Array.isArray(data) ? data.length : upsertRows.length;
    console.log(`✅ Successfully upserted ${count} NFL teams into public.teams`);

    // Quick verification query: count NFL teams
    const { data: verifyRows, error: verifyError } = await supabase
      .from('teams')
      .select('sport, name, team_id, espn_id')
      .eq('sport', 'NFL')
      .order('name');

    if (verifyError) {
      console.warn('⚠️ Verification query failed:', verifyError.message);
    } else {
      console.log(`📊 Verification: ${verifyRows.length} NFL teams now in public.teams`);
      const sample = verifyRows.slice(0, 5);
      console.log('🔍 Sample teams:');
      for (const row of sample) {
        console.log(`   - ${row.name} (team_id=${row.team_id}, espn_id=${row.espn_id})`);
      }
    }

    console.log('\n🎉 ESPN NFL team seeding complete.');
  } catch (err) {
    console.error('💥 ESPN NFL teams sync failed:', err.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
