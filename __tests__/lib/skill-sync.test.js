// The repo comes to the routines through Supabase: every skill under
// .claude/skills must be readable, hashed, and named so the sync can
// upsert it and a routine can select it by name.

const { readSkills, SKILLS_DIR } = require('../../lib/services/skill-sync');

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
      expect(s.content.startsWith('---')).toBe(true);
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.bytes).toBeGreaterThan(200);
    }
  });

  test('an empty directory syncs nothing rather than throwing', () => {
    expect(readSkills(SKILLS_DIR + '-does-not-exist')).toEqual([]);
  });
});
