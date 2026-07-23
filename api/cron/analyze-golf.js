// CRON: Golf field analysis. Devigs outright-winner odds into fair win
// probabilities, flag price-vs-consensus value, and write a researched note
// per player. This is a rich-data surface, NOT graded picks: golf has no
// h2h edge model, so nothing here feeds ai_suggestions or the ledger.
// Schedule: 10:30 / 16:30 / 22:30 UTC (pg_cron job analyze-golf).

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { MODELS, complete } = require('../../lib/services/claude.js');

function americanToProb(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}

// Higher decimal payout = better price for the bettor.
function decimalPayout(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n === 0) return 0;
  return n > 0 ? 1 + n / 100 : 1 + 100 / -n;
}

function slugToTitle(slug) {
  return slug
    .replace(/^golf_/, '')
    .replace(/_winner$/, '')
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function getEspnLive() {
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
    if (!res.ok) return null;
    const data = await res.json();
    const event = (data.events || [])[0];
    const comp = event?.competitions?.[0];
    if (!comp) return null;
    const players = {};
    (comp.competitors || []).forEach((p, idx) => {
      const name = p.athlete?.displayName;
      if (name) players[name.toLowerCase()] = { position: idx + 1, score: p.score || 'E' };
    });
    return { eventName: event.name || '', players };
  } catch {
    return null;
  }
}

async function getNewsLines(playerName) {
  try {
    const q = playerName.replace(/[(),]/g, '').trim();
    if (!q) return null;
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400e3).toISOString();
    const { data } = await supabase
      .from('news_articles')
      .select('title, betting_summary')
      .gte('published_at', fiveDaysAgo)
      .or(`title.ilike.%${q}%,summary.ilike.%${q}%`)
      .order('published_at', { ascending: false })
      .limit(2);
    if (!data || data.length === 0) return null;
    return data.map(a => a.betting_summary ? `${a.title}: ${a.betting_summary}` : a.title).join(' | ');
  } catch {
    return null;
  }
}

async function analyzeGolfHandler(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.status(202).json({ status: 'accepted', message: 'Golf field analysis started' });
  runGolfAnalysis().catch(err => console.error('Golf analysis background error:', err.message));
}

async function runGolfAnalysis() {
  const startTime = Date.now();
  try {
    await supabase.from('cron_job_logs').insert({
      job_name: 'analyze-golf', status: 'started', details: '{}',
    }).then(() => {}, () => {});

    const { data: oddsRows, error } = await supabase
      .from('odds_cache')
      .select('sport, bookmaker, outcomes, commence_time')
      .like('sport', 'golf_%')
      .eq('market_type', 'outrights');
    if (error) throw new Error(`odds_cache read failed: ${error.message}`);

    if (!oddsRows || oddsRows.length === 0) {
      await supabase.from('cron_job_logs').insert({
        job_name: 'analyze-golf', status: 'completed',
        details: JSON.stringify({ tournaments: 0, players: 0, note: 'no golf outrights in odds_cache' }),
      }).then(() => {}, () => {});
      return;
    }

    const espn = await getEspnLive();

    // Group by tournament, devig each book's field, blend into consensus.
    const byTournament = {};
    for (const row of oddsRows) {
      (byTournament[row.sport] ??= []).push(row);
    }

    let totalPlayers = 0;
    const activeTournaments = Object.keys(byTournament);

    for (const [key, rows] of Object.entries(byTournament)) {
      const tournamentName = slugToTitle(key);

      // Per-book devigged probabilities
      const perBook = {};
      for (const row of rows) {
        const outcomes = typeof row.outcomes === 'string' ? JSON.parse(row.outcomes) : (row.outcomes || []);
        const probs = {};
        let sum = 0;
        for (const o of outcomes) {
          const p = americanToProb(o.price);
          if (p != null && o.name) { probs[o.name] = { raw: p, price: o.price }; sum += p; }
        }
        if (sum <= 0) continue;
        for (const name of Object.keys(probs)) probs[name].fair = probs[name].raw / sum;
        perBook[row.bookmaker] = probs;
      }
      const books = Object.keys(perBook);
      if (books.length === 0) continue;

      // Blend into consensus + find each player's best available price
      const players = {};
      for (const book of books) {
        for (const [name, p] of Object.entries(perBook[book])) {
          const entry = (players[name] ??= { prices: {}, fairs: [] });
          entry.prices[book] = p.price;
          entry.fairs.push(p.fair);
        }
      }

      const records = [];
      for (const [name, p] of Object.entries(players)) {
        const consensus = p.fairs.reduce((a, b) => a + b, 0) / p.fairs.length;
        let bestBook = null, bestPrice = null, bestPayout = -1;
        for (const [book, price] of Object.entries(p.prices)) {
          const payout = decimalPayout(price);
          if (payout > bestPayout) { bestPayout = payout; bestPrice = price; bestBook = book; }
        }
        // Positive = the best available price implies a lower win prob than
        // the blended fair number, i.e. you're being paid better than fair.
        const bestImplied = americanToProb(bestPrice);
        const valuePp = bestImplied != null ? Math.round((consensus - bestImplied) * 1000) / 10 : null;

        const live = espn?.players?.[name.toLowerCase()] || null;
        records.push({
          tournament_key: key,
          tournament_name: tournamentName,
          player_name: name,
          prices: p.prices,
          best_price: bestPrice,
          best_book: bestBook,
          consensus_prob: Math.round(consensus * 10000) / 10000,
          value_pp: valuePp,
          espn_position: live?.position ?? null,
          espn_score: live?.score ?? null,
        });
      }

      records.sort((a, b) => b.consensus_prob - a.consensus_prob);

      // Research notes for the top of the field (cost control: one model
      // call per tournament covering up to 25 players).
      const noteTargets = records.slice(0, 25);
      for (const r of noteTargets) {
        r.news_context = await getNewsLines(r.player_name);
      }
      try {
        const lines = noteTargets.map(r => {
          const bits = [
            `${r.player_name}: best price ${r.best_price > 0 ? '+' : ''}${r.best_price}, consensus win ${(r.consensus_prob * 100).toFixed(1)}%`,
          ];
          if (r.espn_position) bits.push(`currently P${r.espn_position} (${r.espn_score})`);
          if (r.news_context) bits.push(`news: ${r.news_context}`);
          return `- ${bits.join(' | ')}`;
        }).join('\n');

        const prompt = `You are a golf betting researcher writing one tight note per player for the ${tournamentName}. Use ONLY the data below. Never invent results, stats, rankings, or injuries. If all you have is the price, write what the market is saying about them at that price.

WRITING STYLE: Plain punctuation only. Never use em dashes, en dashes, or semicolons in your output. Use periods and commas.

${lines}

Respond as JSON only, an array: [{"player": "<name exactly as given>", "note": "1-2 sentences"}]. Cover every listed player.`;

        const parsed = await complete({
          model: MODELS.NARRATION,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 4000,
          json: true,
        });
        if (Array.isArray(parsed)) {
          const byName = {};
          for (const n of parsed) if (n?.player) byName[n.player.toLowerCase()] = n.note;
          for (const r of noteTargets) {
            r.research_note = byName[r.player_name.toLowerCase()] || null;
          }
        }
      } catch (e) {
        console.warn(`Golf notes failed for ${key}: ${e.message}`);
      }

      // Replace the tournament's rows wholesale so dropped players clear out.
      await supabase.from('golf_field').delete().eq('tournament_key', key);
      const now = new Date().toISOString();
      for (const r of records) {
        const { error: upErr } = await supabase.from('golf_field').upsert(
          { ...r, generated_at: now },
          { onConflict: 'tournament_key,player_name' }
        );
        if (upErr) console.error(`golf_field upsert failed (${r.player_name}): ${upErr.message}`);
        else totalPlayers++;
      }
    }

    // Clear tournaments that no longer have odds (event started/finished).
    const { data: existing } = await supabase.from('golf_field').select('tournament_key');
    const stale = [...new Set((existing || []).map(r => r.tournament_key))].filter(k => !activeTournaments.includes(k));
    if (stale.length > 0) {
      await supabase.from('golf_field').delete().in('tournament_key', stale);
    }

    await supabase.from('cron_job_logs').insert({
      job_name: 'analyze-golf', status: 'completed',
      details: JSON.stringify({
        tournaments: activeTournaments.length,
        players: totalPlayers,
        stale_cleared: stale.length,
        duration_ms: Date.now() - startTime,
      }),
    }).then(() => {}, () => {});
    console.log(`Golf analysis complete: ${activeTournaments.length} tournaments, ${totalPlayers} players`);
  } catch (error) {
    console.error('Golf analysis failed:', error.message);
    await supabase.from('cron_job_logs').insert({
      job_name: 'analyze-golf', status: 'failed',
      details: JSON.stringify({ error: error.message }),
    }).then(() => {}, () => {});
  }
}

module.exports = analyzeGolfHandler;
