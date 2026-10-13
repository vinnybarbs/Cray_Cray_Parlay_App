// PR 226 bound the started and recent queries by position in the wrong
// order, so started cards came back without their why (owner 2026-10-13:
// "I still can't click anything on a prop"). This pins which query
// feeds which list.
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy';

const now = Date.now();
const iso = (h) => new Date(now + h * 3600e3).toISOString();
const base = {
  market: 'player_receptions', player_key: 'p', player_name: 'P', v2_prob: 0.6, anchor_prob: 0.5, line: 4.5,
  v2_side: 'over', v2_edge_pp: 8, consensus_over_price: -110, consensus_under_price: -110, books: 6,
  home_team: 'Buffalo Bills', away_team: 'Los Angeles Rams', actual_value: null,
};
const whyCols = { v2_mean: 5.2, v2_factors: {}, factors: { recent_mean: 5 }, narration: null };

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => {
      const f = { table, calls: [] };
      const chain = new Proxy({}, {
        get(_, m) {
          if (m === 'then') {
            return (resolve) => {
              const has = (name) => f.calls.some(c => c[0] === name);
              let data = [];
              if (table === 'prop_reads') {
                if (has('in')) data = [];
                else if (has('gt')) data = [{ ...base, ...whyCols, player_name: 'Up', commence_time: iso(5), v2_outcome: 'pending' }];
                else if (has('lte')) data = [{ ...base, ...whyCols, player_name: 'Live', commence_time: iso(-1), v2_outcome: 'pending' }];
                else if (has('lt')) data = [{ ...base, player_name: 'Old', commence_time: iso(-30), v2_outcome: 'won' }];
              }
              resolve({ data, error: null });
            };
          }
          return (...args) => { f.calls.push([m, ...args]); return chain; };
        },
      });
      return chain;
    },
  }),
}));

const props = require('../../api/props');

it('started reads come from the started query, with their why', async () => {
  let body;
  const res = { setHeader() {}, status() { return this; }, json(b) { body = b; } };
  await props({ method: 'GET' }, res);
  expect(body.live.map(p => p.player)).toEqual(['Live']);
  expect(body.live[0].why).not.toBeNull();
  expect(body.recent.map(p => p.player)).toEqual(['Old']);
  expect(body.upcoming.map(p => p.player)).toEqual(['Up']);
});
