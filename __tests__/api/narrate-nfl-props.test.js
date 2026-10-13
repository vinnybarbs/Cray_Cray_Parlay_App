jest.mock('../../lib/services/claude.js', () => ({
  getClient: () => null, MODELS: { NARRATION: 'test-model' }, WRITING_STYLE: 'WRITING STYLE: plain.', extractJson: (t) => JSON.parse(t),
}));
const { needsNarration, buildPrompt, factLines } = require('../../api/cron/narrate-nfl-props');
const { whyFor } = require('../../api/props');

const row = (o) => ({
  id: 1, market: 'player_receptions', player_key: 'p1', player_name: 'Zach Ertz', line: 3.5, v2_side: 'over', v2_edge_pp: 6,
  v2_mean: 4.21, consensus_over_price: 110, consensus_under_price: -140,
  home_team: 'Jacksonville Jaguars', away_team: 'Philadelphia Eagles', commence_time: '2026-10-19T17:00:00Z',
  v2_factors: { team: 'PHI', opponent: 'JAX', opp_ratio: 1.128, opp_games: 21, team_implied: 16.8, wind_mph: 8, status: null },
  factors: { long_mean: 3.53, recent_mean: 3.6 },
  narration: null, narration_side: null, narration_line: null, ...o,
});

describe('needsNarration', () => {
  it('narrates a shown read with no text, or text for another side or line', () => {
    expect(needsNarration(row())).toBe(true);
    expect(needsNarration(row({ narration: 'x', narration_side: 'over', narration_line: 3.5 }))).toBe(false);
    expect(needsNarration(row({ narration: 'x', narration_side: 'under', narration_line: 3.5 }))).toBe(true);
    expect(needsNarration(row({ narration: 'x', narration_side: 'over', narration_line: 4.5 }))).toBe(true);
  });
  it('skips reads the site does not show', () => {
    expect(needsNarration(row({ v2_edge_pp: 3 }))).toBe(false);
  });
});

describe('buildPrompt', () => {
  const history = { games: [{ value: 5, opponent: 'DAL', hit: true }, { value: 2, opponent: 'NYG', hit: false }], hits: 1 };
  it('hands the model only the numbers we hold', () => {
    const p = buildPrompt(row(), history);
    expect(p).toContain('Zach Ertz over 3.5 receptions');
    expect(p).toContain('PRICE on our side: +110');
    expect(p).toContain('5 vs DAL, 2 vs NYG');
    expect(p).toContain('Cleared over 3.5 in 1 of them');
    expect(p).toContain('JAX allows 13 percent more receptions');
    expect(p).toContain('about 16.8 points');
    expect(p).not.toContain('WEATHER');
    expect(p).toContain('NEVER invent');
    expect(p).toContain('WRITING STYLE');
  });
  it('leaves out facts it does not have', () => {
    const lines = factLines(row({ v2_factors: {}, factors: {}, v2_mean: null }), null);
    expect(lines.join('\n')).not.toMatch(/MATCHUP|GAME SCRIPT|AVERAGES|LAST|PROJECTION/);
  });
  it('words anytime TD reads as scoring', () => {
    const p = buildPrompt(row({ market: 'player_anytime_td', line: 0.5 }), { games: [{ value: 1, hit: true }], hits: 1 });
    expect(p).toContain('to score a TD');
    expect(p).toContain('Scored in 1 of them');
    expect(p).not.toContain('OUR PROJECTION');
  });
});

describe('whyFor', () => {
  it('shows narration only while it matches the side and line', () => {
    expect(whyFor(row({ narration: 'Ertz has cleared this.', narration_side: 'over', narration_line: 3.5 })).narration).toBe('Ertz has cleared this.');
    expect(whyFor(row({ narration: 'Old.', narration_side: 'over', narration_line: 2.5 })).narration).toBeNull();
  });
  it('carries the numbers behind the read', () => {
    const w = whyFor(row());
    expect(w).toMatchObject({ projection: 4.2, recentAvg: 3.6, longAvg: 3.5, opponent: 'JAX', oppPct: 13, teamImplied: 16.8, windMph: null });
  });
  it('is null when there is nothing to show', () => {
    expect(whyFor(row({ v2_factors: null, factors: null, v2_mean: null }))).toBeNull();
  });
});
