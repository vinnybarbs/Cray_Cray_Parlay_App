process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { formatMorningBoard } = require('../../api/cron/discord-morning-board');
const { splitDiscordContent, embedText } = require('../../lib/services/discord-alerts');

const rows = [
  { sport: 'MLB', pick: 'Kansas City Royals ML -112', edge_pp: 10.8, tier: 'Sharp Take', game_date: '2026-08-22T23:16:00Z' },
  { sport: 'MLB', pick: 'New York Yankees ML -104', edge_pp: 9.3, tier: 'Strong Play', game_date: '2026-08-22T17:36:00Z' },
  { sport: 'MLB', pick: 'Tampa Bay Rays ML -132', edge_pp: 2.9, tier: 'Lean', game_date: '2026-08-22T23:06:00Z' },
  { sport: 'MLB', pick: 'Los Angeles Dodgers ML -267', tier: 'Leg', model_prob: 0.69, game_date: '2026-08-23T02:10:00Z' },
  { sport: 'MLB', pick: 'New York Mets ML -150', edge_pp: -11.5, tier: 'Trap', game_date: '2026-08-22T19:10:00Z' },
];

describe('formatMorningBoard (embeds)', () => {
  test('every line carries the matchup, totals most of all', () => {
    // Owner report 2026-09-01: "Over 7.5 · MLB · 7.2pp" with no game
    // attached is useless in the channel.
    const msg = embedText(formatMorningBoard([
      { sport: 'MLB', pick: 'Over 7.5', edge_pp: 7.2, tier: 'Strong Play', game_date: '2026-09-01T22:41:00Z', home_team: 'Boston Red Sox', away_team: 'Seattle Mariners' },
      { sport: 'MLB', pick: 'Tampa Bay Rays -1.5', edge_pp: 12.9, tier: 'Sharp Take', game_date: '2026-09-01T22:41:00Z', home_team: 'Tampa Bay Rays', away_team: 'New York Mets' },
    ], 'Tuesday, Sep 1'));
    expect(msg).toContain('Over 7.5 · Seattle Mariners @ Boston Red Sox · MLB');
    expect(msg).toContain('Tampa Bay Rays -1.5 · New York Mets @ Tampa Bay Rays · MLB');
  });

  test('one embed per tier in ladder order, legs and traps at the end, header first', () => {
    const embeds = formatMorningBoard(rows, 'Saturday, Aug 22');
    expect(embeds[0].title).toContain('TrapHawk board · Saturday, Aug 22');
    const titles = embeds.map(e => e.title);
    const idx = (s) => titles.findIndex(t => t.startsWith(s));
    expect(idx('Sharp Take')).toBeGreaterThan(0);
    expect(idx('Sharp Take')).toBeLessThan(idx('Strong Play'));
    expect(idx('Strong Play')).toBeLessThan(idx('Lean'));
    expect(idx('Lean')).toBeLessThan(idx('Legs'));
    expect(idx('Legs')).toBeLessThan(idx('Traps'));
    const msg = embedText(embeds);
    expect(msg).toContain('69% to hit');
    expect(msg).toContain('fade these sides');
    expect(msg).toContain('Tiers revise with prices until lock');
  });

  test('no site link anywhere on the board (owner 2026-09-21)', () => {
    const msg = embedText(formatMorningBoard(rows, 'Saturday, Aug 22'));
    expect(msg).not.toContain('traphawk.io');
    expect(msg).not.toContain('http');
  });

  test('tier embeds carry their tier color', () => {
    const embeds = formatMorningBoard(rows, 'Saturday, Aug 22');
    const st = embeds.find(e => e.title.startsWith('Sharp Take'));
    const trap = embeds.find(e => e.title.startsWith('Traps'));
    expect(st.color).toBe(0xf5a623);
    expect(trap.color).toBe(0xe74c3c);
  });

  test('an empty board still posts the quiet-slate message with the footer', () => {
    const embeds = formatMorningBoard([], 'Sunday, Aug 23');
    expect(embeds).toHaveLength(1);
    expect(embeds[0].description).toContain('Quiet board');
    expect(embeds[0].footer.text).toContain('Tiers revise');
  });

  test('a bet-signal day never shows the high-percenter section', () => {
    const gimmes = [{ pick: 'Milwaukee Brewers ML -162', sport: 'MLB', implied: 0.61, game_date: '2026-08-26T00:10:00Z' }];
    const msg = embedText(formatMorningBoard(rows, 'Saturday, Aug 22', gimmes));
    expect(msg).not.toContain('No Sharp Take edge on the board');
    expect(msg).not.toContain('Brewers');
  });

  test('a no-signal day frames the high percenters as not plays', () => {
    const gimmes = [
      { pick: 'Los Angeles Dodgers ML -240', sport: 'MLB', implied: 0.68, game_date: '2026-08-26T02:10:00Z' },
      { pick: 'Milwaukee Brewers ML -162', sport: 'MLB', implied: 0.61, game_date: '2026-08-26T00:10:00Z' },
    ];
    const msg = embedText(formatMorningBoard([
      { sport: 'MLB', pick: 'Philadelphia Phillies ML -178', tier: 'Lean', edge_pp: 1.3, game_date: '2026-08-25T23:05:00Z' },
    ], 'Tuesday, Aug 25', gimmes));
    expect(msg).toContain('These are not plays');
    expect(msg).toContain('68% implied');
    expect(msg).toContain('61% implied');
  });

  test('legs keep the gimme framing, model percent to hit', () => {
    const msg = embedText(formatMorningBoard([
      { sport: 'Tennis', pick: 'Iga Swiatek ML -241', tier: 'Leg', model_prob: 0.687, game_date: '2026-08-25T19:00:00Z' },
    ], 'Tuesday, Aug 25'));
    expect(msg).toContain('69% to hit');
    expect(msg).toContain('gimmes');
  });

  test('a long Lean list splits across embeds instead of truncating', () => {
    const many = Array.from({ length: 90 }, (_, i) => ({
      sport: 'MLB', pick: `Team ${i} ML -1${i}0`, edge_pp: 2.5, tier: 'Lean', game_date: '2026-08-22T23:06:00Z',
      home_team: `Home Club Number ${i}`, away_team: `Away Club Number ${i}`,
    }));
    const embeds = formatMorningBoard(many, 'Saturday, Aug 22');
    const leanEmbeds = embeds.filter(e => e.title.startsWith('Leans'));
    expect(leanEmbeds.length).toBeGreaterThan(1);
    for (const e of leanEmbeds) expect(e.description.length).toBeLessThanOrEqual(4096);
    expect(embedText(embeds)).toContain('Team 89 ML');
  });
});

describe('splitDiscordContent', () => {
  test('short content is a single chunk', () => {
    expect(splitDiscordContent('hello\nworld')).toEqual(['hello\nworld']);
  });

  test('long content splits on line boundaries under the limit', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `• pick number ${i} with some padding text`);
    const chunks = splitDiscordContent(lines.join('\n'));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1900);
    expect(chunks.join('\n')).toBe(lines.join('\n'));
  });
});
