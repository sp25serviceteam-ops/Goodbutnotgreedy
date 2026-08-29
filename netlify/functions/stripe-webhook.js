const Stripe = require('stripe');
const { json, stripeClient, supabaseAdmin } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json(500, { error: 'Missing STRIPE_WEBHOOK_SECRET' });

  let stripe;
  let stripeEvent;
  try {
    stripe = stripeClient();
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : event.body;
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      event.headers['stripe-signature'] || event.headers['Stripe-Signature'],
      secret
    );
  } catch (err) {
    console.error('Webhook signature failed', err.message);
    return json(400, { error: 'Invalid webhook signature' });
  }

  try {
    const supabase = supabaseAdmin();
    const obj = stripeEvent.data.object;

    if (stripeEvent.type === 'account.updated') {
      const account = obj;
      await supabase.from('cafes').update({
        stripe_charges_enabled: !!account.charges_enabled,
        stripe_payouts_enabled: !!account.payouts_enabled,
        stripe_payments_enabled: !!(account.charges_enabled && account.payouts_enabled),
        stripe_onboarded_at: account.charges_enabled && account.payouts_enabled ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('stripe_account_id', account.id);
      return json(200, { received: true });
    }

    const reservationId = obj && obj.metadata && obj.metadata.reservation_id;
    if (!reservationId) return json(200, { received: true, ignored: true });

    if (stripeEvent.type === 'payment_intent.succeeded') {
      await supabase.from('rescue_reservations').update({
        status: 'paid',
        payment_method: 'stripe',
        stripe_payment_status: obj.status,
        updated_at: new Date().toISOString(),
      }).eq('id', reservationId);
    }

    if (stripeEvent.type === 'payment_intent.payment_failed' || stripeEvent.type === 'payment_intent.canceled') {
      await supabase.from('rescue_reservations').update({
        stripe_payment_status: obj.status,
        updated_at: new Date().toISOString(),
      }).eq('id', reservationId);
    }

    return json(200, { received: true });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Webhook handler failed' });
  }
};
