// Billing endpoints (owner 2026-10-14). Stripe Checkout for the one
// plan, the Stripe customer portal for cancel and card changes, the
// signed in user's access, and the Stripe webhook that writes the
// subscriptions table. Stripe hosts every card field, so no card
// number ever reaches this server.
//
//   GET  /api/billing/status    access, plan and whether launch seats remain
//   POST /api/billing/checkout  { interval: month or year }, answers { url }
//   POST /api/billing/portal    { url } of the Stripe customer portal
//   POST /api/stripe/webhook    raw body, signature checked

const billing = require('../lib/services/billing.js');
const { resolveViewer, forgetViewers, paywallOn } = require('../lib/services/paywall.js');
const { logger } = require('../shared/logger');

async function requireViewer(req, res) {
  const viewer = await resolveViewer(req);
  if (!viewer.user) { res.status(401).json({ error: 'Sign in first' }); return null; }
  return viewer;
}

async function seatsTaken(supabase) {
  const { data, error } = await supabase.rpc('launch_seats_taken');
  if (error) throw error;
  return Number(data || 0);
}

async function status(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const supabase = billing.getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
  try {
    const viewer = await resolveViewer(req);
    const taken = await seatsTaken(supabase).catch(() => null);
    const cap = billing.launchSeats();
    const launchMember = Boolean(viewer.row && viewer.row.launch_member);
    const offer = billing.choosePrice({ launchMember, seatsTaken: taken });
    const yearly = billing.choosePrice({ launchMember, seatsTaken: taken, interval: 'year' });
    res.json({
      signedIn: Boolean(viewer.user),
      paywall: paywallOn(),
      billingReady: !billing.keyProblem() && Boolean(offer.priceId),
      yearlyReady: !billing.keyProblem() && Boolean(yearly.priceId) && yearly.plan === offer.plan,
      launchEnds: new Date(billing.launchEnds()).toISOString(),
      access: viewer.entitlement,
      launchMember: Boolean(viewer.row && viewer.row.launch_member),
      hasBilling: Boolean(viewer.row && viewer.row.stripe_customer_id),
      offer: offer.plan,
      launchSeatsLeft: taken == null ? null : Math.max(0, cap - taken),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function checkout(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const stripe = billing.getStripe();
  const supabase = billing.getSupabase();
  if (!stripe || !supabase) return res.status(503).json({ error: 'Billing is not set up yet' });
  try {
    const viewer = await requireViewer(req, res);
    if (!viewer) return;
    const row = viewer.row;
    if (row && billing.ENTITLED_STATUSES.has(row.status)) {
      return res.status(409).json({ error: 'You already have Pro', manage: true });
    }
    const interval = req.body && req.body.interval === 'year' ? 'year' : 'month';
    const offer = billing.choosePrice({ launchMember: Boolean(row && row.launch_member), seatsTaken: await seatsTaken(supabase), interval });
    if (!offer.priceId) return res.status(503).json({ error: 'Billing is not set up yet' });

    // One Stripe customer per user, kept on the row for the portal.
    let customer = row && row.stripe_customer_id;
    if (!customer) {
      const c = await stripe.customers.create({ email: viewer.user.email, metadata: { user_id: viewer.user.id } });
      customer = c.id;
      await billing.upsertRow(supabase, viewer.user.id, { email: viewer.user.email, stripe_customer_id: customer, updated_at: new Date().toISOString() });
    }
    const base = billing.appUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: viewer.user.id,
      line_items: [{ price: offer.priceId, quantity: 1 }],
      subscription_data: { metadata: { user_id: viewer.user.id, plan: offer.plan, interval } },
      metadata: { user_id: viewer.user.id, plan: offer.plan, interval },
      allow_promotion_codes: true,
      success_url: `${base}/#/account?checkout=done`,
      cancel_url: `${base}/#/account?checkout=cancelled`,
    });
    res.json({ url: session.url, plan: offer.plan, interval });
  } catch (err) {
    logger.error('Checkout failed', { error: err.message });
    res.status(500).json({ error: 'Checkout failed, try again' });
  }
}

async function portal(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const stripe = billing.getStripe();
  if (!stripe) return res.status(503).json({ error: 'Billing is not set up yet' });
  try {
    const viewer = await requireViewer(req, res);
    if (!viewer) return;
    const customer = viewer.row && viewer.row.stripe_customer_id;
    if (!customer) return res.status(404).json({ error: 'No billing on this account yet' });
    const session = await stripe.billingPortal.sessions.create({ customer, return_url: `${billing.appUrl()}/#/account` });
    res.json({ url: session.url });
  } catch (err) {
    logger.error('Portal failed', { error: err.message });
    res.status(500).json({ error: 'Could not open billing, try again' });
  }
}

/**
 * The Stripe webhook. Mounted with express.raw before express.json so
 * the signature is checked against the exact bytes Stripe sent. Each
 * event id is recorded once, so a Stripe retry is a no op.
 */
async function webhook(req, res) {
  const stripe = billing.getStripe();
  const supabase = billing.getSupabase();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !supabase || !secret) return res.status(503).send('Billing is not set up');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch {
    return res.status(400).send('Bad signature');
  }
  try {
    const { data: seen } = await supabase.from('stripe_events').select('id, processed_at').eq('id', event.id).maybeSingle();
    if (seen && seen.processed_at) return res.json({ received: true, duplicate: true });
    if (!seen) await supabase.from('stripe_events').insert({ id: event.id, type: event.type });
    const result = await billing.applyEvent(event, { supabase, stripe });
    await supabase.from('stripe_events').update({ processed_at: new Date().toISOString(), error: null }).eq('id', event.id);
    forgetViewers();
    res.json({ received: true, result });
  } catch (err) {
    logger.error('Stripe webhook failed', { type: event.type, error: err.message });
    await supabase.from('stripe_events').update({ error: String(err.message).slice(0, 500) }).eq('id', event.id);
    // A 500 makes Stripe retry the event later.
    res.status(500).send('Webhook failed');
  }
}

module.exports = { status, checkout, portal, webhook };
