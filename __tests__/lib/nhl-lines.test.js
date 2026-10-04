// NHL lineups (2026-10-04): who is out from the DailyFaceoff line chart and
// how much of the lineup he was, slot or cap hit ladder, on two dials.

const L = require('../../lib/services/nhl-lines');

beforeEach(() => L._resetCache());

const player = (name, cat, group, extra = {}) => ({ name, categoryIdentifier: cat, groupIdentifier: group, positionIdentifier: extra.pos || 'c', injuryStatus: extra.status || null, gameTimeDecision: !!extra.gtd, cap: { capHit: extra.cap || 900000 }, latestNews: extra.news ? { details: extra.news } : null });
const page = (players) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { combinations: { teamName: 'Buffalo Sabres', teamAbbreviation: 'BUF', updatedAt: '2026-10-03T22:40:33.149Z', players, lines: [] }, sortedTeams: [{ name: 'Buffalo Sabres', mascot: 'Sabres', slug: 'buffalo-sabres' }, { name: 'Utah Mammoth', mascot: 'Mammoth', slug: 'utah-mammoth' }] } } })}</script></html>`;

test('parse keeps slot, status, cap and news, and the team list drives slugs', () => {
  const p = L.parseLinesPage(page([player('Rasmus Dahlin', 'ev', 'd1', { pos: 'ld', cap: 11000000 }), player('Jason Zucker', 'oi', 'ir', { pos: 'ir1', status: 'ir', cap: 4750000, news: 'Zucker (sports hernia) will not be ready.' })]));
  expect(p.team).toBe('Buffalo Sabres');
  expect(p.players[1]).toMatchObject({ name: 'Jason Zucker', status: 'ir', capHit: 4750000, group: 'ir' });
  expect(L.slugFor('Utah Mammoth', p.teams)).toBe('utah-mammoth');
  expect(L.slugFor('Mammoth', p.teams)).toBe('utah-mammoth');
  expect(L.slugFor('St. Louis Blues', null)).toBe('st louis blues'.replace(/\s+/g, '-'));
  expect(L.parseLinesPage('<html></html>')).toBeNull();
});

test('the cap ladder and the cost: IR in full, day to day at 0.4, slot beats cap when he is still listed, goalies excluded, capped per club', () => {
  expect(L.capWeight(1000000)).toBe(0);
  expect(L.capWeight(4250000)).toBeCloseTo(0.5, 2);
  expect(L.capWeight(9000000)).toBe(1);
  const p = L.parseLinesPage(page([
    player('Rasmus Dahlin', 'ev', 'd1', { pos: 'ld', cap: 11000000 }),
    player('Jason Zucker', 'oi', 'ir', { pos: 'ir1', status: 'ir', cap: 4750000 }),
    player('Conor Timmins', 'oi', 'ir', { pos: 'ir3', status: 'ir', cap: 2200000 }),
    player('Alex Lyon', 'oi', 'ir', { pos: 'g', status: 'dtd', cap: 1500000 }),
    player('Tage Thompson', 'ev', 'f1', { pos: 'c', status: 'dtd', cap: 1200000 }),
  ]));
  const r = L.lineupImpact(p);
  const zucker = r.out.find(o => o.player === 'Jason Zucker');
  expect(zucker.weight).toBeCloseTo(0.58, 2);
  expect(zucker.cost).toBeCloseTo(0.58 * 0.015, 3);
  const thompson = r.out.find(o => o.player === 'Tage Thompson');
  expect(thompson).toMatchObject({ slot: 'f1', weight: 1, status: 'dtd' });
  expect(thompson.cost).toBeCloseTo(0.4 * 0.015, 4);
  expect(r.out.find(o => o.player === 'Alex Lyon')).toBeUndefined();
  expect(r.counted).toBe(3);
  expect(r.impact).toBeCloseTo(-(zucker.cost + thompson.cost + r.out.find(o => o.player === 'Conor Timmins').cost), 4);
  expect(r.keyLoss).toContain('Jason Zucker');
  const heavy = L.lineupImpact(p, { skaterOutPp: 0.05, capPp: 0.05 });
  expect(heavy.impact).toBe(-0.05);
  expect(L.lineupImpact({ players: [] })).toEqual({ impact: 0, out: [], keyLoss: null, counted: 0 });
});

test('getNhlLineupImpact fetches the club page by slug, caches it, and is null when the page is dark', async () => {
  const fetchFn = jest.fn(async (url) => url.includes('buffalo-sabres') ? { ok: true, text: async () => page([player('Jason Zucker', 'oi', 'ir', { status: 'ir', cap: 4750000 })]) } : { ok: false, text: async () => '' });
  const r = await L.getNhlLineupImpact('Buffalo Sabres', {}, fetchFn);
  expect(r).toMatchObject({ slug: 'buffalo-sabres', counted: 1, source: 'dailyfaceoff' });
  await L.getNhlLineupImpact('Buffalo Sabres', {}, fetchFn);
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(await L.getNhlLineupImpact('Edmonton Oilers', {}, fetchFn)).toBeNull();
});
