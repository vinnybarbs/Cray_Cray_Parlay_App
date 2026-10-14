const { shapeTicker, labelFor, nickname } = require('../../api/public-ticker');

const NOW = new Date('2026-10-14T01:00:00Z');
const row = (o) => ({
  sport: 'NHL', home_team: 'San Jose Sharks', away_team: 'Boston Bruins', game_date: '2026-10-14T03:10:00Z',
  bet_type: 'Moneyline', pick: 'Boston Bruins ML -130', odds: '-130', edge_pp: 6.7, implied_prob: 0.5427,
  tier: 'Play', session_id: 'auto_digest_2026-10-12', ...o,
});
const FLAGS = {
  NHL: { ml: 1, spread: 1, total: 1 },
  MLB: { ml: 1, spread: 1, total: 0 },
  MLS: { ml: 0, spread: 0, total: 0 },
};

describe('labelFor', () => {
  it('names the side and the game', () => {
    expect(labelFor(row())).toEqual({ label: 'Bruins ML', matchup: 'Bruins at Sharks' });
    expect(labelFor(row({ bet_type: 'Total', pick: 'Over 6.5' }))).toEqual({ label: 'Over 6.5', matchup: 'Bruins at Sharks' });
    expect(labelFor(row({ bet_type: 'Spread', pick: 'San Jose Sharks +1.5' })).label).toBe('Sharks +1.5');
  });
  it('keeps two word nicknames', () => {
    expect(nickname('Toronto Maple Leafs')).toBe('Maple Leafs');
    expect(nickname('Boston Red Sox')).toBe('Red Sox');
  });
});

describe('shapeTicker', () => {
  it('shows only published markets, never a shadow sport or a muted total', () => {
    const out = shapeTicker([
      row(),
      row({ sport: 'MLB', home_team: 'Tampa Bay Rays', away_team: 'Cleveland Guardians', bet_type: 'Total', pick: 'Over 6.5', edge_pp: 11.4 }),
      row({ sport: 'MLS', home_team: 'Nashville SC', away_team: 'Sporting Kansas City', pick: 'Nashville SC ML -475', edge_pp: 2.4 }),
    ], [], FLAGS, NOW);
    expect(out.items.map(i => i.label)).toEqual(['Bruins ML']);
    expect(out.inSeason).toEqual(['NHL']);
  });

  it('drops started games, Skip tier, small edges and spotlight alternates', () => {
    const out = shapeTicker([
      row({ game_date: '2026-10-13T23:00:00Z' }),
      row({ home_team: 'A', tier: 'Skip' }),
      row({ home_team: 'B', edge_pp: 1.5, tier: 'Lean' }),
      row({ home_team: 'C', session_id: 'auto_digest_alt_total_2026-10-12' }),
    ], [], FLAGS, NOW);
    expect(out.items).toEqual([]);
  });

  it('carries book and our percentages and interleaves traps', () => {
    const picks = [6, 5, 4].map((e, i) => row({ home_team: `Team${i} Sharks`, pick: 'Boston Bruins ML -130', edge_pp: e }));
    const traps = [row({ home_team: 'Anaheim Ducks', away_team: 'Calgary Flames', bet_type: 'Spread', pick: 'Anaheim Ducks -1.5', edge_pp: -2.1, tier: 'Trap', implied_prob: null, odds: '+114', session_id: 'auto_digest_trap_2026-10-12' })];
    const out = shapeTicker(picks, traps, FLAGS, NOW);
    expect(out.items.map(i => i.kind)).toEqual(['play', 'play', 'trap', 'play']);
    expect(out.items[0]).toMatchObject({ book_pct: 54, our_pct: 60 });
    expect(out.items[2]).toMatchObject({ label: 'Ducks -1.5', matchup: 'Flames at Ducks' });
  });
});
