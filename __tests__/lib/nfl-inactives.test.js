process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const {
  teamAbbr, normalizeAbbr, mapInjuryRow, latestDepthChartRows, depthChartRows,
  parseSummaryInjuries, diffScratches, matchEvent, linesForTeam, practiceReportText,
} = require('../../lib/services/nfl-inactives');
const { mapInjuryItem, ACTIVE_SPORTS } = require('../../api/cron/fetch-espn-intelligence');
const { getFootballInjuryImpact, overrideTeams, _setTeams, _resetCache } = require('../../lib/services/football-injuries');

describe('team codes', () => {
  test('full names, mascots and nflverse aliases resolve to one club code', () => {
    expect(teamAbbr('Kansas City Chiefs')).toBe('KC');
    expect(teamAbbr('Chiefs')).toBe('KC');
    expect(teamAbbr('Los Angeles Rams')).toBe('LA');
    expect(normalizeAbbr('LAR')).toBe('LA');
    expect(normalizeAbbr('JAC')).toBe('JAX');
    expect(teamAbbr('Nowhere FC')).toBeNull();
  });
});

describe('mapInjuryRow (nflverse injuries CSV)', () => {
  const base = {
    season: '2026', season_type: 'REG', game_type: 'REG', team: 'ARI', week: '1',
    gsis_id: '00-0034381', position: 'LB', full_name: 'Josh Sweat', first_name: 'Josh', last_name: 'Sweat',
    report_primary_injury: '', report_secondary_injury: '', report_status: '',
    practice_primary_injury: 'Knee', practice_secondary_injury: '', practice_status: 'Full Participation in Practice',
  };
  test('a full participant with no designation keeps nulls where the file is blank', () => {
    const r = mapInjuryRow(base);
    expect(r.team).toBe('ARI');
    expect(r.week).toBe(1);
    expect(r.player_key).toBe('00-0034381');
    expect(r.report_status).toBeNull();
    expect(r.practice_injury).toBe('Knee');
    expect(r.practice_status).toBe('Full Participation in Practice');
  });
  test('a designated player carries both injuries and the status', () => {
    const r = mapInjuryRow({ ...base, report_status: 'Out', report_primary_injury: 'Hamstring', report_secondary_injury: 'Ankle' });
    expect(r.report_status).toBe('Out');
    expect(r.report_injury).toBe('Hamstring, Ankle');
  });
  test('no gsis id falls back to a team and name key; no name is dropped', () => {
    expect(mapInjuryRow({ ...base, gsis_id: '' }).player_key).toBe('ARI:josh sweat');
    expect(mapInjuryRow({ ...base, full_name: '', first_name: '', last_name: '' })).toBeNull();
    expect(mapInjuryRow({ ...base, week: '' })).toBeNull();
  });
});

describe('latestDepthChartRows (nflverse depth_charts snapshot history)', () => {
  test('keeps only each team newest snapshot and dedupes the slot key', () => {
    const rows = [
      { dt: '2026-09-01T00:00:00Z', team: 'ARI', player_name: 'Old Guy', pos_grp: 'Offense', pos_abb: 'QB', pos_slot: '1', pos_rank: '1' },
      { dt: '2026-09-14T13:53:31Z', team: 'ARI', player_name: 'New Guy', pos_grp: 'Offense', pos_abb: 'QB', pos_slot: '1', pos_rank: '1' },
      { dt: '2026-09-14T13:53:31Z', team: 'ARI', player_name: 'New Guy', pos_grp: 'Offense', pos_abb: 'QB', pos_slot: '1', pos_rank: '1' },
      { dt: '2026-09-14T13:53:31Z', team: 'ARI', player_name: 'Backup', pos_grp: 'Offense', pos_abb: 'QB', pos_slot: '1', pos_rank: '2' },
      { dt: '2026-09-10T00:00:00Z', team: 'LAR', player_name: 'Ram', pos_grp: 'Offense', pos_abb: 'RB', pos_slot: '1', pos_rank: '1' },
    ];
    const out = latestDepthChartRows(rows);
    expect(out).toHaveLength(3);
    expect(out.find(r => r.team === 'ARI' && r.pos_rank === 1).player_name).toBe('New Guy');
    expect(out.find(r => r.team === 'LA').player_name).toBe('Ram');
  });

  test('with a window start every snapshot at or after it is kept, keyed by snapshot (2026-09-15 depth gate)', () => {
    const rows = [
      { dt: '2026-08-01T00:00:00Z', team: 'GB', player_name: 'Josh Jacobs', pos_grp: 'Offense', pos_abb: 'RB', pos_slot: '11', pos_rank: '1' },
      { dt: '2026-09-06T11:29:30Z', team: 'GB', player_name: 'Josh Jacobs', pos_grp: 'Offense', pos_abb: 'RB', pos_slot: '11', pos_rank: '4' },
      { dt: '2026-09-15T12:39:14Z', team: 'GB', player_name: 'Josh Jacobs', pos_grp: 'Offense', pos_abb: 'RB', pos_slot: '11', pos_rank: '4' },
      { dt: '2026-09-15T12:39:14Z', team: 'GB', player_name: 'Josh Jacobs', pos_grp: 'Offense', pos_abb: 'RB', pos_slot: '11', pos_rank: '4' },
    ];
    const out = depthChartRows(rows, '2026-08-18T00:00:00Z');
    expect(out).toHaveLength(2);
    expect(out.map(r => r.snapshot_at)).toEqual(['2026-09-06T11:29:30.000Z', '2026-09-15T12:39:14.000Z']);
  });
});

describe('recentDepthChartText (cheap line filter before the parse)', () => {
  const { recentDepthChartText, rowsAsObjects } = require('../../api/cron/sync-nfl-injuries');
  const text = [
    'dt,team,player_name,pos_abb,pos_slot,pos_rank',
    '2026-09-01T00:00:00Z,ARI,Old Guy,QB,1,1',
    '2026-09-14T13:53:31Z,ARI,New Guy,QB,1,1',
    '2026-09-10T00:00:00Z,LAR,Ram,RB,1,1',
    '',
  ].join('\n');
  test('keeps the header and the lines at or after the window start, and reports the newest dt', () => {
    const out = recentDepthChartText(text, '2026-09-10T00:00:00Z');
    expect(out.lines_in_file).toBe(3);
    expect(out.newest).toBe('2026-09-14T13:53:31Z');
    expect(rowsAsObjects(out.text).map(r => r.player_name)).toEqual(['New Guy', 'Ram']);
  });
  test('no window start keeps everything', () => {
    expect(rowsAsObjects(recentDepthChartText(text, null).text)).toHaveLength(3);
  });
});

describe('ESPN game summary injuries and the scratch diff', () => {
  const summary = {
    injuries: [
      { team: { displayName: 'Kansas City Chiefs' }, injuries: [
        { status: 'Out', athlete: { displayName: 'Josh Simmons', position: { abbreviation: 'OT' } } },
        { status: 'Questionable', athlete: { displayName: 'Chamarri Conner', position: { abbreviation: 'S' } } },
      ] },
      { team: { displayName: 'Denver Broncos' }, injuries: [
        { status: 'Out', athlete: { displayName: 'Jonathon Cooper', position: { abbreviation: 'LB' } } },
        { status: 'Injured Reserve', athlete: { displayName: 'Frank Crum', position: { abbreviation: 'OT' } } },
      ] },
    ],
  };
  test('parses per team lines in the football-injuries shape', () => {
    const byTeam = parseSummaryInjuries(summary);
    expect(byTeam['Kansas City Chiefs']).toEqual([
      { player: 'Josh Simmons', position: 'OT', status: 'out' },
      { player: 'Chamarri Conner', position: 'S', status: 'questionable' },
    ]);
    expect(linesForTeam(byTeam, 'Broncos')).toHaveLength(2);
    expect(linesForTeam(byTeam, 'Raiders')).toBeNull();
  });
  test('a player newly Out is a scratch; one the read already had as Out is not', () => {
    const prior = [
      { player: 'Josh Simmons', position: 'OT', status: 'out' },
      { player: 'Chamarri Conner', position: 'S', status: 'questionable' },
    ];
    const current = [
      { player: 'Josh Simmons', position: 'OT', status: 'out' },
      { player: 'Chamarri Conner', position: 'S', status: 'out' },
      { player: 'Patrick Mahomes', position: 'QB', status: 'out' },
      { player: 'Someone Else', position: 'WR', status: 'questionable' },
    ];
    expect(diffScratches(prior, current)).toEqual([
      { player: 'Chamarri Conner', position: 'S', from: 'questionable', to: 'out' },
      { player: 'Patrick Mahomes', position: 'QB', from: 'not listed', to: 'out' },
    ]);
  });
  test('no stored report means null, never every Out treated as new', () => {
    expect(diffScratches(null, [{ player: 'X', position: 'QB', status: 'out' }])).toBeNull();
    expect(diffScratches([], [])).toEqual([]);
  });
  test('matchEvent picks the scoreboard event by both clubs nearest kickoff', () => {
    const sb = { events: [
      { id: '1', date: '2026-09-15T00:15Z', competitions: [{ competitors: [
        { homeAway: 'home', team: { displayName: 'Kansas City Chiefs' } },
        { homeAway: 'away', team: { displayName: 'Denver Broncos' } } ] }] },
      { id: '2', date: '2026-09-15T00:15Z', competitions: [{ competitors: [
        { homeAway: 'home', team: { displayName: 'Dallas Cowboys' } },
        { homeAway: 'away', team: { displayName: 'New York Giants' } } ] }] },
    ] };
    expect(matchEvent(sb, 'Kansas City Chiefs', 'Denver Broncos', '2026-09-15T00:15:00Z')).toBe('1');
    expect(matchEvent(sb, 'Denver Broncos', 'Kansas City Chiefs', '2026-09-15T00:15:00Z')).toBeNull();
    expect(matchEvent(sb, 'Kansas City Chiefs', 'Denver Broncos', '2026-09-22T00:15:00Z')).toBeNull();
  });
});

describe('the read stores the report lines it was priced on', () => {
  afterEach(() => _resetCache());
  test('getFootballInjuryImpact returns weighted lines only, lowercased', async () => {
    _setTeams(new Map([['kansas city chiefs', [
      { player: 'Josh Simmons', position: 'OT', status: 'Out' },
      { player: 'Someone', position: 'WR', status: 'Active' },
      { player: 'Frank Crum', position: 'OT', status: 'Injured Reserve' },
      { player: 'Chamarri Conner', position: 'S', status: 'Questionable' },
    ]]]));
    const r = await getFootballInjuryImpact('Kansas City Chiefs');
    // No depth ranks supplied: rank unknown, the gate's unknown share.
    expect(r.lines).toEqual([
      { player: 'Josh Simmons', position: 'OT', status: 'out', depth_rank: null, depth_weight: 0.5 },
      { player: 'Chamarri Conner', position: 'S', status: 'questionable', depth_rank: null, depth_weight: 0.5 },
    ]);
  });
  test('overrideTeams overlays the game summary lines so a re-read prices the scratch', async () => {
    _setTeams(new Map([
      ['kansas city chiefs', [{ player: 'Josh Simmons', position: 'OT', status: 'Out' }]],
      ['dallas cowboys', [{ player: 'Someone', position: 'WR', status: 'Questionable' }]],
    ]));
    const before = await getFootballInjuryImpact('Kansas City Chiefs');
    await overrideTeams({ 'Kansas City Chiefs': [
      { player: 'Josh Simmons', position: 'OT', status: 'out' },
      { player: 'Patrick Mahomes', position: 'QB', status: 'out' },
    ] });
    const after = await getFootballInjuryImpact('Kansas City Chiefs');
    expect(after.impact).toBeLessThan(before.impact);
    expect(after.keyLoss).toContain('Patrick Mahomes');
    // Untouched clubs keep their league lines.
    expect((await getFootballInjuryImpact('Dallas Cowboys')).questionable).toBe(1);
  });
});

describe('fetch-espn-intelligence football', () => {
  test('football is on the sport list', () => {
    expect(ACTIVE_SPORTS.map(s => s.code)).toEqual(expect.arrayContaining(['NFL', 'NCAAF']));
  });
  test('Active lines are noise; real lines carry the athlete and position', () => {
    expect(mapInjuryItem({ status: 'Active', athlete: { displayName: 'Healthy Guy' } })).toBeNull();
    const line = mapInjuryItem({
      status: 'Questionable', shortComment: 'questionable', details: { type: 'Achilles' },
      athlete: { displayName: 'Garrett Williams', position: { abbreviation: 'CB' } },
    });
    expect(line).toEqual({ player: 'Garrett Williams', position: 'CB', status: 'Questionable', details: 'Achilles: questionable' });
  });
});

describe('practiceReportText (narration context only)', () => {
  function stub(rows) {
    const chain = {
      select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
      limit: () => Promise.resolve({ data: rows }),
    };
    return { from: () => chain };
  }
  const weekFor = () => ({ season: 2026, week: 2 });
  test('skips healthy full participants and names the week', async () => {
    const text = await practiceReportText(stub([
      { team: 'KC', full_name: 'Josh Simmons', position: 'OT', report_status: 'Out', report_injury: 'Knee', practice_status: 'Did Not Participate In Practice' },
      { team: 'KC', full_name: 'Healthy Guy', position: 'WR', report_status: null, report_injury: null, practice_status: 'Full Participation in Practice' },
      { team: 'DEN', full_name: 'Sam Darnold', position: 'QB', report_status: null, report_injury: null, practice_status: 'Limited Participation in Practice', practice_injury: 'Hip' },
    ]), 'Kansas City Chiefs', 'Denver Broncos', '2026-09-15T00:15:00Z', weekFor);
    expect(text).toContain('week 2');
    expect(text).toContain('Kansas City Chiefs: Josh Simmons (OT) Out, Knee, practice DNP');
    expect(text).toContain('Denver Broncos: Sam Darnold (QB) no designation, Hip, practice limited');
    expect(text).not.toContain('Healthy Guy');
  });
  test('no rows for the week returns null so the caller falls back', async () => {
    expect(await practiceReportText(stub([]), 'Kansas City Chiefs', 'Denver Broncos', '2026-09-15T00:15:00Z', weekFor)).toBeNull();
    expect(await practiceReportText(stub([]), 'Kansas City Chiefs', 'Denver Broncos', '2026-09-15T00:15:00Z', () => null)).toBeNull();
  });
});
