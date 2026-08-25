const { getCalibrationMultiplier, _resetCache } = require('../../lib/services/calibration-multiplier');

function fakeSupabase(calRows, { fail = false } = {}) {
  return {
    from() {
      return {
        select() {
          return {
            in: async () => fail
              ? { data: null, error: new Error('down') }
              : { data: calRows, error: null },
          };
        },
      };
    },
  };
}

describe('getCalibrationMultiplier', () => {
  afterEach(() => _resetCache());

  test('first key in the chain wins', async () => {
    const v = await getCalibrationMultiplier(
      fakeSupabase([{ key: 'UFC:ml', multiplier: '1.2' }, { key: 'UFC', multiplier: '0.4' }]),
      ['UFC:ml', 'UFC']);
    expect(v).toBe(1.2);
  });

  test('falls through missing keys, then to 1', async () => {
    expect(await getCalibrationMultiplier(
      fakeSupabase([{ key: 'UFC', multiplier: '0.4' }]), ['UFC:ml', 'UFC'])).toBe(0.4);
    _resetCache();
    expect(await getCalibrationMultiplier(fakeSupabase([]), ['UFC:ml', 'UFC'])).toBe(1);
  });

  test('a table outage fails open to 1', async () => {
    expect(await getCalibrationMultiplier(
      fakeSupabase(null, { fail: true }), ['UFC:ml', 'UFC'])).toBe(1);
  });
});
