const {
  approvedRecordSource,
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
