process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { normalizeArticle, matchNews, formatNewsLines, getNewsText, ESPN_NEWS_PATHS, _resetCache } = require('../../lib/services/espn-news');
const { mapPlayer } = require('../../api/cron/sync-sleeper-players');

const raw = (headline, published, teams = [], athletes = [], description = '') => ({
  headline, published, description,
  categories: [
    ...teams.map(d => ({ type: 'team', description: d })),
    ...athletes.map(d => ({ type: 'athlete', description: d })),
    { type: 'league', description: 'NFL' },
  ],
});

describe('espn news', () => {
  const now = new Date('2026-09-14T16:00:00Z').getTime();
  const articles = [
    raw('Lamar Jackson looks like old self', '2026-09-14T15:00:00Z', ['Baltimore Ravens'], ['Lamar Jackson']),
    raw('How to bet Broncos-Chiefs on MNF', '2026-09-14T14:00:00Z', ['Denver Broncos', 'Kansas City Chiefs']),
    raw('Chiefs sign a long snapper', '2026-09-14T09:00:00Z', ['Kansas City Chiefs'], [], 'Roster move ahead of Monday night.'),
    raw('Old Chiefs story', '2026-09-01T09:00:00Z', ['Kansas City Chiefs']),
    raw('Nets assistant Fernandez promoted', '2026-09-14T12:00:00Z', ['Brooklyn Nets']),
  ].map(normalizeArticle);

  test('normalizeArticle keeps team and athlete tags and drops league tags', () => {
    expect(articles[0].teams).toEqual(['Baltimore Ravens']);
    expect(articles[0].athletes).toEqual(['Lamar Jackson']);
    expect(normalizeArticle({ categories: [] })).toBeNull();
  });

  test('matchNews returns articles tagged to either club, newest first, inside the age window', () => {
    const hits = matchNews(articles, ['Kansas City Chiefs', 'Denver Broncos'], { maxAgeDays: 3, limit: 5, now });
    expect(hits.map(a => a.headline)).toEqual(['How to bet Broncos-Chiefs on MNF', 'Chiefs sign a long snapper']);
  });

  test('a player name matches the athlete tag; a mascot alone does not cross sports', () => {
    expect(matchNews(articles, ['Lamar Jackson'], { now }).map(a => a.headline)).toEqual(['Lamar Jackson looks like old self']);
    expect(matchNews(articles, ['Leylah Fernandez'], { now })).toEqual([]);
  });

  test('limit and empty names', () => {
    expect(matchNews(articles, ['Kansas City Chiefs'], { now, limit: 1 })).toHaveLength(1);
    expect(matchNews(articles, [], { now })).toEqual([]);
  });

  test('formatNewsLines keeps the RSS era prompt shape', () => {
    const text = formatNewsLines(matchNews(articles, ['Kansas City Chiefs'], { now, limit: 2 }));
    expect(text).toBe('- How to bet Broncos-Chiefs on MNF\n- Chiefs sign a long snapper | Roster move ahead of Monday night.');
    expect(formatNewsLines([])).toBeNull();
  });

  test('every narrated team sport has an ESPN path and player sports do not', () => {
    for (const s of ['NFL', 'NCAAF', 'NBA', 'NCAAB', 'NHL', 'MLB', 'EPL', 'MLS']) expect(ESPN_NEWS_PATHS[s]).toBeTruthy();
    expect(ESPN_NEWS_PATHS.Tennis).toBeUndefined();
    expect(ESPN_NEWS_PATHS.UFC).toBeUndefined();
  });

  test('getNewsText fetches once per sport and fails soft', async () => {
    _resetCache();
    let calls = 0;
    const fetchFn = async () => { calls++; return { ok: true, json: async () => ({ articles: [raw('Chiefs sign a long snapper', new Date().toISOString(), ['Kansas City Chiefs'])] }) }; };
    const a = await getNewsText('NFL', ['Kansas City Chiefs', 'Denver Broncos'], {}, fetchFn);
    const b = await getNewsText('NFL', ['Kansas City Chiefs'], {}, fetchFn);
    expect(a).toContain('long snapper');
    expect(b).toContain('long snapper');
    expect(calls).toBe(1);
    expect(await getNewsText('Tennis', ['Someone'], {}, fetchFn)).toBeNull();
    _resetCache();
    expect(await getNewsText('NFL', ['X'], {}, async () => { throw new Error('down'); })).toBeNull();
  });
});

describe('sleeper mapPlayer', () => {
  const synced = '2026-09-14T12:30:00.000Z';
  test('a rostered player maps with normalized team, order and news instant', () => {
    const r = mapPlayer({
      player_id: '8733', full_name: 'Jake Hummel', team: 'LAR', position: 'LB', status: 'Active',
      injury_status: 'Questionable', injury_body_part: 'Abdomen', injury_notes: null,
      depth_chart_position: 'MLB', depth_chart_order: 2, news_updated: 1789328756004, espn_id: 4360000,
    }, synced);
    expect(r.team).toBe('LA');
    expect(r.depth_chart_order).toBe(2);
    expect(r.news_updated).toBe(new Date(1789328756004).toISOString());
    expect(r.espn_id).toBe('4360000');
    expect(r.synced_at).toBe(synced);
  });
  test('free agents and nameless rows are skipped', () => {
    expect(mapPlayer({ player_id: '1', full_name: 'Nobody', team: null }, synced)).toBeNull();
    expect(mapPlayer({ player_id: '2', team: 'KC' }, synced)).toBeNull();
  });
});
