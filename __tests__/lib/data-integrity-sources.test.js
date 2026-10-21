const {
  approvedRecordSource,
  soccerOrderMixup,
  recordsUnverified,
  checkableRecord,
  recordCheckGames,
  webSearchTool,
  RECORD_SOURCES,
  BANNED_SOURCES,
} = require('../../lib/services/data-integrity-agent');

// Owner 2026-09-21: records come from ESPN, CBS Sports, Yahoo Sports, Fox
// Sports or the league's own site, never Wikipedia.
describe('approvedRecordSource', () => {
  test('rejects Wikipedia in any form', () => {
    expect(approvedRecordSource('https://en.wikipedia.org/wiki/2026_Baltimore_Orioles_season')).toBe(false);
    expect(approvedRecordSource('Wikipedia')).toBe(false);
    expect(approvedRecordSource('ESPN, cross checked with Wikipedia')).toBe(false);
  });

  test('accepts standings URLs on the approved hosts and their subdomains', () => {
    expect(approvedRecordSource('https://www.espn.com/mlb/standings')).toBe(true);
    expect(approvedRecordSource('https://www.cbssports.com/mlb/standings/')).toBe(true);
    expect(approvedRecordSource('https://sports.yahoo.com/mlb/standings/')).toBe(true);
    expect(approvedRecordSource('https://www.foxsports.com/mlb/standings')).toBe(true);
    expect(approvedRecordSource('https://www.mlb.com/standings')).toBe(true);
    expect(approvedRecordSource('https://www.nfl.com/standings/')).toBe(true);
  });

  test('rejects URLs on any other host', () => {
    expect(approvedRecordSource('https://www.baseball-reference.com/leagues/majors/2026-standings.shtml')).toBe(false);
    expect(approvedRecordSource('https://www.yahoo.com/news/some-story')).toBe(false);
    expect(approvedRecordSource('https://notespn.com/standings')).toBe(false);
  });

  test('accepts a plain outlet name and rejects an empty or unknown one', () => {
    expect(approvedRecordSource('ESPN MLB standings')).toBe(true);
    expect(approvedRecordSource('CBS Sports')).toBe(true);
    expect(approvedRecordSource('Yahoo Sports')).toBe(true);
    expect(approvedRecordSource('')).toBe(false);
    expect(approvedRecordSource(null)).toBe(false);
    expect(approvedRecordSource('a fan blog')).toBe(false);
  });
});

describe('webSearchTool', () => {
  test('the records search is fenced to the approved list and carries no block list', () => {
    const tool = webSearchTool(8, { allowedDomains: RECORD_SOURCES, blockedDomains: BANNED_SOURCES });
    expect(tool.allowed_domains).toEqual(RECORD_SOURCES);
    expect(tool.blocked_domains).toBeUndefined();
    expect(tool.allowed_domains.some((d) => d.includes('wikipedia'))).toBe(false);
  });

  test('other searches block Wikipedia', () => {
    const tool = webSearchTool(6, { blockedDomains: BANNED_SOURCES });
    expect(tool.blocked_domains).toContain('wikipedia.org');
    expect(tool.allowed_domains).toBeUndefined();
    expect(tool.max_uses).toBe(6);
  });
});

// 2026-10-16: four soccer mismatches were the same record with draws and
// losses read in the other order.
describe('soccerOrderMixup', () => {
  test('flags the draw and loss slots swapped with the same wins', () => {
    expect(soccerOrderMixup('3-2-1', '3-1-2')).toBe(true);
    expect(soccerOrderMixup('2-2-4', '2-4-2')).toBe(true);
    expect(soccerOrderMixup('1-2-3', '1 - 3 - 2')).toBe(true);
  });

  test('keeps real conflicts', () => {
    expect(soccerOrderMixup('3-2-1', '4-1-1')).toBe(false);
    expect(soccerOrderMixup('3-2-1', '2-1-3')).toBe(false);
    expect(soccerOrderMixup('2-2-2', '2-2-2')).toBe(false);
    expect(soccerOrderMixup('3-2', '3-2-1')).toBe(false);
    expect(soccerOrderMixup(null, '3-1-2')).toBe(false);
  });
});

// Ops check 2026-10-20: three sweeps handed the verifier teams, it checked
// none, and every run logged success.
describe('recordsUnverified', () => {
  test('teams sent and none checked is a gap', () => {
    expect(recordsUnverified(16, 0)).toBe(true);
    expect(recordsUnverified(16, null)).toBe(true);
  });

  test('a check that saw any record, or had no teams to check, is not', () => {
    expect(recordsUnverified(16, 6)).toBe(false);
    expect(recordsUnverified(0, 0)).toBe(false);
  });
});

// Build_queue 119: 16 teams over six leagues ran the verifier out of
// searches, and null or preseason 0-0 records burned the rest.
describe('checkableRecord', () => {
  test('a record with any game played is checkable', () => {
    expect(checkableRecord('3-2')).toBe(true);
    expect(checkableRecord('0-1')).toBe(true);
    expect(checkableRecord('2-1-0')).toBe(true);
  });

  test('null, empty, 0-0 and junk are not', () => {
    expect(checkableRecord(null)).toBe(false);
    expect(checkableRecord('')).toBe(false);
    expect(checkableRecord('0-0')).toBe(false);
    expect(checkableRecord('0-0-0')).toBe(false);
    expect(checkableRecord('form 3 of 5')).toBe(false);
  });
});

describe('recordCheckGames', () => {
  const g = (sport, n, home = '2-1', away = '1-2') => ({
    sport, home_team: `${sport} home ${n}`, away_team: `${sport} away ${n}`, home_record: home, away_record: away,
  });

  test('skips and names games with a record a page cannot confirm', () => {
    const { games, skipped } = recordCheckGames([g('NBA', 1, '0-0', '0-0'), g('La Liga', 1, null, '3-1-2'), g('NHL', 1)]);
    expect(games.map((x) => x.sport)).toEqual(['NHL']);
    expect(skipped).toEqual([
      'NBA home 1: stored 0-0, nothing to check',
      'NBA away 1: stored 0-0, nothing to check',
      'La Liga home 1: no stored record',
    ]);
  });

  test('sends at most 8 games from at most 4 leagues, biggest leagues first', () => {
    const board = [
      ...[1, 2, 3].map((n) => g('NHL', n)),
      ...[1, 2].map((n) => g('NCAAF', n)),
      g('MLS', 1), g('EPL', 1), g('Ligue 1', 1), g('Champions League', 1),
    ];
    const { games } = recordCheckGames(board, 0);
    const leagues = [...new Set(games.map((x) => x.sport))];
    expect(games.length).toBeLessThanOrEqual(8);
    expect(leagues.length).toBeLessThanOrEqual(4);
    expect(leagues.slice(0, 2)).toEqual(['NHL', 'NCAAF']);
    expect(games.filter((x) => x.sport === 'NHL')).toHaveLength(3);
  });

  test('the seed rotates which league leads', () => {
    const board = [g('NHL', 1), g('NCAAF', 1), g('MLS', 1), g('EPL', 1), g('Ligue 1', 1)];
    const a = recordCheckGames(board, 0).games.map((x) => x.sport);
    const b = recordCheckGames(board, 4).games.map((x) => x.sport);
    expect(a).not.toEqual(b);
    expect(b).toHaveLength(4);
  });
});
