/**
 * Tennis data service: ESPN rankings/results parsers plus the pre-match
 * context builder.
 *
 * Why this exists: every tennis analysis prompt used to carry only odds.
 * The context fetchers in pre-analyze-games.js all read team-sport tables
 * (current_standings, news_cache injuries, player_game_stats) that have no
 * tennis rows, so Claude truthfully wrote "records not available" on every
 * tennis card. This module gives tennis its own context path backed by two
 * tables (tennis_rankings, tennis_match_results) that the sync-tennis-data
 * cron fills from ESPN's public tennis API, the same host espn-results.js
 * already uses for settlement.
 *
 * Parsers are pure functions over ESPN payloads so they can be unit tested
 * without network access. ESPN shapes drift, so every read is defensive.
 */

'use strict';

/**
 * Normalize a player name into the join key shared by odds-feed and ESPN
 * spellings: lowercase, diacritics stripped, punctuation dropped, spaces
 * collapsed. "Fábián Marozsán" and "Fabian Marozsan" both give
 * "fabian marozsan".
 */
function playerKey(name) {
  if (!name) return null;
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

/**
 * Parse an ESPN rankings payload into rows for tennis_rankings.
 * Known shape: { rankings: [{ ranks: [{ current, points, athlete: { displayName } }] }] }
 * with fallbacks for entries that use rank/fullName instead.
 */
function parseRankingsPayload(payload, tour) {
  const groups = Array.isArray(payload?.rankings) ? payload.rankings : [payload];
  const rows = [];
  const seen = new Set();
  for (const group of groups) {
    for (const entry of (group?.ranks || [])) {
      const name = entry?.athlete?.displayName || entry?.athlete?.fullName || null;
      const rank = Number(entry?.current ?? entry?.rank);
      const key = playerKey(name);
      if (!key || !Number.isFinite(rank) || rank <= 0 || seen.has(key)) continue;
      seen.add(key);
      const points = Number(entry?.points);
      rows.push({
        tour,
        player_key: key,
        player_name: name,
        rank,
        points: Number.isFinite(points) ? points : null,
        updated_at: new Date().toISOString(),
      });
    }
  }
  return rows;
}

/**
 * Build a "6-4, 7-6" score string from the winner's perspective using both
 * competitors' per-set linescores. Returns null when linescores are absent.
 */
function scoreFromLinescores(winner, loser) {
  const w = winner?.linescores, l = loser?.linescores;
  if (!Array.isArray(w) || !Array.isArray(l) || w.length === 0 || w.length !== l.length) return null;
  const sets = [];
  for (let i = 0; i < w.length; i++) {
    const wg = Number(w[i]?.value), lg = Number(l[i]?.value);
    if (!Number.isFinite(wg) || !Number.isFinite(lg)) return null;
    sets.push(`${wg}-${lg}`);
  }
  return sets.join(', ');
}

function finishTypeFromStatus(status) {
  const n = String(status?.type?.name || '').toUpperCase();
  if (n.includes('RETIRED')) return 'retired';
  if (n.includes('WALKOVER')) return 'walkover';
  return 'completed';
}

/**
 * Parse an ESPN tennis scoreboard payload into rows for tennis_match_results.
 * Shape (per espn-results.js): events[] are tournaments, each with
 * groupings[] (draw categories) holding competitions[] (matches) with
 * competitors[].athlete.displayName and a winner flag. Doubles draws are
 * skipped; the model and the odds feed are singles only.
 *
 * fallbackDate is the YYYY-MM-DD the scoreboard was requested for, used when
 * a competition carries no usable date of its own.
 */
function parseScoreboardPayload(payload, tour, fallbackDate) {
  const rows = [];
  const seen = new Set();
  for (const event of (payload?.events || [])) {
    const tournament = event?.name || event?.shortName || null;
    for (const grouping of (event?.groupings || [])) {
      const drawName = grouping?.grouping?.displayName || grouping?.displayName || '';
      if (/doubles/i.test(drawName)) continue;
      for (const comp of (grouping?.competitions || [])) {
        if (comp?.status?.type?.state !== 'post') continue;
        const competitors = comp?.competitors || [];
        if (competitors.length !== 2) continue;
        const winner = competitors.find(c => c?.winner === true);
        const loser = competitors.find(c => c?.winner !== true);
        if (!winner || !loser) continue;
        const winnerName = winner?.athlete?.displayName || null;
        const loserName = loser?.athlete?.displayName || null;
        const winnerKey = playerKey(winnerName);
        const loserKey = playerKey(loserName);
        if (!winnerKey || !loserKey || winnerKey === loserKey) continue;

        const rawDate = comp?.date || event?.date || null;
        const matchDate = rawDate && !Number.isNaN(Date.parse(rawDate))
          ? new Date(rawDate).toISOString().split('T')[0]
          : fallbackDate;
        if (!matchDate) continue;

        const dedupeKey = `${tour}|${matchDate}|${winnerKey}|${loserKey}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        rows.push({
          tour,
          tournament,
          round: comp?.round?.displayName || null,
          match_date: matchDate,
          winner_name: winnerName,
          winner_key: winnerKey,
          loser_name: loserName,
          loser_key: loserKey,
          score: scoreFromLinescores(winner, loser),
          finish_type: finishTypeFromStatus(comp?.status),
          source: 'espn',
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Pre-match context
// ---------------------------------------------------------------------------

const RECENT_WINDOW_DAYS = 30;
const WORKLOAD_WINDOW_DAYS = 14;

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

function shortDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Summarize one player's stored data: ranking row + recent results.
 * matches must be ordered newest first and only contain rows where the
 * player is winner or loser.
 */
function summarizePlayer(name, key, rankingRow, matches) {
  const recent = [];
  let wins = 0, losses = 0, last14 = 0;
  const workloadFloor = daysAgoIso(WORKLOAD_WINDOW_DAYS);
  for (const m of matches) {
    const won = m.winner_key === key;
    if (won) wins++; else losses++;
    if (m.match_date >= workloadFloor && m.finish_type !== 'walkover') last14++;
    if (recent.length < 6) {
      const opp = won ? m.loser_name : m.winner_name;
      const score = m.score ? ` ${m.score}` : '';
      const ret = m.finish_type === 'retired' ? ' (ret.)' : m.finish_type === 'walkover' ? ' (w/o)' : '';
      const where = m.tournament ? `, ${m.tournament}` : '';
      recent.push(`${won ? 'W' : 'L'} vs ${opp}${score}${ret} (${shortDate(m.match_date)}${where})`);
    }
  }
  return {
    name,
    key,
    rank: rankingRow ? rankingRow.rank : null,
    points: rankingRow && rankingRow.points != null ? Number(rankingRow.points) : null,
    tour: rankingRow ? rankingRow.tour : null,
    record30d: matches.length > 0 ? `${wins}-${losses}` : null,
    matchesLast14: last14,
    recentLines: recent,
  };
}

/**
 * Fetch and assemble tennis context for one matchup from the two tennis
 * tables. Returns null only on query failure; an empty-data result still
 * returns the structure so the caller can distinguish "no data synced yet"
 * from "query broke".
 */
async function getTennisContext(supabase, homeName, awayName) {
  const homeKey = playerKey(homeName);
  const awayKey = playerKey(awayName);
  if (!homeKey || !awayKey) return null;

  try {
    const recentFloor = daysAgoIso(RECENT_WINDOW_DAYS);
    const [rankRes, matchRes] = await Promise.all([
      supabase
        .from('tennis_rankings')
        .select('tour, player_key, player_name, rank, points')
        .in('player_key', [homeKey, awayKey]),
      supabase
        .from('tennis_match_results')
        .select('tour, tournament, round, match_date, winner_name, winner_key, loser_name, loser_key, score, finish_type')
        // playerKey output is [a-z0-9 ] only, so raw interpolation is safe
        // for PostgREST filter syntax (no commas, parens, or quotes possible).
        .or(`winner_key.in.("${homeKey}","${awayKey}"),loser_key.in.("${homeKey}","${awayKey}")`)
        .gte('match_date', recentFloor)
        .order('match_date', { ascending: false })
        .limit(60),
    ]);
    if (rankRes.error || matchRes.error) return null;

    const rankings = rankRes.data || [];
    const matches = matchRes.data || [];
    const rankFor = (key) => rankings.find(r => r.player_key === key) || null;
    const matchesFor = (key) => matches.filter(m => m.winner_key === key || m.loser_key === key);

    // H2H across the full stored history, not just the 30-day window.
    const { data: h2hRows } = await supabase
      .from('tennis_match_results')
      .select('match_date, tournament, winner_key, winner_name, score')
      .or(`and(winner_key.eq."${homeKey}",loser_key.eq."${awayKey}"),and(winner_key.eq."${awayKey}",loser_key.eq."${homeKey}")`)
      .order('match_date', { ascending: false })
      .limit(10);

    return {
      home: summarizePlayer(homeName, homeKey, rankFor(homeKey), matchesFor(homeKey)),
      away: summarizePlayer(awayName, awayKey, rankFor(awayKey), matchesFor(awayKey)),
      h2h: h2hRows || [],
    };
  } catch {
    return null;
  }
}

/**
 * Render the context block injected into the analysis prompt. Returns null
 * when neither player has any stored data, so the prompt's "no data" honesty
 * rule still applies instead of an empty header implying data exists.
 */
function formatTennisContext(ctx) {
  if (!ctx) return null;
  const { home, away, h2h } = ctx;
  const hasData = (p) => p.rank != null || p.recentLines.length > 0;
  if (!hasData(home) && !hasData(away)) return null;

  const lines = ['--- TENNIS DATA (stored ATP/WTA rankings and results) ---'];
  for (const p of [home, away]) {
    const bits = [];
    if (p.rank != null) {
      const tourLabel = p.tour ? p.tour.toUpperCase() : 'tour';
      bits.push(`${tourLabel} rank #${p.rank}${p.points != null ? ` (${p.points} pts)` : ''}`);
    }
    if (p.record30d) bits.push(`last ${RECENT_WINDOW_DAYS} days: ${p.record30d}`);
    if (p.recentLines.length > 0) {
      bits.push(`${p.matchesLast14} match${p.matchesLast14 === 1 ? '' : 'es'} in last ${WORKLOAD_WINDOW_DAYS} days${p.matchesLast14 >= 5 ? ' (heavy workload)' : ''}`);
    }
    lines.push(`${p.name}: ${bits.length > 0 ? bits.join('; ') : 'no stored ranking or recent results'}`);
    for (const r of p.recentLines) lines.push(`  ${r}`);
  }

  if (h2h.length > 0) {
    let homeWins = 0, awayWins = 0;
    for (const m of h2h) {
      if (m.winner_key === home.key) homeWins++; else awayWins++;
    }
    const leader = homeWins >= awayWins ? home.name : away.name;
    const record = homeWins >= awayWins ? `${homeWins}-${awayWins}` : `${awayWins}-${homeWins}`;
    const latest = h2h[0];
    lines.push(`Head-to-head (stored results): ${leader} leads ${record}. Most recent: ${latest.winner_name} won${latest.score ? ` ${latest.score}` : ''} (${shortDate(latest.match_date)}${latest.tournament ? `, ${latest.tournament}` : ''})`);
  } else {
    lines.push('Head-to-head: no prior meeting in stored results.');
  }
  lines.push('--- END TENNIS DATA ---');
  return lines.join('\n');
}

module.exports = {
  playerKey,
  parseRankingsPayload,
  parseScoreboardPayload,
  scoreFromLinescores,
  finishTypeFromStatus,
  summarizePlayer,
  getTennisContext,
  formatTennisContext,
  RECENT_WINDOW_DAYS,
  WORKLOAD_WINDOW_DAYS,
};
