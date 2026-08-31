const { isKnownUfcBout } = require('../../lib/services/ufc-data');

function fakeSupabase(knownKeys, { fail = false } = {}) {
  return {
    from() {
      return {
        select() {
          return {
            in: async (col, keys) => fail
              ? { data: null, error: new Error('down') }
              : { data: keys.filter(k => knownKeys.includes(k)).map(k => ({ fighter_key: k })), error: null },
          };
        },
      };
    },
  };
}

describe('isKnownUfcBout (owner rule: non-UFC MMA cards never enter the leg pool)', () => {
  test('both fighters known means a settleable UFC bout', async () => {
    const sb = fakeSupabase(['bella mir', 'jasmine jasudavicius']);
    expect(await isKnownUfcBout(sb, 'Bella Mir', 'Jasmine Jasudavicius')).toBe(true);
  });

  test('a regional-card fighter unknown to ESPN blocks the bout', async () => {
    const sb = fakeSupabase(['bella mir']);
    expect(await isKnownUfcBout(sb, 'Peter Barrett', 'Elijah Harris')).toBe(false);
    expect(await isKnownUfcBout(sb, 'Bella Mir', 'Elijah Harris')).toBe(false);
  });

  test('a suffix-mangled odds-feed name fails closed, a skipped leg beats an unsettleable one', async () => {
    const sb = fakeSupabase(['sean clancy jr', 'gary balletto']);
    expect(await isKnownUfcBout(sb, 'Sean Jr. Clancy', 'Gary Balletto Jr.')).toBe(false);
  });

  test('a query outage fails closed', async () => {
    const sb = fakeSupabase([], { fail: true });
    expect(await isKnownUfcBout(sb, 'Bella Mir', 'Jasmine Jasudavicius')).toBe(false);
  });
});
