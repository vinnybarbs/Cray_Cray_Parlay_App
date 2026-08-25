process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { parseCsv, mapStatRow, defaultSeason } = require('../../api/cron/sync-nfl-player-stats');

describe('parseCsv', () => {
  test('quoted fields keep commas and escaped quotes', () => {
    const rows = parseCsv('a,b,c\n1,"two, with comma","say ""hi"""\n');
    expect(rows).toEqual([['a', 'b', 'c'], ['1', 'two, with comma', 'say "hi"']]);
  });

  test('quoted newlines stay inside the field and CRLF splits rows', () => {
    const rows = parseCsv('a,b\r\n"line\nbreak",2\r\n');
    expect(rows).toEqual([['a', 'b'], ['line\nbreak', '2']]);
  });
});

describe('mapStatRow', () => {
  const base = {
    player_id: '00-0023459', player_name: 'A.Rodgers', player_display_name: 'Aaron Rodgers',
    position: 'QB', season: '2025', week: '1', season_type: 'REG',
    game_id: '2025_01_PIT_NYJ', team: 'PIT', opponent_team: 'NYJ',
    completions: '22', attempts: '30', passing_yards: '244', passing_tds: '4',
    passing_interceptions: '0', carries: '1', rushing_yards: '-1', rushing_tds: '0',
    receptions: '0', targets: '0', receiving_yards: '0', receiving_tds: '0',
  };

  test('maps a QB line with normalized player key', () => {
    const row = mapStatRow(base);
    expect(row.player_name).toBe('Aaron Rodgers');
    expect(row.player_key).toBe('aaron rodgers');
    expect(row.passing_yards).toBe(244);
    expect(row.passing_tds).toBe(4);
    expect(row.rushing_yards).toBe(-1);
    expect(row.season).toBe(2025);
    expect(row.opponent).toBe('NYJ');
  });

  test('a pure defense line with no offensive touches is skipped', () => {
    const row = mapStatRow({
      ...base, player_display_name: 'T.J. Watt', position: 'LB',
      completions: '0', attempts: '0', carries: '0', targets: '0', receptions: '0',
    });
    expect(row).toBeNull();
  });

  test('rows without id, name, or game are skipped', () => {
    expect(mapStatRow({ ...base, player_id: '' })).toBeNull();
    expect(mapStatRow({ ...base, game_id: '' })).toBeNull();
    expect(mapStatRow({ ...base, player_name: '', player_display_name: '' })).toBeNull();
  });
});

describe('defaultSeason', () => {
  test('before September the season is last year, from September this year', () => {
    expect(defaultSeason(new Date('2026-08-25T12:00:00Z'))).toBe(2025);
    expect(defaultSeason(new Date('2026-09-15T12:00:00Z'))).toBe(2026);
    expect(defaultSeason(new Date('2027-01-10T12:00:00Z'))).toBe(2026);
  });
});
