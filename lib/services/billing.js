// Billing (owner 2026-10-14): one plan, TrapHawk Pro, on Stripe. Launch
// members pay $9.99 a month and keep it for life (grandfathered). Later
// signups pay the standard price. Each price is its own Stripe price ID,
// so changing the standard price later never touches a launch member's
// subscription. The ledger stays free forever (build_queue 71).
//
// Environment (all set on Railway, never in the repo):
//   STRIPE_SECRET_KEY        sk_test_... while testing
//   STRIPE_WEBHOOK_SECRET    whsec_... from the webhook endpoint
//   STRIPE_PRICE_LAUNCH      price_... the $9.99 monthly launch price
//   STRIPE_PRICE_STANDARD    price_... the standard monthly price
//   LAUNCH_SEATS             launch price cap, default 100
//   LAUNCH_OPEN              off closes the launch price to new members
//   BILLING_LIVE             on allows an sk_live_ key, off by default
//   PUBLIC_APP_URL           where Checkout returns, default traphawk.io

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_LAUNCH_SEATS = 100;
// The account age free trial the landing page promises: 7 days, no card.
const TRIAL_DAYS = 7;
// Stripe statuses that keep access. past_due keeps it while Stripe
// retries the card, so a failed renewal does not lock anyone out at once.
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due']);

let stripeClient = null;
let supabaseClient = null;

function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  supabaseClient = createClient(url, key);
  return supabaseClient;
}

/**
 * Why the Stripe key cannot be used, or null when it can. A live key
 * needs BILLING_LIVE=on, so nobody is charged by accident. Pure.
 */
function keyProblem(env = process.env) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return 'STRIPE_SECRET_KEY is not set';
  if (key.startsWith('sk_live_') && env.BILLING_LIVE !== 'on') return 'live Stripe key without BILLING_LIVE=on';
  if (!key.startsWith('sk_test_') && !key.startsWith('sk_live_') && !key.startsWith('rk_')) return 'STRIPE_SECRET_KEY is not a Stripe secret key';
  return null;
}

function getStripe() {
  if (stripeClient) return stripeClient;
  if (keyProblem()) return null;
  const Stripe = require('stripe');
  stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

function appUrl(env = process.env) {
  return (env.PUBLIC_APP_URL || 'https://traphawk.io').replace(/\/+$/, '');
}

function launchSeats(env = process.env) {
  const n = parseInt(env.LAUNCH_SEATS, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LAUNCH_SEATS;
}

/**
 * Which price a checkout uses. A launch member always gets the launch
 * price back. Anyone else gets it while the launch is open and seats
 * remain, else the standard price. Pure.
 */
function choosePrice({ launchMember, seatsTaken }, env = process.env) {
  const launch = env.STRIPE_PRICE_LAUNCH || null;
  const standard = env.STRIPE_PRICE_STANDARD || null;
  if (launch && launchMember) return { priceId: launch, plan: 'launch' };
  const open = env.LAUNCH_OPEN !== 'off' && Number(seatsTaken || 0) < launchSeats(env);
  if (launch && open) return { priceId: launch, plan: 'launch' };
  if (standard) return { priceId: standard, plan: 'standard' };
  return { priceId: null, plan: null };
}

/** The plan a Stripe price ID belongs to. Pure. */
function planForPrice(priceId, env = process.env) {
  if (priceId && priceId === env.STRIPE_PRICE_LAUNCH) return 'launch';
  if (priceId && priceId === env.STRIPE_PRICE_STANDARD) return 'standard';
  return null;
}

/**
 * Whether a user has Pro access, and why. user is the Supabase auth user
 * (for created_at), row is their subscriptions row or null. Pure.
 */
function entitlementFor(user, row, now = new Date()) {
  if (!user) return { entitled: false, reason: 'signed_out' };
  const t = now.getTime();
  if (row && row.comp_until && new Date(row.comp_until).getTime() > t) {
    return { entitled: true, reason: 'comp', until: row.comp_until };
  }
  if (row && ENTITLED_STATUSES.has(row.status)) {
    return { entitled: true, reason: 'subscribed', plan: row.plan || null, status: row.status, until: row.current_period_end || null, cancelAtPeriodEnd: Boolean(row.cancel_at_period_end) };
  }
  const created = user.created_at ? new Date(user.created_at).getTime() : NaN;
  if (Number.isFinite(created)) {
    const trialEnd = created + TRIAL_DAYS * 86400e3;
    if (trialEnd > t) return { entitled: true, reason: 'trial', until: new Date(trialEnd).toISOString() };
  }
  return { entitled: false, reason: row && row.status && row.status !== 'none' ? row.status : 'trial_over' };
}

/**
 * The subscriptions columns a Stripe subscription object sets. Pure.
 * current_period_end moved onto the subscription item in newer API
 * versions, so both places are read.
 */
function subscriptionPatch(sub, env = process.env) {
  const item = sub && sub.items && Array.isArray(sub.items.data) ? sub.items.data[0] : null;
  const priceId = item && item.price ? item.price.id : null;
  const end = sub.current_period_end || (item && item.current_period_end) || null;
  const plan = planForPrice(priceId, env);
  const patch = {
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id) || null,
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: priceId,
    plan,
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  };
  // Grandfathering only ever turns on. A paid launch subscription makes
  // the user a launch member for good, even after they cancel.
  if (plan === 'launch' && ENTITLED_STATUSES.has(sub.status)) patch.launch_member = true;
  return patch;
}

/** The Supabase user id a subscription belongs to, from its metadata. Pure. */
function userIdOf(obj) {
  if (!obj) return null;
  return (obj.metadata && obj.metadata.user_id) || obj.client_reference_id || null;
}

async function readRow(supabase, userId) {
  const { data, error } = await supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function upsertRow(supabase, userId, patch) {
  const { error } = await supabase.from('subscriptions').upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
  if (error) throw error;
}

/**
 * Applies one verified Stripe event to the subscriptions table.
 * Returns what it did, for the stripe_events row and the tests.
 */
async function applyEvent(event, { supabase, stripe, env = process.env }) {
  const obj = event.data && event.data.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      if (obj.mode !== 'subscription' || !obj.subscription) return 'ignored';
      const userId = userIdOf(obj);
      if (!userId) return 'no_user';
      const sub = typeof obj.subscription === 'string'
        ? await stripe.subscriptions.retrieve(obj.subscription)
        : obj.subscription;
      await upsertRow(supabase, userId, { email: (obj.customer_details && obj.customer_details.email) || obj.customer_email || null, ...subscriptionPatch(sub, env) });
      return 'subscribed';
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      let userId = userIdOf(obj);
      if (!userId) {
        const { data } = await supabase.from('subscriptions').select('user_id').eq('stripe_subscription_id', obj.id).maybeSingle();
        userId = data ? data.user_id : null;
      }
      if (!userId) return 'no_user';
      await upsertRow(supabase, userId, subscriptionPatch(obj, env));
      return obj.status;
    }
    default:
      return 'ignored';
  }
}

module.exports = {
  TRIAL_DAYS,
  ENTITLED_STATUSES,
  getStripe,
  getSupabase,
  keyProblem,
  appUrl,
  launchSeats,
  choosePrice,
  planForPrice,
  entitlementFor,
  subscriptionPatch,
  userIdOf,
  readRow,
  upsertRow,
  applyEvent,
};
