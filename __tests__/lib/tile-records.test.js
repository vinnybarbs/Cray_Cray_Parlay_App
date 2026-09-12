'use strict';

const { tileRecords, recordGames, chooseRecord, findTeam, formatStandingsRecord, seasonRecordFloor } = require('../../lib/services/tile-records.js');
const { teamsMatch } = require('../../lib/utils/team-matcher.js');
const { parseOverallRecord } = require('../../api/cron/sync-standings.js');

describe('tile records: the record with more games wins', () => {
  test('recordGames reads W-L, W-L-T and the prior season courtesy form', () => {
    expect(recordGames('12-4')).toBe(16);
    expect(recordGames('12-4-8')).toBe(24);
    expect(recordGames('0-0 (12-5 last yr)')).toBe(0);
    expect(recordGames(null)).toBeNull();
    expect(recordGames('n/a')).toBeNull();
  });

  test('a 0-0 standings row loses to a 2-0 scoreboard record', () => {
    expect(chooseRecord('0-0', '2-0')).toEqual({ record: '2-0', source: 'scoreboard' });
  });

  test('ties and missing scoreboard rows keep the standings record', () => {
    expect(chooseRecord('85-62', '85-62')).toEqual({ record: '85-62', source: 'standings' });
    expect(chooseRecord('85-62', null)).toEqual({ record: '85-62', source: 'standings' });
    expect(chooseRecord(null, '1-0')).toEqual({ record: '1-0', source: 'scoreboard' });
    expect(chooseRecord(null, null)).toEqual({ record: null, source: null });
  });

  test('soccer standings format is W-D-L, others W-L or W-L-T', () => {
    expect(formatStandingsRecord('MLS', { wins: 12, losses: 4, ties: 8 })).toBe('12-8-4');
    expect(formatStandingsRecord('NFL', { wins: 12, losses: 4, ties: 1 })).toBe('12-4-1');
    expect(formatStandingsRecord('MLB', { wins: 85, losses: 62, ties: 0 })).toBe('85-62');
    expect(formatStandingsRecord('MLB', null)).toBeNull();
  });
});

describe('tile records: name matching bridges the odds feed and ESPN', () => {
  const rows = [
    { team_name: 'Red Bull New York' }, { team_name: 'LAFC' }, { team_name: 'CF Montréal' },
    { team_name: 'Brighton & Hove Albion' }, { team_name: 'New York City FC' }, { team_name: 'Inter Miami CF' },
  ];
  test.each([
    ['New York Red Bulls', 'Red Bull New York'],
    ['Los Angeles FC', 'LAFC'],
    ['CF Montreal', 'CF Montréal'],
    ['Brighton and Hove Albion', 'Brighton & Hove Albion'],
    ['New York City FC', 'New York City FC'],
  ])('%s finds %s', (query, expected) => {
    expect(findTeam(rows, query).team_name).toBe(expected);
  });

  test('the aliases do not collide the two New York clubs', () => {
    expect(teamsMatch('New York Red Bulls', 'New York City FC')).toBe(false);
    expect(findTeam(rows, 'New York Red Bulls').team_name).toBe('Red Bull New York');
  });
});

describe('tile records: end to end against mocked tables', () => {
  function fakeSupabase(standings, scoreboard) {
    return {
      from(table) {
        const data = table === 'current_standings' ? standings : scoreboard;
        const q = { select: () => q, eq: () => q, gte: () => q, then: (res) => res({ data }) };
        return q;
      },
    };
  }

  test('NCAAF week two: 0-0 conference standings give way to the 1-0 scoreboard record', async () => {
    const sb = fakeSupabase(
      [{ team_name: 'Notre Dame Fighting Irish', wins: 0, losses: 0, ties: 0, streak: null }, { team_name: 'Rice Owls', wins: 0, losses: 0, ties: 0, streak: null }],
      [{ team_name: 'Notre Dame Fighting Irish', record_str: '1-0', as_of_date: '2026-09-06' }, { team_name: 'Rice Owls', record_str: '1-0', as_of_date: '2026-09-05' }]
    );
    const r = await tileRecords(sb, { sport: 'NCAAF', homeTeam: 'Notre Dame Fighting Irish', awayTeam: 'Rice Owls' });
    expect(r.home_record).toBe('1-0');
    expect(r.away_record).toBe('1-0');
    expect(r.sources).toEqual({ home: 'scoreboard', away: 'scoreboard' });
  });

  test('MLS: a club missing from standings under another name still gets its record', async () => {
    const sb = fakeSupabase(
      [{ team_name: 'Red Bull New York', wins: 7, losses: 9, ties: 8, streak: 'W1' }],
      [{ team_name: 'Columbus Crew SC', record_str: '11-6-7', as_of_date: '2026-09-09' }]
    );
    const r = await tileRecords(sb, { sport: 'MLS', homeTeam: 'Columbus Crew SC', awayTeam: 'New York Red Bulls' });
    expect(r.home_record).toBe('11-6-7');
    expect(r.away_record).toBe('7-8-9');
    expect(r.away_streak).toBe('W1');
  });

  test('a failing query yields empty records, never a throw', async () => {
    const sb = { from() { throw new Error('down'); } };
    const r = await tileRecords(sb, { sport: 'MLB', homeTeam: 'A', awayTeam: 'B' });
    expect(r.home_record).toBeNull();
    expect(r.away_record).toBeNull();
  });
});

describe('standings parser: the overall summary beats the conference columns', () => {
  test('parseOverallRecord accepts W-L and W-L-T only', () => {
    expect(parseOverallRecord('2-0')).toEqual({ wins: 2, losses: 0, ties: null });
    expect(parseOverallRecord('7-8-9')).toEqual({ wins: 7, losses: 8, ties: 9 });
    expect(parseOverallRecord('2-0, 6 PTS')).toBeNull();
    expect(parseOverallRecord(undefined)).toBeNull();
    expect(parseOverallRecord(0.5)).toBeNull();
  });
});

describe('tile records: the scoreboard source starts at the regular season floor', () => {
  test('NFL preseason records in August never reach a September tile', () => {
    expect(seasonRecordFloor('NFL', new Date(2026, 8, 12))).toBe('2026-09-01');
    expect(seasonRecordFloor('NFL', new Date(2027, 0, 10))).toBe('2026-09-01');
    expect(seasonRecordFloor('NFL', new Date(2026, 7, 15))).toBe('2025-09-01');
  });
  test('season straddling sports roll to last year before the floor month', () => {
    expect(seasonRecordFloor('NBA', new Date(2027, 2, 1))).toBe('2026-10-15');
    expect(seasonRecordFloor('NBA', new Date(2026, 10, 1))).toBe('2026-10-15');
    expect(seasonRecordFloor('EPL', new Date(2026, 8, 12))).toBe('2026-08-01');
  });
  test('an unlisted sport falls back to the 45 day window', () => {
    expect(seasonRecordFloor('Golf', new Date(2026, 8, 12))).toBe('2026-07-29');
  });
});
