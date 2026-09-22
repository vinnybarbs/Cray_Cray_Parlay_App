process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { formatWeightChange, formatDirective, formatDialBoard, maxStamp } = require('../../api/cron/discord-model-feed');
const { embedText } = require('../../lib/services/discord-alerts');

describe('formatWeightChange', () => {
  test('carries sport, component, before, after, reason and source', () => {
    const e = formatWeightChange({
      changed_at: '2026-09-21T18:11:10Z', sport: 'MLB', component: 'MLB, MLB:ml, MLB:spread multiplier 0.25 to 1',
      before: { multiplier: 0.25 }, after: { multiplier: 1 }, reason: 'Owner 2026-09-21 buckets not bands.', source: 'owner-approved-2026-09-21',
    });
    expect(e.title).toBe('🎛️ Dial moved · MLB');
    expect(e.description).toContain('multiplier 0.25 to 1');
    const byName = Object.fromEntries(e.fields.map(f => [f.name, f.value]));
    expect(byName.Before).toBe('multiplier: 0.25');
    expect(byName.After).toBe('multiplier: 1');
    expect(byName.Why).toContain('buckets not bands');
    expect(e.footer.text).toContain('owner-approved-2026-09-21');
  });

  test('nested json and long reasons are clipped, never thrown', () => {
    const e = formatWeightChange({ sport: 'NFL', component: 'x', before: { a: { b: [1, 2] } }, after: null, reason: 'r'.repeat(3000) });
    const byName = Object.fromEntries(e.fields.map(f => [f.name, f.value]));
    expect(byName.Before).toBe('a: {"b":[1,2]}');
    expect(byName.After).toBe('-');
    expect(byName.Why.length).toBeLessThanOrEqual(1024);
  });
});

describe('formatDirective', () => {
  test('new and amended directives are labeled', () => {
    const row = { id: 25, directive: 'Buckets, not bands.', decided_on: '2026-09-21', status: 'active', enforcement: 'check_sql' };
    expect(formatDirective(row, true).title).toBe('📜 Directive 25 · new');
    expect(formatDirective(row, false).title).toBe('📜 Directive 25 · amended');
    const e = formatDirective(row, true);
    expect(e.description).toBe('Buckets, not bands.');
    expect(embedText([e])).toContain('Status: active');
  });
});

describe('formatDialBoard', () => {
  const multipliers = [
    { key: '__global__', multiplier: '0.25' },
    { key: 'MLB', multiplier: '1.0' }, { key: 'MLB:ml', multiplier: '1.0' }, { key: 'MLB:spread', multiplier: '1.0' }, { key: 'MLB:total', multiplier: '1.0' },
    { key: 'NFL:ml', multiplier: '1.0' }, { key: 'NFL:spread', multiplier: '1.0' }, { key: 'NFL:total', multiplier: '1.0' },
    { key: 'EPL', multiplier: '1.0' }, { key: 'MLS', multiplier: '1.0' },
    { key: 'Tennis:ml', multiplier: '1.0' },
  ];
  const publishDials = [
    { sport: 'MLB', dial: 'publish_total', value: '0' },
    { sport: 'NFL', dial: 'publish_total', value: '0' },
    { sport: 'EPL', dial: 'publish_ml', value: '0' }, { sport: 'EPL', dial: 'publish_spread', value: '0' }, { sport: 'EPL', dial: 'publish_total', value: '0' },
    { sport: 'MLS', dial: 'publish_ml', value: '0' }, { sport: 'MLS', dial: 'publish_spread', value: '0' }, { sport: 'MLS', dial: 'publish_total', value: '0' },
    { sport: '__all__', dial: 'publish_ml', value: '1' },
  ];
  const changes = [
    { changed_at: '2026-09-21T18:11:10Z', sport: 'MLB', component: 'MLB, MLB:ml, MLB:spread multiplier 0.25 to 1', after: { multiplier: 1 }, source: 'owner-approved-2026-09-21' },
    { changed_at: '2026-09-21T18:11:10Z', sport: '__all__', component: 'band map retired', after: { tier: 'raw claim' }, source: 'owner-approved-2026-09-21' },
  ];
  const bucketTargets = [
    { sport: '__all__', band: 'Lean', floor_pp: '2' }, { sport: '__all__', band: 'Play', floor_pp: '4' },
    { sport: '__all__', band: 'Strong Play', floor_pp: '7' }, { sport: '__all__', band: 'Sharp Take', floor_pp: '10' },
  ];

  test('one field per live sport with multipliers and the week\'s moves, defaults first', () => {
    const e = formatDialBoard({ multipliers, changes, bucketTargets, publishDials, weekLabel: 'week of Sep 21' });
    expect(e.title).toBe('🎛️ Dial board · week of Sep 21');
    const names = e.fields.map(f => f.name);
    expect(names[0]).toBe('Every sport (defaults)');
    expect(names).toContain('MLB');
    expect(names).toContain('NFL');
    expect(names).toContain('Tennis');
    const byName = Object.fromEntries(e.fields.map(f => [f.name, f.value]));
    expect(byName.MLB).toContain('ml 1.00 · spread 1.00 · total 1.00');
    expect(byName.MLB).toContain('Muted (publish dial 0): total');
    expect(byName.MLB).toContain('Moved this week:');
    expect(byName.MLB).toContain('multiplier 0.25 to 1');
    expect(byName.NFL).toContain('No dial moves this week.');
    expect(byName['Every sport (defaults)']).toContain('band map retired');
    expect(e.description).toContain('Fallback multiplier __global__ 0.25');
  });

  test('a shadow sport (every publish dial 0) with no moves stays off the board', () => {
    const e = formatDialBoard({ multipliers, changes, bucketTargets, publishDials, weekLabel: 'w' });
    const names = e.fields.map(f => f.name);
    expect(names).not.toContain('EPL');
    expect(names).not.toContain('MLS');
  });

  test('bucket floors close the card, highest first', () => {
    const e = formatDialBoard({ multipliers, changes, bucketTargets: [...bucketTargets, { sport: 'NFL', band: 'Lean', floor_pp: '3' }], publishDials, weekLabel: 'w' });
    const floors = e.fields[e.fields.length - 1];
    expect(floors.name).toContain('Bucket floors');
    expect(floors.value).toContain('Sharp Take 10pp · Strong Play 7pp · Play 4pp · Lean 2pp');
    expect(floors.value).toContain('NFL Lean 3pp');
    expect(e.footer.text).toContain('no pixels');
  });

  test('every field value fits the Discord limit', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ sport: 'MLB', component: `move ${i} ${'x'.repeat(100)}`, after: { v: i } }));
    const e = formatDialBoard({ multipliers, changes: many, bucketTargets, publishDials, weekLabel: 'w' });
    for (const f of e.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
  });
});

// The cursor keeps the row's own microsecond string. Rebuilding it through
// a JS Date drops to milliseconds and lands just before the row, which
// re-posted directives 17 and 25 every hour on 2026-09-21.
describe('maxStamp', () => {
  test('returns the newest stamp as the original string, microseconds intact', () => {
    const rows = [
      { created_at: '2026-09-21T22:35:12.295399+00:00', updated_at: '2026-09-21T23:20:14.349811+00:00' },
      { created_at: '2026-09-21T17:19:36.464483+00:00', updated_at: '2026-09-21T23:20:14.349811+00:00' },
      { created_at: '2026-09-21T22:35:12.295399+00:00', updated_at: null },
    ];
    expect(maxStamp(rows, ['created_at', 'updated_at'])).toBe('2026-09-21T23:20:14.349811+00:00');
  });

  test('a cursor rebuilt through Date loses the microseconds the row keeps', () => {
    const row = '2026-09-21T23:20:14.349811+00:00';
    const viaDate = new Date(row).toISOString();
    expect(viaDate).toBe('2026-09-21T23:20:14.349Z');
    expect(maxStamp([{ updated_at: row }], ['updated_at'])).toBe(row);
  });

  test('empty or stampless rows give null', () => {
    expect(maxStamp([], ['changed_at'])).toBeNull();
    expect(maxStamp([{ x: 1 }], ['changed_at'])).toBeNull();
  });
});
