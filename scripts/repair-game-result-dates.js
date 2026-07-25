#!/usr/bin/env node
/**
 * ONE-TIME REPAIR: game_results.date rows written before the sport-day fix
 * are +1 day for any game starting 00:00Z or later (8pm ET and later starts),
 * because the old writers bucketed by UTC / server-local date.
 *
 * Rebuilds the correct US Eastern game-day from an ESPN refetch keyed on
 * espn_event_id: for each sport and each Eastern day in the window, pull the
 * scoreboard, recompute the day with sportDayISO(event.date), and update any
 * stored row whose date (or derived season) disagrees.
 *
 * Dry-run by default — prints what would change without writing.
 *
 *   node scripts/repair-game-result-dates.js                 # dry run, 60 days
 *   node scripts/repair-game-result-dates.js --days=120
 *   node scripts/repair-game-result-dates.js --sports=NBA,NHL
 *   node scripts/repair-game-result-dates.js --apply         # actually write
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { sportDayISO, sportDayCompact, sportDayParts, daysAgo } = require('../lib/services/sport-day.js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.log('❌ Missing Supabase configuration (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

// Same paths as api/cron/backfill-game-results.js
const SPORT_PATHS = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  NCAAB: 'basketball/mens-college-basketball',
  NCAAF: 'football/college-football',
  NHL: 'hockey/nhl',
  MLB: 'baseball/mlb',
  EPL: 'soccer/eng.1',
  MLS: 'soccer/usa.1',
  UFC: 'mma/ufc'
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function arg(name, fallback) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
}

async function main() {
  const days = parseInt(arg('days', '60'), 10);
  const sports = arg('sports', Object.keys(SPORT_PATHS).join(','))
    .split(',').map(s => s.trim().toUpperCase()).filter(s => SPORT_PATHS[s]);
  const apply = process.argv.includes('--apply');

  console.log(`\n🔧 Repairing game_results dates: last ${days} days, sports: ${sports.join(', ')}`);
  console.log(apply ? '⚠️  APPLY mode — rows will be updated' : '👀 Dry run — pass --apply to write');

  let totalChecked = 0;
  let totalWrong = 0;
  let totalFixed = 0;

  for (const sport of sports) {
    // 1. Refetch the correct Eastern day for every ESPN event in the window.
    const correctById = new Map();
    for (let d = 0; d < days; d++) {
      const anchor = daysAgo(d);
      const groups = (sport === 'NCAAB' || sport === 'NCAAF') ? '&groups=50' : '';
      const url = `${ESPN_BASE}/${SPORT_PATHS[sport]}/scoreboard?dates=${sportDayCompact(anchor)}${groups}&limit=200`;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        for (const event of (data.events || [])) {
          if (!event.id || !event.date) continue;
          const date = sportDayISO(event.date);
          const { year, month } = sportDayParts(event.date);
          const season = month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
          correctById.set(String(event.id), { date, season });
        }
      } catch (err) {
        console.warn(`  ⚠️ ${sport} ${sportDayCompact(anchor)}: ${err.message}`);
      }
      await sleep(300);
    }

    if (correctById.size === 0) {
      console.log(`  ${sport}: no ESPN events in window`);
      continue;
    }

    // 2. Compare stored rows against the refetched truth, in chunks.
    const ids = Array.from(correctById.keys());
    let sportWrong = 0;
    let sportFixed = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data: rows, error } = await supabase
        .from('game_results')
        .select('id, espn_event_id, date, season')
        .eq('sport', sport)
        .in('espn_event_id', chunk);
      if (error) {
        console.warn(`  ⚠️ ${sport} query error: ${error.message}`);
        continue;
      }
      for (const row of (rows || [])) {
        totalChecked++;
        const correct = correctById.get(String(row.espn_event_id));
        if (!correct) continue;
        if (row.date === correct.date && row.season === correct.season) continue;
        sportWrong++;
        console.log(`  ${sport} ${row.espn_event_id}: ${row.date} → ${correct.date}` +
          (row.season !== correct.season ? ` (season ${row.season} → ${correct.season})` : ''));
        if (apply) {
          const { error: upErr } = await supabase
            .from('game_results')
            .update({ date: correct.date, season: correct.season })
            .eq('id', row.id);
          if (upErr) console.warn(`    ⚠️ update failed: ${upErr.message}`);
          else sportFixed++;
        }
      }
    }

    totalWrong += sportWrong;
    totalFixed += sportFixed;
    console.log(`  ${sport}: ${sportWrong} misdated of ${correctById.size} ESPN events` +
      (apply ? `, ${sportFixed} fixed` : ''));
    await sleep(1000);
  }

  console.log(`\n✅ Done. Checked ${totalChecked} rows, ${totalWrong} misdated` +
    (apply ? `, ${totalFixed} repaired.` : ` (dry run — nothing written).`));
}

main().catch(err => {
  console.error('❌ Repair failed:', err);
  process.exit(1);
});
