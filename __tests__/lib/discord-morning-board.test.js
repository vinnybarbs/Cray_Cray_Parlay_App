process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { formatMorningBoard } = require('../../api/cron/discord-morning-board');
const { splitDiscordContent } = require('../../lib/services/discord-alerts');

const rows = [
  { sport: 'MLB', pick: 'Kansas City Royals ML -112', edge_pp: 10.8, tier: 'Sharp Take', game_date: '2026-08-22T23:16:00Z' },
  { sport: 'MLB', pick: 'New York Yankees ML -104', edge_pp: 9.3, tier: 'Strong Play', game_date: '2026-08-22T17:36:00Z' },
  { sport: 'MLB', pick: 'Tampa Bay Rays ML -132', edge_pp: 2.9, tier: 'Lean', game_date: '2026-08-22T23:06:00Z' },
  { sport: 'MLB', pick: 'Los Angeles Dodgers ML -267', tier: 'Leg', model_prob: 0.69, game_date: '2026-08-23T02:10:00Z' },
  { sport: 'MLB', pick: 'New York Mets ML -150', edge_pp: -11.5, tier: 'Trap', game_date: '2026-08-22T19:10:00Z' },
];

describe('formatMorningBoard', () => {
  test('groups tiers in ladder order with legs and traps at the end', () => {
    const msg = formatMorningBoard(rows, 'Saturday, Aug 22');
    const idx = (s) => msg.indexOf(s);
    expect(idx('Sharp Take')).toBeGreaterThan(-1);
    expect(idx('Sharp Take')).toBeLessThan(idx('Strong Play'));
    expect(idx('Strong Play')).toBeLessThan(idx('Lean'));
    expect(idx('Lean')).toBeLessThan(idx('Legs'));
    expect(idx('Legs')).toBeLessThan(idx('Traps'));
    expect(msg).toContain('69% to hit');
    expect(msg).toContain('fade these sides');
    expect(msg).toContain('traphawk.io');
    expect(msg).toContain('Tiers revise with prices until lock');
  });

  test('an empty board still posts the quiet-slate message with the link', () => {
    const msg = formatMorningBoard([], 'Sunday, Aug 23');
    expect(msg).toContain('Quiet board');
    expect(msg).toContain('traphawk.io');
  });

  test('a bet-signal day never shows the no-edge explainer', () => {
    const msg = formatMorningBoard(rows, 'Saturday, Aug 22');
    expect(msg).not.toContain('No Sharp Take edge on the board');
  });

  test('legs lead with the market implied number and the model delta', () => {
    const msg = formatMorningBoard([
      { sport: 'MLB', pick: 'Philadelphia Phillies ML -178', tier: 'Lean', edge_pp: 1.3, game_date: '2026-08-25T23:05:00Z' },
      { sport: 'MLB', pick: 'Los Angeles Dodgers ML -240', tier: 'Leg', model_prob: 0.687, implied_prob: 0.68, edge_pp_raw: 7.2, game_date: '2026-08-26T02:10:00Z' },
      { sport: 'MLB', pick: 'Houston Astros ML -210', tier: 'Leg', model_prob: 0.66, implied_prob: 0.66, edge_pp_raw: 0.2, game_date: '2026-08-26T00:10:00Z' },
    ], 'Tuesday, Aug 25');
    expect(msg).toContain('No Sharp Take edge on the board right now');
    expect(msg).toContain('68% implied, model +7.2pp');
    // A sub-half-point delta is noise, the implied number stands alone.
    expect(msg).toContain('66% implied');
    expect(msg).not.toContain('66% implied, model');
    // Sorted by implied, biggest favorite first.
    expect(msg.indexOf('Dodgers')).toBeLessThan(msg.indexOf('Astros'));
  });

  test('legacy leg rows without implied still show the model read', () => {
    const msg = formatMorningBoard([
      { sport: 'Tennis', pick: 'Iga Swiatek ML -241', tier: 'Leg', model_prob: 0.687, game_date: '2026-08-25T19:00:00Z' },
    ], 'Tuesday, Aug 25');
    expect(msg).toContain('69% to hit');
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
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(1900);
      expect(c.startsWith('• ') || c.startsWith('•')).toBe(true);
    }
    expect(chunks.join('\n')).toBe(lines.join('\n'));
  });
});
