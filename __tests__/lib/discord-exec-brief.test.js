process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { formatExecBrief } = require('../../api/cron/discord-exec-brief');
const { embedText } = require('../../lib/services/discord-alerts');

const row = {
  id: 230,
  agent: 'exec-assistant',
  created_at: '2026-10-10T15:20:00Z',
  summary: 'skills from supabase. Not all clear. Record 30 days 271-208 +18.7u, 7 days 118-78 +7.6u. WHAT SHIPPED TODAY: PR 205 directive 13 amendment and the workforce registry. PR 206 desk tables and the desk scorecard view. WHAT THE MACHINE FOUND: NHL goalie attribution verified on all nine games. The sweep could not test pdamp75 (build_queue 86). YOUR CALLS: Inline Haiku checker before each narration, recommend yes. Haiku on Lean narration after a 50 tile comparison, recommend run the comparison first. 3 more wait behind these.',
};

describe('formatExecBrief', () => {
  test('lead embed, then one embed per section, footer on the last', () => {
    const embeds = formatExecBrief(row, 'Friday, Oct 10');
    expect(embeds[0].title).toBe('🦅 Exec assistant · Friday, Oct 10');
    expect(embeds[0].description).toMatch(/^Not all clear/);
    expect(embeds[0].description).not.toMatch(/skills from supabase/);
    expect(embeds.map(e => e.title).slice(1)).toEqual(['What shipped today', 'What the machine found', 'Your calls']);
    expect(embeds[embeds.length - 1].footer.text).toContain('Blackboard row 230');
  });

  test('section bodies keep every sentence and nothing from the other sections', () => {
    const embeds = formatExecBrief(row, 'Friday, Oct 10');
    const shipped = embeds[1].description;
    expect(shipped).toContain('PR 205');
    expect(shipped).toContain('PR 206');
    expect(shipped).not.toContain('goalie');
    const calls = embeds[3].description;
    expect(calls).toContain('Inline Haiku checker');
    expect(calls).toContain('3 more wait behind these.');
    expect(embedText(embeds)).not.toMatch(/[—–;→]/);
  });

  test('a summary without the headers posts as one embed with the row id', () => {
    const embeds = formatExecBrief({ id: 7, summary: 'skills from supabase, dry run. Nothing shipped.' }, 'Thursday, Oct 9');
    expect(embeds).toHaveLength(1);
    expect(embeds[0].description).toBe('dry run. Nothing shipped.');
    expect(embeds[0].footer.text).toContain('row 7');
  });
});
