// __tests__/lib/tennis-data.test.js
//
// Pure-function tests for the tennis data service: name normalization,
// ESPN payload parsers, and the pre-match context formatter. No network,
// no Supabase.

'use strict';

const {
  playerKey,
  parseRankingsPayload,
  parseScoreboardPayload,
  scoreFromLinescores,
  finishTypeFromStatus,
  summarizePlayer,
  formatTennisContext,
} = require('../../lib/services/tennis-data');

describe('playerKey', () => {
  test('strips diacritics so odds-feed and ESPN spellings join', () => {
    expect(playerKey('Fábián Marozsán')).toBe('fabian marozsan');
    expect(playerKey('Fabian Marozsan')).toBe('fabian marozsan');
    expect(playerKey('Karolína Muchová')).toBe('karolina muchova');
  });

  test('drops punctuation and collapses whitespace', () => {
    expect(playerKey("  Jo-Wilfried   Tsonga ")).toBe('jo wilfried tsonga');
    expect(playerKey("O'Connell, Christopher")).toBe('o connell christopher');
  });

  test('junk input returns null', () => {
    expect(playerKey(null)).toBeNull();
    expect(playerKey('')).toBeNull();
    expect(playerKey('   ')).toBeNull();
  });
});

describe('parseRankingsPayload', () => {
  const payload = {
    rankings: [{
      ranks: [
        { current: 1, points: 11000, athlete: { displayName: 'Jannik Sinner' } },
        { current: 55, points: 940, athlete: { displayName: 'Fábián Marozsán' } },
        // rank/fullName fallback shape
        { rank: 114, athlete: { fullName: 'Shintaro Mochizuki' } },
        // junk entries are skipped
        { current: 0, athlete: { displayName: 'Bad Rank' } },
        { current: 12 },
      ],
    }],
  };

  test('parses ranks, points, and normalized keys', () => {
    const rows = parseRankingsPayload(payload, 'atp');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ tour: 'atp', rank: 1, player_key: 'jannik sinner', points: 11000 });
    expect(rows[1]).toMatchObject({ rank: 55, player_key: 'fabian marozsan', player_name: 'Fábián Marozsán' });
    expect(rows[2]).toMatchObject({ rank: 114, player_key: 'shintaro mochizuki', points: null });
  });

  test('dedupes repeated players and tolerates empty payloads', () => {
    const doubled = { rankings: [{ ranks: [...payload.rankings[0].ranks, ...payload.rankings[0].ranks] }] };
    expect(parseRankingsPayload(doubled, 'atp')).toHaveLength(3);
    expect(parseRankingsPayload({}, 'atp')).toEqual([]);
    expect(parseRankingsPayload(null, 'wta')).toEqual([]);
  });
});

describe('parseScoreboardPayload', () => {
  const competitor = (name, winner, sets) => ({
    winner,
    athlete: { displayName: name },
    linescores: sets.map(v => ({ value: v })),
  });

  const payload = {
    events: [{
      name: 'National Bank Open',
      date: '2026-08-01T15:00Z',
      groupings: [
        {
          grouping: { displayName: "Men's Singles" },
          competitions: [
            {
              status: { type: { state: 'post', name: 'STATUS_FINAL' } },
              date: '2026-08-01T18:30Z',
              round: { displayName: 'Round of 128' },
              competitors: [
                competitor('Fábián Marozsán', true, [6, 7]),
                competitor('Aleksandar Vukic', false, [4, 5]),
              ],
            },
            // in-progress match is skipped
            {
              status: { type: { state: 'in' } },
              competitors: [competitor('A', false, []), competitor('B', false, [])],
            },
          ],
        },
        {
          grouping: { displayName: "Men's Doubles" },
          competitions: [{
            status: { type: { state: 'post' } },
            competitors: [competitor('Team A', true, [6]), competitor('Team B', false, [3])],
          }],
        },
      ],
    }],
  };

  test('extracts completed singles matches with score and round', () => {
    const rows = parseScoreboardPayload(payload, 'atp', '2026-08-01');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tour: 'atp',
      tournament: 'National Bank Open',
      round: 'Round of 128',
      match_date: '2026-08-01',
      winner_key: 'fabian marozsan',
      loser_key: 'aleksandar vukic',
      score: '6-4, 7-5',
      finish_type: 'completed',
    });
  });

  test('skips doubles draws and tolerates empty payloads', () => {
    const rows = parseScoreboardPayload(payload, 'atp', '2026-08-01');
    expect(rows.some(r => r.winner_key === 'team a')).toBe(false);
    expect(parseScoreboardPayload({}, 'wta', '2026-08-01')).toEqual([]);
  });

  test('falls back to the requested date when the competition has none', () => {
    const noDate = {
      events: [{
        name: 'Test Open',
        groupings: [{
          grouping: { displayName: 'Singles' },
          competitions: [{
            status: { type: { state: 'post' } },
            competitors: [competitor('X Y', true, [6, 6]), competitor('Z W', false, [1, 2])],
          }],
        }],
      }],
    };
    const rows = parseScoreboardPayload(noDate, 'wta', '2026-07-30');
    expect(rows[0].match_date).toBe('2026-07-30');
  });
});

describe('scoreFromLinescores / finishTypeFromStatus', () => {
  test('builds winner-perspective set scores', () => {
    const w = { linescores: [{ value: 6 }, { value: 7 }] };
    const l = { linescores: [{ value: 3 }, { value: 6 }] };
    expect(scoreFromLinescores(w, l)).toBe('6-3, 7-6');
  });

  test('returns null on missing or mismatched linescores', () => {
    expect(scoreFromLinescores({}, {})).toBeNull();
    expect(scoreFromLinescores({ linescores: [{ value: 6 }] }, { linescores: [] })).toBeNull();
  });

  test('maps retirement and walkover statuses', () => {
    expect(finishTypeFromStatus({ type: { name: 'STATUS_RETIRED' } })).toBe('retired');
    expect(finishTypeFromStatus({ type: { name: 'STATUS_WALKOVER' } })).toBe('walkover');
    expect(finishTypeFromStatus({ type: { name: 'STATUS_FINAL' } })).toBe('completed');
    expect(finishTypeFromStatus(null)).toBe('completed');
  });
});

describe('summarizePlayer', () => {
  const iso = (daysBack) => new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const matches = [
    { winner_key: 'p one', winner_name: 'P One', loser_key: 'opp a', loser_name: 'Opp A', match_date: iso(1), score: '6-4, 6-2', finish_type: 'completed', tournament: 'Open A' },
    { winner_key: 'opp b', winner_name: 'Opp B', loser_key: 'p one', loser_name: 'P One', match_date: iso(4), score: '7-5, 6-4', finish_type: 'completed', tournament: 'Open A' },
    { winner_key: 'p one', winner_name: 'P One', loser_key: 'opp c', loser_name: 'Opp C', match_date: iso(20), score: null, finish_type: 'retired', tournament: null },
  ];

  test('computes record, workload, and recent lines', () => {
    const s = summarizePlayer('P One', 'p one', { tour: 'atp', rank: 40, points: 1000 }, matches);
    expect(s.record30d).toBe('2-1');
    expect(s.matchesLast14).toBe(2); // the 20-days-ago match is outside the window
    expect(s.rank).toBe(40);
    expect(s.recentLines).toHaveLength(3);
    expect(s.recentLines[0]).toContain('W vs Opp A 6-4, 6-2');
    expect(s.recentLines[2]).toContain('(ret.)');
  });

  test('empty inputs give null record and no lines', () => {
    const s = summarizePlayer('P Two', 'p two', null, []);
    expect(s.record30d).toBeNull();
    expect(s.rank).toBeNull();
    expect(s.recentLines).toEqual([]);
  });
});

describe('formatTennisContext', () => {
  const player = (name, key, rank, lines) => ({
    name, key, rank, points: rank != null ? 900 : null, tour: rank != null ? 'atp' : null,
    record30d: lines.length > 0 ? '3-1' : null,
    matchesLast14: lines.length > 0 ? 5 : 0,
    recentLines: lines,
  });

  test('renders ranks, workload flag, and h2h', () => {
    const ctx = {
      home: player('Shintaro Mochizuki', 'shintaro mochizuki', 114, ['W vs A 6-4, 6-4 (Jul 28, Open)']),
      away: player('Fábián Marozsán', 'fabian marozsan', 55, ['W vs B 6-2, 6-2 (Jul 29, Open)']),
      h2h: [{ match_date: '2026-05-01', tournament: 'Rome', winner_key: 'fabian marozsan', winner_name: 'Fábián Marozsán', score: '6-4, 6-4' }],
    };
    const out = formatTennisContext(ctx);
    expect(out).toContain('ATP rank #114');
    expect(out).toContain('ATP rank #55');
    expect(out).toContain('heavy workload');
    expect(out).toContain('Fábián Marozsán leads 1-0');
  });

  test('states when a player has no stored data', () => {
    const ctx = {
      home: player('Unknown Qualifier', 'unknown qualifier', null, []),
      away: player('Fábián Marozsán', 'fabian marozsan', 55, ['W vs B 6-2, 6-2 (Jul 29, Open)']),
      h2h: [],
    };
    const out = formatTennisContext(ctx);
    expect(out).toContain('Unknown Qualifier: no stored ranking or recent results');
    expect(out).toContain('no prior meeting');
  });

  test('returns null when neither player has data, so the prompt keeps its no-data honesty', () => {
    const ctx = {
      home: player('A B', 'a b', null, []),
      away: player('C D', 'c d', null, []),
      h2h: [],
    };
    expect(formatTennisContext(ctx)).toBeNull();
    expect(formatTennisContext(null)).toBeNull();
  });
});
