const billing = require('../../lib/services/billing');
const paywall = require('../../lib/services/paywall');

const ENV = { STRIPE_PRICE_LAUNCH: 'price_launch', STRIPE_PRICE_STANDARD: 'price_std' };
const NOW = new Date('2026-10-20T12:00:00Z');

describe('choosePrice', () => {
  test('launch price while seats remain', () => {
    expect(billing.choosePrice({ launchMember: false, seatsTaken: 10, now: NOW }, ENV)).toEqual({ priceId: 'price_launch', plan: 'launch', interval: 'month' });
  });
  test('standard price once the launch seats are gone', () => {
    expect(billing.choosePrice({ launchMember: false, seatsTaken: 250, now: NOW }, ENV)).toEqual({ priceId: 'price_std', plan: 'standard', interval: 'month' });
  });
  test('standard price when the launch is closed', () => {
    expect(billing.choosePrice({ launchMember: false, seatsTaken: 0, now: NOW }, { ...ENV, LAUNCH_OPEN: 'off' }).plan).toBe('standard');
  });
  test('a launch member gets the launch price back for life', () => {
    expect(billing.choosePrice({ launchMember: true, seatsTaken: 500 }, { ...ENV, LAUNCH_OPEN: 'off' }).plan).toBe('launch');
  });
  test('the cap is configurable', () => {
    expect(billing.choosePrice({ seatsTaken: 5, now: NOW }, { ...ENV, LAUNCH_SEATS: '5' }).plan).toBe('standard');
  });
  test('no prices set means no offer', () => {
    expect(billing.choosePrice({ seatsTaken: 0 }, {}).priceId).toBeNull();
  });
});

describe('founding terms', () => {
  const E = { ...ENV, STRIPE_PRICE_LAUNCH_ANNUAL: 'price_launch_yr' };
  const before = new Date('2026-11-30T20:00:00Z');
  const after = new Date('2026-12-01T08:00:00Z');
  test('defaults to 250 seats', () => {
    expect(billing.choosePrice({ seatsTaken: 249, now: before }, E).plan).toBe('launch');
    expect(billing.choosePrice({ seatsTaken: 250, now: before }, E).plan).toBe('standard');
  });
  test('closes after November 30 Mountain time', () => {
    expect(billing.choosePrice({ seatsTaken: 0, now: after }, E).plan).toBe('standard');
  });
  test('LAUNCH_ENDS overrides the date', () => {
    expect(billing.choosePrice({ seatsTaken: 0, now: after }, { ...E, LAUNCH_ENDS: '2027-01-01T00:00:00Z' }).plan).toBe('launch');
  });
  test('yearly launch price, and a launch member keeps it after the close', () => {
    expect(billing.choosePrice({ seatsTaken: 0, interval: 'year', now: before }, E)).toEqual({ priceId: 'price_launch_yr', plan: 'launch', interval: 'year' });
    expect(billing.choosePrice({ launchMember: true, seatsTaken: 999, interval: 'year', now: after }, E).priceId).toBe('price_launch_yr');
  });
  test('no standard yearly price means no yearly offer after launch', () => {
    expect(billing.choosePrice({ seatsTaken: 0, interval: 'year', now: after }, E).priceId).toBeNull();
  });
  test('an annual launch subscription is a launch seat', () => {
    const p = billing.subscriptionPatch({ id: 's', customer: 'c', status: 'active', items: { data: [{ price: { id: 'price_launch_yr' } }] } }, E);
    expect(p).toMatchObject({ plan: 'launch', launch_member: true });
  });
});

describe('keyProblem', () => {
  test('a test key is fine', () => expect(billing.keyProblem({ STRIPE_SECRET_KEY: 'sk_test_abc' })).toBeNull());
  test('a live key needs BILLING_LIVE=on', () => {
    expect(billing.keyProblem({ STRIPE_SECRET_KEY: 'sk_live_abc' })).toMatch(/BILLING_LIVE/);
    expect(billing.keyProblem({ STRIPE_SECRET_KEY: 'sk_live_abc', BILLING_LIVE: 'on' })).toBeNull();
  });
  test('a publishable key is refused', () => expect(billing.keyProblem({ STRIPE_SECRET_KEY: 'pk_test_abc' })).not.toBeNull());
  test('missing key', () => expect(billing.keyProblem({})).not.toBeNull());
});

describe('entitlementFor', () => {
  const old = { id: 'u1', created_at: '2026-09-01T00:00:00Z' };
  test('signed out', () => expect(billing.entitlementFor(null, null, NOW).entitled).toBe(false));
  test('new account is on the 7 day trial, no card', () => {
    const e = billing.entitlementFor({ id: 'u', created_at: '2026-10-16T00:00:00Z' }, null, NOW);
    expect(e).toMatchObject({ entitled: true, reason: 'trial' });
  });
  test('trial over without a subscription', () => {
    expect(billing.entitlementFor(old, null, NOW)).toMatchObject({ entitled: false, reason: 'trial_over' });
  });
  test('active, trialing and past_due keep access', () => {
    for (const status of ['active', 'trialing', 'past_due']) {
      expect(billing.entitlementFor(old, { status, plan: 'launch' }, NOW).entitled).toBe(true);
    }
  });
  test('canceled and unpaid lose access', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete_expired']) {
      expect(billing.entitlementFor(old, { status }, NOW)).toMatchObject({ entitled: false, reason: status });
    }
  });
  test('a forever comp', () => {
    expect(billing.entitlementFor(old, { status: 'none', comp_until: 'infinity' }, NOW)).toMatchObject({ entitled: true, reason: 'comp' });
  });
  test('comp grant until a date', () => {
    expect(billing.entitlementFor(old, { status: 'none', comp_until: '2026-12-31T00:00:00Z' }, NOW).reason).toBe('comp');
    expect(billing.entitlementFor(old, { status: 'none', comp_until: '2026-10-01T00:00:00Z' }, NOW).entitled).toBe(false);
  });
});

describe('subscriptionPatch', () => {
  const sub = (over = {}) => ({
    id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
    items: { data: [{ price: { id: 'price_launch' }, current_period_end: 1793000000 }] },
    ...over,
  });
  test('a paid launch subscription makes a launch member', () => {
    const p = billing.subscriptionPatch(sub(), ENV);
    expect(p).toMatchObject({ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', status: 'active', plan: 'launch', launch_member: true });
    expect(p.current_period_end).toBe(new Date(1793000000 * 1000).toISOString());
  });
  test('the founding price lapses once the subscription ends', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete_expired']) {
      expect(billing.subscriptionPatch(sub({ status }), ENV).launch_member).toBe(false);
    }
  });
  test('a cancel at period end keeps the founding price until then', () => {
    expect(billing.subscriptionPatch(sub({ cancel_at_period_end: true }), ENV)).toMatchObject({ launch_member: true, cancel_at_period_end: true });
  });
  test('an incomplete checkout is not a launch seat', () => {
    expect(billing.subscriptionPatch(sub({ status: 'incomplete' }), ENV)).not.toHaveProperty('launch_member');
  });
  test('standard plan', () => {
    const p = billing.subscriptionPatch(sub({ items: { data: [{ price: { id: 'price_std' } }] }, current_period_end: 1793000000 }), ENV);
    expect(p.plan).toBe('standard');
    expect(p).not.toHaveProperty('launch_member');
    expect(p.current_period_end).not.toBeNull();
  });
});

describe('applyEvent', () => {
  function fakeSupabase(existing = null) {
    const writes = [];
    const api = {
      writes,
      from: () => ({
        upsert: (row) => { writes.push(row); return Promise.resolve({ error: null }); },
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: existing }) }) }),
      }),
    };
    return api;
  }
  const subObj = { id: 'sub_9', customer: 'cus_9', status: 'active', metadata: { user_id: 'u9' }, items: { data: [{ price: { id: 'price_launch' } }] } };

  test('checkout completed fetches the subscription and writes the row', async () => {
    const supabase = fakeSupabase();
    const stripe = { subscriptions: { retrieve: jest.fn().mockResolvedValue(subObj) } };
    const event = { type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_9', client_reference_id: 'u9', customer_details: { email: 'a@b.co' } } } };
    await expect(billing.applyEvent(event, { supabase, stripe, env: ENV })).resolves.toBe('subscribed');
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_9');
    expect(supabase.writes[0]).toMatchObject({ user_id: 'u9', email: 'a@b.co', plan: 'launch', launch_member: true });
  });
  test('a subscription update without metadata finds the user by subscription id', async () => {
    const supabase = fakeSupabase({ user_id: 'u7' });
    const event = { type: 'customer.subscription.deleted', data: { object: { ...subObj, metadata: {}, status: 'canceled' } } };
    await expect(billing.applyEvent(event, { supabase, stripe: {}, env: ENV })).resolves.toBe('canceled');
    expect(supabase.writes[0]).toMatchObject({ user_id: 'u7', status: 'canceled' });
  });
  test('other events are ignored', async () => {
    await expect(billing.applyEvent({ type: 'invoice.paid', data: { object: {} } }, { supabase: fakeSupabase(), stripe: {} })).resolves.toBe('ignored');
  });
});

describe('webhook signature', () => {
  test('a body signed with the secret verifies, a tampered one does not', () => {
    const Stripe = require('stripe');
    const stripe = new Stripe('sk_test_dummy');
    const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
    const secret = 'whsec_test';
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(stripe.webhooks.constructEvent(Buffer.from(payload), header, secret).id).toBe('evt_1');
    expect(() => stripe.webhooks.constructEvent(Buffer.from(payload.replace('evt_1', 'evt_2')), header, secret)).toThrow();
  });
});

describe('paywall gates', () => {
  test('off unless PAYWALL=on', () => {
    expect(paywall.paywallOn({})).toBe(false);
    expect(paywall.paywallOn({ PAYWALL: 'on' })).toBe(true);
  });

  test('Today keeps one free Play, locks the rest, leaves Leans and traps', () => {
    const picks = [
      { pick: 'A -3', odds: -110, edge_pp: 9, tier: 'Strong Play', home_team: 'H1', away_team: 'A1', book_pct: 50, our_pct: 59, shop: {} },
      { pick: 'B +4', odds: -110, edge_pp: 5, tier: 'Play', home_team: 'H2', away_team: 'A2', book_pct: 50, our_pct: 55 },
      { pick: 'C ML', odds: 120, edge_pp: 2.5, tier: 'Lean', home_team: 'H3', away_team: 'A3' },
    ];
    const out = paywall.gateToday({ picks, traps: [{ pick: 'T', edge_pp: -4 }], started: [{ pick: 'S', edge_pp: 8 }] });
    expect(out.picks[0]).toMatchObject({ pick: 'A -3', free: true });
    expect(out.picks[1]).toEqual(expect.objectContaining({ locked: true, tier: 'Play', home_team: 'H2' }));
    for (const k of ['pick', 'odds', 'edge_pp', 'book_pct', 'our_pct', 'shop']) expect(out.picks[1]).not.toHaveProperty(k);
    expect(out.picks[2].pick).toBe('C ML');
    expect(out.traps[0].pick).toBe('T');
    expect(out.started[0].pick).toBe('S');
    expect(out.gated).toBe(true);
  });

  test('props keep the two strongest open', () => {
    const up = [1, 2, 3].map(i => ({ player: `P${i}`, marketLabel: 'receptions', side: 'over', line: 4.5, price: -110, edgePp: 8 - i, why: { x: 1 }, ourProb: 60, bookProb: 52 }));
    const out = paywall.gateProps({ upcoming: up, live: [{ side: 'over' }], recent: [] });
    expect(out.upcoming[0].free).toBe(true);
    expect(out.upcoming[1].free).toBe(true);
    expect(out.upcoming[2]).toMatchObject({ locked: true, player: 'P3', text: 'P3 receptions' });
    for (const k of ['side', 'line', 'price', 'edgePp', 'why', 'ourProb', 'bookProb']) expect(out.upcoming[2]).not.toHaveProperty(k);
    expect(out.live[0].side).toBe('over');
  });

  test('board tile for a Play loses its side fields, a Lean keeps them', () => {
    const play = { home_team: 'H', away_team: 'A', recommended_pick: 'H -3', edges: {}, calc_home_prob: 0.6, analysis_snippet: 'x', spread: -3, published_pick: { pick: 'H -3', odds: -110, edge_pp: 6, tier: 'Play', bet_type: 'Spread' }, published_alts: [{ pick: 'Over', edge_pp: 5, tier: 'Play', bet_type: 'Total' }, { pick: 'H ML', edge_pp: 2, tier: 'Lean' }] };
    const lean = { home_team: 'H2', recommended_pick: 'H2 ML', published_pick: { pick: 'H2 ML', edge_pp: 3, tier: 'Lean' } };
    const out = paywall.gateDigest({ gamesBySport: { NFL: [play, lean] }, startedGames: [play] });
    const g = out.gamesBySport.NFL[0];
    expect(g.locked).toBe(true);
    expect(g.published_pick).toEqual({ bet_type: 'Spread', tier: 'Play', locked: true });
    for (const k of ['recommended_pick', 'edges', 'calc_home_prob', 'analysis_snippet']) expect(g).not.toHaveProperty(k);
    expect(g.spread).toBe(-3);
    expect(g.published_alts[0]).toEqual({ bet_type: 'Total', tier: 'Play', locked: true });
    expect(g.published_alts[1].pick).toBe('H ML');
    expect(out.gamesBySport.NFL[1].recommended_pick).toBe('H2 ML');
    expect(out.startedGames[0].published_pick.pick).toBe('H -3');
  });

  test('parlays lock only legs not yet started', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    const rows = [{ status: 'pending', legs: [{ pick: 'X', game_date: '2026-10-14T18:00:00Z' }, { pick: 'Y', game_date: '2026-10-14T10:00:00Z' }] }];
    const out = paywall.gateParlays(rows, now);
    expect(out[0].legs[0]).toMatchObject({ locked: true })
    expect(out[0].legs[0]).not.toHaveProperty('pick');
    expect(out[0].legs[1].pick).toBe('Y');
  });

  test('player sheet locks upcoming reads only', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    const out = paywall.gatePlayer({ reads: [
      { text: 'P over 4.5 receptions', side: 'over', line: 4.5, edgePp: 6, commence_time: '2026-10-19T17:00:00Z' },
      { text: 'P over 3.5 receptions', side: 'over', line: 3.5, edgePp: 6, commence_time: '2026-10-12T17:00:00Z', outcome: 'won' },
    ] }, now);
    expect(out.reads[0]).toMatchObject({ locked: true, text: 'Pro read' });
    expect(out.reads[0]).not.toHaveProperty('side');
    expect(out.reads[1].side).toBe('over');
  });
});
