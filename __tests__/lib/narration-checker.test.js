const { checkNarration, normalizeVerdict, draftText, CHECKER_MODEL } = require('../../lib/services/narration-checker.js');
const { MODELS } = require('../../lib/services/claude.js');

function fakeClient(text, usage = { input_tokens: 1000, output_tokens: 50 }) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        return { content: [{ type: 'text', text }], usage };
      },
    },
  };
}

const result = { analysis_snippet: 'The Bills are 4-1 and host the Jets.', key_factors: ['Bills 4-1'] };

describe('narration checker (build_queue 90)', () => {
  test('runs on Haiku 5.5, the UTILITY model', () => {
    expect(MODELS.UTILITY).toBe('claude-haiku-5-5');
    expect(CHECKER_MODEL).toBe('claude-haiku-5-5');
  });

  test('a pass verdict is logged with tokens and cost', async () => {
    const client = fakeClient('{"verdict":"pass","issues":[]}');
    const out = await checkNarration({ client, context: 'Bills 4-1', result });
    expect(out.verdict).toBe('pass');
    expect(out.issues).toEqual([]);
    expect(out.input_tokens).toBe(1000);
    expect(out.cost_usd).toBeCloseTo(0.000125, 9);
    expect(client.calls[0].model).toBe('claude-haiku-5-5');
    expect(client.calls[0].thinking).toEqual({ type: 'disabled' });
    expect(client.calls[0].messages[0].content).toContain('Bills 4-1');
  });

  test('a fail verdict carries the issues', async () => {
    const client = fakeClient('{"verdict":"fail","issues":[{"claim":"4-1","problem":"context says 3-2"}]}');
    const out = await checkNarration({ client, context: 'Bills 3-2', result });
    expect(out.verdict).toBe('fail');
    expect(out.issues).toHaveLength(1);
  });

  test('never throws: an API error or junk text is verdict error', async () => {
    const broken = { messages: { create: async () => { throw new Error('overloaded'); } } };
    expect((await checkNarration({ client: broken, context: 'x', result })).verdict).toBe('error');
    expect((await checkNarration({ client: fakeClient('no json here'), context: 'x', result })).verdict).toBe('error');
    expect((await checkNarration({ client: null, context: 'x', result })).error).toBe('no client');
  });

  test('verdict and issues must agree', () => {
    expect(normalizeVerdict({ verdict: 'fail', issues: [] }).verdict).toBe('pass');
    expect(normalizeVerdict({ verdict: 'pass', issues: [{ claim: 'a' }] }).verdict).toBe('fail');
    expect(normalizeVerdict({ verdict: 'maybe' })).toBeNull();
  });

  test('the draft is the snippet plus the key factors', () => {
    expect(draftText(result)).toBe('The Bills are 4-1 and host the Jets.\n- Bills 4-1');
  });
});
