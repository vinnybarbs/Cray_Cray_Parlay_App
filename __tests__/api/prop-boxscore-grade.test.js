jest.mock('../../lib/services/claude.js', () => ({
  getClient: () => null, MODELS: { NARRATION: 'test-model' }, WRITING_STYLE: 'WRITING STYLE: plain.', extractJson: (t) => JSON.parse(t),
}));
const { boxScoreGrade, boxScoreMismatches } = require('../../api/cron/analyze-nfl-props');
const { parseSummary } = require('../../lib/services/live-prop-stats');

const summary = {
  header: { competitions: [{ status: { type: { state: 'post', completed: true } }, competitors: [] }] },
  boxscore: { players: [{ statistics: [
    { name: 'rushing', keys: ['rushingYards', 'rushingTouchdowns'], athletes: [{ athlete: { displayName: 'Emanuel Wilson' }, stats: ['58', '1'] }] },
    { name: 'receiving', keys: ['receptions', 'receivingYards', 'receivingTouchdowns'], athletes: [
      { athlete: { displayName: 'Emanuel Wilson' }, stats: ['2', '11', '0'] },
      { athlete: { displayName: 'Tory Horton' }, stats: ['1', '3', '0'] },
    ] },
  ] }] },
};
const { players } = parseSummary(summary);
const read = (o) => ({ market: 'player_rush_yds', player_name: 'Emanuel Wilson', line: 66.5, side: 'under', v2_side: 'under', ...o });

describe('boxScoreGrade', () => {
  it('settles v1 and v2 from the final line', () => {
    expect(boxScoreGrade(read(), players)).toEqual({ actual: 58, outcome: 'won', v2Outcome: 'won' });
    expect(boxScoreGrade(read({ market: 'player_reception_yds', player_name: 'Tory Horton', line: 3.5, side: 'under', v2_side: 'over' }), players))
      .toEqual({ actual: 3, outcome: 'won', v2Outcome: 'lost' });
  });
  it('counts rushing plus receiving TDs for anytime TD', () => {
    expect(boxScoreGrade(read({ market: 'player_anytime_td', line: 0.5, side: 'over', v2_side: 'over' }), players).outcome).toBe('won');
  });
  it('leaves a player with no line pending', () => {
    expect(boxScoreGrade(read({ player_name: 'Nobody Here' }), players)).toBeNull();
  });
});

describe('boxScoreMismatches', () => {
  it('flags a box score stat the stat file disagrees with, and the outcome it would give', () => {
    const stats = new Map([['p1|2026|7', { rushing_yards: 68 }], ['p2|2026|7', { receptions: 4 }]]);
    const rows = [
      { id: 1, player_key: 'p1', season: 2026, week: 7, market: 'player_rush_yds', line: 66.5, side: 'under', actual_value: 58, actual_outcome: 'won' },
      { id: 2, player_key: 'p2', season: 2026, week: 7, market: 'player_receptions', line: 3.5, side: 'over', actual_value: 4, actual_outcome: 'won' },
      { id: 3, player_key: 'p3', season: 2026, week: 7, market: 'player_receptions', line: 3.5, side: 'over', actual_value: 4, actual_outcome: 'won' },
    ];
    expect(boxScoreMismatches(rows, stats)).toEqual([
      { id: 1, player_key: 'p1', market: 'player_rush_yds', line: 66.5, box: 58, nflverse: 68, outcome: 'won', nflverse_outcome: 'lost' },
    ]);
  });
});
