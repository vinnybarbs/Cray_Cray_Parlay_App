/**
 * UFC data service: ESPN parsers plus the pre-fight context builder.
 *
 * Same disease, same cure as tennis-data.js: UFC analyses said "records
 * and recent form are not available in our data sources" because the app
 * stored zero fighter data. The sync-ufc-data cron fills two tables
 * (ufc_fighters, ufc_fight_results) from the same ESPN hosts settlement
 * already uses (espn-results.js resolveUfc), and this module turns them
 * into the context block the analysis prompt and Deep Research modal use.
 *
 * Name keys reuse the tennis playerKey normalization so odds-feed
 * spellings join ESPN spellings.
 */

'use strict';

const { playerKey } = require('./tennis-data');

/**
 * Pull a career record string ("23-2-0") out of an ESPN records payload.
 * Shape: { items: [{ type/name, summary }] }. Prefers the overall/total
 * entry, falls back to the first item with a summary.
 */
function recordFromRecordsPayload(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const overall = items.find(i => /overall|total/i.test(i?.type || i?.name || ''));
  const chosen = overall || items.find(i => i?.summary);
  return chosen?.summary || null;
}

const RECENT_WINDOW_DAYS = 365;

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

function shortDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Summarize one fighter: career record row + stored fight results.
 * fights must be ordered newest first.
 */
function summarizeFighter(name, key, fighterRow, fights) {
  const recent = [];
  for (const f of fights) {
    if (recent.length >= 4) break;
    const won = f.winner_key === key;
    const opp = won ? f.loser_name : f.winner_name;
    recent.push(`${won ? 'W' : 'L'} vs ${opp} (${shortDate(f.fight_date)}${f.event ? `, ${f.event}` : ''})`);
  }
  const lastFight = fights[0] || null;
  const layoffDays = lastFight
    ? Math.round((Date.now() - new Date(`${lastFight.fight_date}T12:00:00Z`).getTime()) / 86400000)
    : null;
  return {
    name,
    key,
    record: fighterRow ? fighterRow.record : null,
    recentLines: recent,
    lastFightDate: lastFight ? lastFight.fight_date : null,
    layoffDays,
  };
}

/**
 * Fetch and assemble UFC context for one fight from the two ufc tables.
 * Returns null on query failure; empty-data results still return the
 * structure.
 */
async function getUfcContext(supabase, homeName, awayName) {
  const homeKey = playerKey(homeName);
  const awayKey = playerKey(awayName);
  if (!homeKey || !awayKey) return null;

  try {
    const recentFloor = daysAgoIso(RECENT_WINDOW_DAYS);
    const [fighterRes, fightRes, h2hRes] = await Promise.all([
      supabase
        .from('ufc_fighters')
        .select('fighter_key, fighter_name, record')
        .in('fighter_key', [homeKey, awayKey]),
      supabase
        .from('ufc_fight_results')
        .select('event, fight_date, winner_name, winner_key, loser_name, loser_key')
        .or(`winner_key.in.("${homeKey}","${awayKey}"),loser_key.in.("${homeKey}","${awayKey}")`)
        .gte('fight_date', recentFloor)
        .order('fight_date', { ascending: false })
        .limit(20),
      supabase
        .from('ufc_fight_results')
        .select('event, fight_date, winner_name, winner_key')
        .or(`and(winner_key.eq."${homeKey}",loser_key.eq."${awayKey}"),and(winner_key.eq."${awayKey}",loser_key.eq."${homeKey}")`)
        .order('fight_date', { ascending: false })
        .limit(5),
    ]);
    if (fighterRes.error || fightRes.error) return null;

    const fighters = fighterRes.data || [];

    // Compound-surname fallback: the odds feed writes "Yadier DelValle",
    // ESPN writes "Yadier Del Valle", and the keys differ only by an
    // internal space. When the exact key misses, compare space-squashed
    // keys against candidates sharing the first name token and alias the
    // hit onto the odds-feed key so the rest of the builder finds it.
    const squash = (k) => String(k || '').replace(/ /g, '');
    for (const key of [homeKey, awayKey]) {
      if (fighters.find(f => f.fighter_key === key)) continue;
      const first = key.split(' ')[0];
      if (!first) continue;
      const { data: cands } = await supabase
        .from('ufc_fighters')
        .select('fighter_key, fighter_name, record')
        .like('fighter_key', `${first}%`)
        .limit(10);
      const hit = (cands || []).find(c => squash(c.fighter_key) === squash(key));
      if (hit) fighters.push({ ...hit, fighter_key: key });
    }
    const fights = fightRes.data || [];
    const rowFor = (key) => fighters.find(f => f.fighter_key === key) || null;
    const fightsFor = (key) => fights.filter(f => f.winner_key === key || f.loser_key === key);

    return {
      home: summarizeFighter(homeName, homeKey, rowFor(homeKey), fightsFor(homeKey)),
      away: summarizeFighter(awayName, awayKey, rowFor(awayKey), fightsFor(awayKey)),
      h2h: h2hRes.data || [],
    };
  } catch {
    return null;
  }
}

/**
 * Render the context block for the analysis prompt. Returns null when
 * neither fighter has stored data, preserving the prompt's no-data
 * honesty rule.
 */
function formatUfcContext(ctx) {
  if (!ctx) return null;
  const { home, away, h2h } = ctx;
  const hasData = (f) => f.record != null || f.recentLines.length > 0;
  if (!hasData(home) && !hasData(away)) return null;

  const lines = ['--- UFC DATA (stored fighter records and results) ---'];
  for (const f of [home, away]) {
    const bits = [];
    if (f.record) bits.push(`career record ${f.record}`);
    if (f.layoffDays != null) {
      bits.push(`last fought ${shortDate(f.lastFightDate)} (${f.layoffDays} days ago${f.layoffDays >= 365 ? ', long layoff' : ''})`);
    }
    lines.push(`${f.name}: ${bits.length > 0 ? bits.join('; ') : 'no stored record or recent results'}`);
    for (const r of f.recentLines) lines.push(`  ${r}`);
  }
  if (h2h.length > 0) {
    const latest = h2h[0];
    lines.push(`Head-to-head (stored results): ${latest.winner_name} won the most recent meeting (${shortDate(latest.fight_date)}).`);
  } else {
    lines.push('Head-to-head: no prior meeting in stored results.');
  }
  lines.push('--- END UFC DATA ---');
  return lines.join('\n');
}

module.exports = {
  recordFromRecordsPayload,
  summarizeFighter,
  getUfcContext,
  formatUfcContext,
  RECENT_WINDOW_DAYS,
};
