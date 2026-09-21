process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { formatWeightChange, formatDirective, formatDialBoard } = require('../../api/cron/discord-model-feed');
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
    { key: 'MLB', multiplier: '1.0' }, { key: 'MLB:ml', multiplier: '1.0' }, { key: 'MLB:spread', multiplier: '1.0' }, { key: 'MLB:total', multiplier: '0' },
    { key: 'NFL:ml', multiplier: '0.25' }, { key: 'NFL:spread', multiplier: '0.10' }, { key: 'NFL:total', multiplier: '0' },
    { key: 'EPL', multiplier: '0.00' }, { key: 'MLS', multiplier: '0.00' },
    { key: 'Tennis:ml', multiplier: '0.4986' },
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
    const e = formatDialBoard({ multipliers, changes, bucketTargets, weekLabel: 'week of Sep 21' });
    expect(e.title).toBe('🎛️ Dial board · week of Sep 21');
    const names = e.fields.map(f => f.name);
    expect(names[0]).toBe('Every sport (defaults)');
    expect(names).toContain('MLB');
    expect(names).toContain('NFL');
    expect(names).toContain('Tennis');
    const byName = Object.fromEntries(e.fields.map(f => [f.name, f.value]));
    expect(byName.MLB).toContain('ml 1.00 · spread 1.00 · total 0.00 (muted)');
    expect(byName.MLB).toContain('Moved this week:');
    expect(byName.MLB).toContain('multiplier 0.25 to 1');
    expect(byName.NFL).toContain('No dial moves this week.');
    expect(byName['Every sport (defaults)']).toContain('band map retired');
    expect(e.description).toContain('Fallback multiplier __global__ 0.25');
  });

  test('a sport with every multiplier muted and no moves stays off the board', () => {
    const e = formatDialBoard({ multipliers, changes, bucketTargets, weekLabel: 'w' });
    const names = e.fields.map(f => f.name);
    expect(names).not.toContain('EPL');
    expect(names).not.toContain('MLS');
  });

  test('bucket floors close the card, highest first', () => {
    const e = formatDialBoard({ multipliers, changes, bucketTargets: [...bucketTargets, { sport: 'NFL', band: 'Lean', floor_pp: '3' }], weekLabel: 'w' });
    const floors = e.fields[e.fields.length - 1];
    expect(floors.name).toContain('Bucket floors');
    expect(floors.value).toContain('Sharp Take 10pp · Strong Play 7pp · Play 4pp · Lean 2pp');
    expect(floors.value).toContain('NFL Lean 3pp');
    expect(e.footer.text).toContain('no pixels');
  });

  test('every field value fits the Discord limit', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ sport: 'MLB', component: `move ${i} ${'x'.repeat(100)}`, after: { v: i } }));
    const e = formatDialBoard({ multipliers, changes: many, bucketTargets, weekLabel: 'w' });
    for (const f of e.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
  });
});
