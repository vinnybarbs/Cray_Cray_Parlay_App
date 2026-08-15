/**
 * Probable starting pitchers for MLB analysis context.
 *
 * The single most game-specific fact in baseball, and until 2026-08-15
 * the analysis prompt never saw it: the edge calculator prices off
 * market disagreement (the market already prices the starters), but the
 * narration was writing about streaks because it was blind to who was
 * on the mound. ESPN's scoreboard carries probables per competitor, so
 * one fetch covers the whole slate.
 *
 * Fail-soft by design: no probables, a changed payload shape, or an
 * ESPN hiccup returns null for that game and the analysis proceeds
 * exactly as before. A probables change (late scratch) also changes the
 * context hash, which is what forces a re-narration, exactly what you
 * want when the starter changes.
 */

const { sportDayCompact, daysAgo } = require('./sport-day.js');

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const CACHE_TTL_MS = 30 * 60 * 1000;

let _cache = { at: 0, map: new Map() };

function noteFor(probable) {
  // ESPN shapes vary: sometimes statistics [{abbreviation, displayValue}],
  // sometimes a record string. Collect what exists, quietly skip the rest.
  const bits = [];
  const stats = Array.isArray(probable?.statistics) ? probable.statistics : [];
  for (const s of stats) {
    if (s?.abbreviation && s?.displayValue) bits.push(`${s.displayValue} ${s.abbreviation}`);
  }
  if (!bits.length && probable?.record) bits.push(String(probable.record));
  return bits.length ? ` (${bits.join(', ')})` : '';
}

async function loadSlate() {
  if (Date.now() - _cache.at < CACHE_TTL_MS && _cache.map.size > 0) return _cache.map;
  const map = new Map();
  // Today and tomorrow (site days), so evening runs see tomorrow's board.
  const days = [sportDayCompact(), sportDayCompact(daysAgo(-1))];
  for (const d of days) {
    try {
      const res = await fetch(`${SCOREBOARD}?dates=${d}`);
      if (!res.ok) continue;
      const data = await res.json();
      for (const event of data?.events || []) {
        const comp = event?.competitions?.[0];
        if (!comp?.competitors) continue;
        const entry = {};
        for (const c of comp.competitors) {
          const teamName = c?.team?.displayName;
          const probable = Array.isArray(c?.probables) ? c.probables[0] : null;
          const athlete = probable?.athlete?.displayName || probable?.athlete?.fullName;
          if (!teamName || !athlete) continue;
          entry[c.homeAway === 'home' ? 'home' : 'away'] = {
            team: teamName,
            pitcher: athlete,
            note: noteFor(probable),
          };
        }
        if (entry.home || entry.away) {
          const home = comp.competitors.find(c => c.homeAway === 'home')?.team?.displayName || '';
          const away = comp.competitors.find(c => c.homeAway === 'away')?.team?.displayName || '';
          map.set(`${away.toLowerCase()}|${home.toLowerCase()}`, entry);
        }
      }
    } catch (e) {
      console.warn(`Probable pitchers fetch failed for ${d}: ${e.message}`);
    }
  }
  if (map.size > 0) _cache = { at: Date.now(), map };
  return map;
}

/**
 * One-line prompt context for a matchup, or null when unknown.
 * "Probable starters: Logan Webb (12-7, 3.01 ERA) for San Francisco
 *  Giants vs Kyle Freeland (5-9, 5.24 ERA) for Colorado Rockies."
 */
async function getProbablePitchersText(homeTeam, awayTeam) {
  try {
    const map = await loadSlate();
    const key = `${String(awayTeam).toLowerCase()}|${String(homeTeam).toLowerCase()}`;
    let entry = map.get(key);
    if (!entry) {
      // Name-vocabulary fallback: substring match either direction.
      for (const [k, v] of map) {
        const [a, h] = k.split('|');
        if ((h.includes(String(homeTeam).toLowerCase()) || String(homeTeam).toLowerCase().includes(h))
          && (a.includes(String(awayTeam).toLowerCase()) || String(awayTeam).toLowerCase().includes(a))) {
          entry = v;
          break;
        }
      }
    }
    if (!entry) return null;
    const parts = [];
    if (entry.away) parts.push(`${entry.away.pitcher}${entry.away.note} for ${entry.away.team}`);
    if (entry.home) parts.push(`${entry.home.pitcher}${entry.home.note} for ${entry.home.team}`);
    if (!parts.length) return null;
    return parts.join(' vs ');
  } catch {
    return null;
  }
}

// Test seam: reset the module cache.
function _resetCache() {
  _cache = { at: 0, map: new Map() };
}

module.exports = { getProbablePitchersText, _resetCache };
