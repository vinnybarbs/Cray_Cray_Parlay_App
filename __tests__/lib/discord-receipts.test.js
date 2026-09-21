process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { formatReceipts } = require('../../api/cron/discord-receipts');
const { embedText } = require('../../lib/services/discord-alerts');

const rows = [
  { sport: 'MLB', pick: 'Atlanta Braves -1.5', edge_pp: 10.6, tier: 'Sharp Take', actual_outcome: 'won', home_team: 'Atlanta Braves', away_team: 'Cincinnati Reds' },
  { sport: 'MLB', pick: 'Texas Rangers -1.5', edge_pp: 9.8, tier: 'Strong Play', actual_outcome: 'lost', home_team: 'Texas Rangers', away_team: 'New York Mets' },
  { sport: 'MLB', pick: 'Philadelphia Phillies ML -157', edge_pp: 3.3, tier: 'Lean', actual_outcome: 'won', home_team: 'New York Mets', away_team: 'Philadelphia Phillies' },
  { sport: 'MLB', pick: 'New York Yankees ML -102', edge_pp: 5.1, tier: 'Lean', actual_outcome: 'push', home_team: 'Arizona Diamondbacks', away_team: 'New York Yankees' },
  { sport: 'MLB', pick: 'New York Mets ML -150', edge_pp: -11.5, tier: 'Trap', actual_outcome: 'won', home_team: 'New York Mets', away_team: 'Philadelphia Phillies' },
  { sport: 'NFL', pick: 'Dallas Cowboys ML -205', edge_pp: 0.7, tier: 'Leg', actual_outcome: 'won', model_prob: 0.68, home_team: 'Dallas Cowboys', away_team: 'Washington Commanders' },
];

const record = [
  { period_bucket: 'last_3d', dimension_type: 'overall', dimension_value: 'all', won: 26, lost: 13, push: 0, roi_units: '8.61' },
  { period_bucket: 'last_7d', dimension_type: 'overall', dimension_value: 'all', won: 67, lost: 46, push: 0, roi_units: '9.302' },
  { period_bucket: 'last_30d', dimension_type: 'overall', dimension_value: 'all', won: 307, lost: 264, push: 6, roi_units: '10.604' },
  { period_bucket: 'last_7d', dimension_type: 'tier', dimension_value: 'Play', won: 25, lost: 9, push: 0, roi_units: '16.02' },
  { period_bucket: 'last_7d', dimension_type: 'tier', dimension_value: 'Sharp Take', won: 0, lost: 0, push: 0, roi_units: '0' },
  { period_bucket: 'last_30d', dimension_type: 'tier', dimension_value: 'Sharp Take', won: 13, lost: 23, push: 0, roi_units: '-8.7' },
];

describe('formatReceipts', () => {
  test('header, one embed per settled tier, then the record card', () => {
    const embeds = formatReceipts(rows, record, 'Monday, Sep 21');
    expect(embeds[0].title).toContain('Receipts · Monday, Sep 21');
    expect(embeds[0].description).toContain('6 settled reads');
    const titles = embeds.map(e => e.title);
    expect(titles.some(t => t.startsWith('Sharp Take · 1-0'))).toBe(true);
    expect(titles.some(t => t.startsWith('Strong Play · 0-1'))).toBe(true);
    expect(titles.some(t => t.startsWith('Leans · 1-0'))).toBe(true);
    expect(titles.some(t => t.startsWith('Traps · fades that held 1'))).toBe(true);
    expect(titles.some(t => t.startsWith('Legs · 1 hit'))).toBe(true);
    expect(embeds[embeds.length - 1].title).toContain('Record');
  });

  test('marks and matchups on every receipt, Sharp Take hits called out', () => {
    const msg = embedText(formatReceipts(rows, record, 'Monday, Sep 21'));
    expect(msg).toContain('✅ 🦅 Atlanta Braves -1.5 · Cincinnati Reds @ Atlanta Braves · MLB · 10.6pp');
    expect(msg).toContain('❌ Texas Rangers -1.5 · New York Mets @ Texas Rangers · MLB · 9.8pp');
    expect(msg).toContain('➖ New York Yankees ML -102');
    expect(msg).toContain('✅ Fade New York Mets ML -150');
    expect(msg).toContain('✅ Dallas Cowboys ML -205 · Washington Commanders @ Dallas Cowboys · NFL');
  });

  test('the record card reads mv_public_record rows only, three windows plus the 7 day ladder', () => {
    const embeds = formatReceipts(rows, record, 'Monday, Sep 21');
    const card = embeds[embeds.length - 1];
    const byName = Object.fromEntries(card.fields.map(f => [f.name, f.value]));
    expect(byName['Last 3 days']).toBe('26-13 · +8.6u');
    expect(byName['Last 7 days']).toBe('67-46 · +9.3u');
    expect(byName['Last 30 days']).toBe('307-264-6 · +10.6u');
    expect(byName['By tier, last 7 days']).toContain('Play 25-9 · +16.0u');
    expect(byName['By tier, last 7 days']).toContain('Sharp Take 0-0');
    expect(byName['By tier, last 7 days']).not.toContain('13-23');
    expect(card.footer.text).toContain('mv_public_record');
  });

  test('no settled picks still posts the record card', () => {
    const embeds = formatReceipts([], record, 'Sunday, Sep 20');
    expect(embeds).toHaveLength(2);
    expect(embeds[0].description).toContain('No settled picks for Sunday, Sep 20');
    expect(embeds[1].title).toContain('Record');
  });

  test('no links anywhere', () => {
    const msg = embedText(formatReceipts(rows, record, 'Monday, Sep 21'));
    expect(msg).not.toContain('http');
  });
});
