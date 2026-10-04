// NHL starting goalies (owner 2026-10-03, the night NHL went live): who
// starts from DailyFaceoff with ESPN as the fallback, how good from the
// NHL API blended with a league prior, and the win probability move.

const G = require('../../lib/services/nhl-goalies');

beforeEach(() => G._resetCache());

const dfoHtml = (games) => `<html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data: games } } })}</script></body></html>`;
const dfoGame = {
  homeTeamName: 'Buffalo Sabres', homeGoalieName: 'Ukko-Pekka Luukkonen', homeNewsStrengthName: 'Confirmed', homeNewsDetails: 'Luukkonen will start vs. Chicago on Saturday.', homeGoalieSavePercentage: '0.773', homeGoalieGoalsAgainstAvg: '5.0',
  awayTeamName: 'Chicago Blackhawks', awayGoalieName: 'Spencer Knight', awayNewsStrengthName: 'Likely', awayNewsDetails: null, awayGoalieSavePercentage: '0.910', awayGoalieGoalsAgainstAvg: '2.5',
  date: '2026-10-03',
};
const espnBoard = { events: [{ date: '2026-10-04T00:00Z', competitions: [{ competitors: [
  { homeAway: 'home', team: { displayName: 'Tampa Bay Lightning' }, probables: [{ name: 'probableStartingGoalie', athlete: { displayName: 'Andrei Vasilevskiy' } }] },
  { homeAway: 'away', team: { displayName: 'Washington Capitals' }, probables: [{ name: 'probableStartingGoalie', athlete: { displayName: 'Charlie Lindgren' } }] },
] }] }] };

describe('parsers', () => {
  test('DailyFaceoff page gives both starters with status and news', () => {
    const m = G.parseDailyFaceoff(dfoHtml([dfoGame]));
    expect(m.get('buffalo sabres')).toMatchObject({ name: 'Ukko-Pekka Luukkonen', status: 'Confirmed', season_sv: 0.773, source: 'dailyfaceoff' });
    expect(m.get('chicago blackhawks')).toMatchObject({ name: 'Spencer Knight', status: 'Likely' });
    expect(G.parseDailyFaceoff('<html>nothing</html>')).toBeNull();
  });

  test('ESPN probables are the fallback with status Probable, team lookup is forgiving', () => {
    const m = G.parseEspnProbables(espnBoard);
    expect(G.lookupTeam(m, 'Tampa Bay Lightning')).toMatchObject({ name: 'Andrei Vasilevskiy', status: 'Probable', source: 'espn' });
    expect(G.lookupTeam(m, 'Capitals')).toMatchObject({ name: 'Charlie Lindgren' });
    expect(G.lookupTeam(m, 'Edmonton Oilers')).toBeNull();
  });
});

describe('quality and the move', () => {
  test('blended save pct is shots weighted with a 600 shot league prior', () => {
    const r = G.blendedSavePct([{ shotsAgainst: 57, savePctg: 0.789 }, { shotsAgainst: 1285, savePctg: 0.875 }]);
    const expected = (0.789 * 57 + 0.875 * 1285 + 0.905 * 600) / (57 + 1285 + 600);
    expect(r.sv).toBeCloseTo(expected, 4);
    expect(r.shots).toBe(1342);
    expect(G.blendedSavePct([])).toEqual({ sv: 0.905, shots: 0 });
    expect(G.blendedSavePct([{ shotsAgainst: 0, savePctg: 1 }]).sv).toBe(0.905);
  });

  test('four points per .010 of gap, capped at six, zero on nothing', () => {
    expect(G.goalieSvAdjustment(0.915, 0.905)).toBeCloseTo(0.04, 4);
    expect(G.goalieSvAdjustment(0.900, 0.912)).toBeCloseTo(-0.048, 4);
    expect(G.goalieSvAdjustment(0.930, 0.890)).toBe(0.06);
    expect(G.goalieSvAdjustment(null, 0.905)).toBe(0);
    expect(G.fmtSv(0.9052)).toBe('.905');
  });
});

describe('getStartingGoalies end to end with injected fetch', () => {
  const ok = (body, isJson) => ({ ok: true, text: async () => (isJson ? JSON.stringify(body) : body) });
  const fetchFn = jest.fn(async (url) => {
    if (url.includes('dailyfaceoff')) return ok(dfoHtml([dfoGame]), false);
    if (url.includes('search/player')) {
      const q = decodeURIComponent(url.split('q=')[1]);
      return ok([{ playerId: q.includes('Knight') ? '4565234' : '8480045', name: q, positionCode: 'G', active: true }], true);
    }
    if (url.includes('/player/8480045/')) return ok({ seasonTotals: [
      { season: 20252026, gameTypeId: 2, leagueAbbrev: 'NHL', shotsAgainst: 1000, savePctg: 0.900 },
      { season: 20262027, gameTypeId: 2, leagueAbbrev: 'NHL', shotsAgainst: 30, savePctg: 0.773 },
      { season: 20262027, gameTypeId: 3, leagueAbbrev: 'NHL', shotsAgainst: 999, savePctg: 0.999 },
      { season: 20242025, gameTypeId: 2, leagueAbbrev: 'AHL', shotsAgainst: 999, savePctg: 0.999 },
    ] }, true);
    if (url.includes('/player/4565234/')) return ok({ seasonTotals: [
      { season: 20252026, gameTypeId: 2, leagueAbbrev: 'NHL', shotsAgainst: 1200, savePctg: 0.915 },
    ] }, true);
    return { ok: false, text: async () => '' };
  });

  test('both starters come back with blended quality, playoffs and other leagues ignored', async () => {
    const g = await G.getStartingGoalies('Buffalo Sabres', 'Chicago Blackhawks', fetchFn);
    expect(g.source).toBe('dailyfaceoff');
    expect(g.home).toMatchObject({ name: 'Ukko-Pekka Luukkonen', status: 'Confirmed', shots: 1030 });
    expect(g.home.sv).toBeCloseTo((0.900 * 1000 + 0.773 * 30 + 0.905 * 600) / 1630, 4);
    expect(g.away).toMatchObject({ name: 'Spencer Knight', status: 'Likely', shots: 1200 });
    const text = await G.getStartingGoaliesText('Buffalo Sabres', 'Chicago Blackhawks', fetchFn);
    expect(text).toMatch(/^Spencer Knight \(Likely, \.\d{3} blended save pct\) at Ukko-Pekka Luukkonen \(Confirmed, /);
    expect(text.replace(/\s*\([^)]*\)/g, '')).toBe('Spencer Knight at Ukko-Pekka Luukkonen');
  });

  test('a game the page does not list is null, a dark page falls back to ESPN, a dead network is null', async () => {
    expect(await G.getStartingGoalies('Edmonton Oilers', 'Calgary Flames', fetchFn)).toBeNull();
    G._resetCache();
    const espnOnly = jest.fn(async (url) => url.includes('espn') ? ok(espnBoard, true) : { ok: false, text: async () => '' });
    const g = await G.getStartingGoalies('Tampa Bay Lightning', 'Washington Capitals', espnOnly);
    expect(g.source).toBe('espn');
    expect(g.home).toMatchObject({ name: 'Andrei Vasilevskiy', status: 'Probable', sv: 0.905, shots: 0 });
    G._resetCache();
    const dead = jest.fn(async () => { throw new Error('down'); });
    expect(await G.getStartingGoalies('Tampa Bay Lightning', 'Washington Capitals', dead)).toBeNull();
  });
});
