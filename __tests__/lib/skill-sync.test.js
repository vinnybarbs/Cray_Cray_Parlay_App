// The repo comes to the routines through Supabase: every skill under
// .claude/skills must be readable, hashed, and named so the sync can
// upsert it and a routine can select it by name.

const { readSkills, SKILLS_DIR, BRIEF_PREFIX, DESK_PREFIX } = require('../../lib/services/skill-sync');

describe('readSkills', () => {
  const skills = readSkills();
  const names = skills.map(s => s.name);

  test('finds every TrapHawk skill in the repo', () => {
    for (const expected of [
      'traphawk-ops-check', 'traphawk-performance-review', 'traphawk-cost-audit',
      'traphawk-data-model', 'traphawk-ship', 'traphawk-status-board',
    ]) {
      expect(names).toContain(expected);
    }
  });

  test('every skill carries content, a sha256, and a byte count', () => {
    for (const s of skills) {
      if (s.name !== 'AGENTS.md' && !s.name.startsWith(BRIEF_PREFIX)) expect(s.content.startsWith('---')).toBe(true);
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.bytes).toBeGreaterThan(200);
    }
  });

  // Owner 2026-09-28: AGENTS.md is the top line every session and routine
  // reads before its skill, so it rides the same sync as its own row.
  test('AGENTS.md syncs first as its own row, with the never list', () => {
    expect(names[0]).toBe('AGENTS.md');
    const agents = skills[0];
    expect(agents.content.startsWith('# AGENTS.md')).toBe(true);
    expect(agents.content).toContain('## Never');
    expect(agents.content).toContain('## Session start checklist');
    expect(agents.content).not.toMatch(/[\u2014\u2013;\u2192]/);
  });

  test('an empty directory syncs nothing rather than throwing', () => {
    expect(readSkills(SKILLS_DIR + '-does-not-exist', null, null)).toEqual([]);
  });

  // Owner 2026-10-09 (the Aloe arrangement): one brief per cloud routine
  // under agents/, synced as row agents/<file> so a one line routine
  // prompt can load it by name. Mission, schedule and rules change only
  // by a deliberate owner commit, so the brief's shape is pinned here.
  test('every agent brief under agents/ syncs as its own row', () => {
    for (const expected of [
      'agents/README.md', 'agents/daily-ops-check.md', 'agents/exec-assistant.md',
      'agents/weekly-calibration-review.md', 'agents/monthly-cost-audit.md',
      'agents/football-desk.md', 'agents/desks/football.md', 'agents/downstream-sync.md',
    ]) {
      expect(names).toContain(expected);
    }
    const briefs = skills.filter(s => s.name.startsWith(BRIEF_PREFIX));
    for (const b of briefs) {
      expect(b.content).not.toMatch(/[—–;→]/);
      if (b.name === 'agents/README.md' || b.name.startsWith(DESK_PREFIX)) continue;
      expect(b.content.startsWith('You are the TrapHawk ')).toBe(true);
      expect(b.content).toContain('Supabase MCP');
      expect(b.content).toContain('say so loudly');
    }
    // The briefs name the skills table rows they load, and those exist.
    for (const b of briefs) {
      if (b.name === 'agents/README.md' || b.name.startsWith(DESK_PREFIX)) continue;
      for (const m of b.content.matchAll(/where name = '([^']+)'/g)) {
        expect(names).toContain(m[1]);
      }
    }
  });
});

// Owner 2026-10-09 (workforce plan, football desk first): a desk book
// under agents/desks/ is the market by market knowledge a desk brief
// loads. It is not a brief (no routine fires on it) but it syncs as its
// own row, keeps the house punctuation, and carries the sections the
// desk brief tells the desk to read.
describe('desk books', () => {
  const skills = readSkills();
  const football = skills.find(s => s.name === 'agents/desks/football.md');

  test('agents/desks/football.md syncs as its own row with the required sections', () => {
    expect(football).toBeDefined();
    expect(football.content).not.toMatch(/[—–;→]/);
    for (const heading of [
      '## How this book is used', '## NFL moneyline', '## NFL spread', '## NFL totals',
      '## NCAAF', '## The verdict categories', '## Dials and rules in force',
      '## Narration vocabulary', '## Banned claims', '## The promotion bar',
    ]) {
      expect(football.content).toContain(heading);
    }
  });

  test('the football desk brief loads its book and the data model skill', () => {
    const brief = skills.find(s => s.name === 'agents/football-desk.md');
    expect(brief.content).toContain("where name = 'agents/desks/football.md'");
    expect(brief.content).toContain("where name = 'traphawk-data-model'");
    expect(brief.content).toContain('desk_verdicts');
    expect(brief.content).toContain('desk_hypotheses');
    expect(brief.content).toContain('no win probability of your own');
  });
});
