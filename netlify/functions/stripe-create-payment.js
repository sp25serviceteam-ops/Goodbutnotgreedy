const { json, platformFeeCents, publishableKey, stripeClient, supabaseAdmin } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const { reservation_id, pickup_code } = JSON.parse(event.body || '{}');
    if (!reservation_id || !pickup_code) return json(400, { error: 'Missing reservation details' });

    const supabase = supabaseAdmin();
    const { data: reservation, error: reservationError } = await supabase
      .from('rescue_reservations')
      .select('id,cafe_id,item_id,item_name,price,status,pickup_code,stripe_payment_intent_id')
      .eq('id', reservation_id)
      .eq('pickup_code', pickup_code)
      .maybeSingle();
    if (reservationError) throw reservationError;
    if (!reservation) return json(404, { error: 'Reservation not found' });
    if (reservation.status === 'cancelled') return json(400, { error: 'This reservation was cancelled' });
    if (reservation.status === 'paid' && reservation.stripe_payment_intent_id) return json(400, { error: 'This reservation is already paid' });

    const { data: cafe, error: cafeError } = await supabase
      .from('cafes')
      .select('id,shop_name,stripe_account_id,stripe_charges_enabled,stripe_payouts_enabled,stripe_payments_enabled')
      .eq('id', reservation.cafe_id)
      .single();
    if (cafeError) throw cafeError;
    if (!cafe.stripe_payments_enabled || !cafe.stripe_charges_enabled || !cafe.stripe_account_id) {
      return json(400, { error: 'Online payments are not ready for this cafe yet' });
    }

    const amount = Math.round(Number(reservation.price || 0) * 100);
    if (!amount || amount < 50) return json(400, { error: 'Invalid payment amount' });
    const fee = platformFeeCents(amount);
    const stripe = stripeClient();

    let intent;
    if (reservation.stripe_payment_intent_id) {
      intent = await stripe.paymentIntents.retrieve(reservation.stripe_payment_intent_id, { stripeAccount: cafe.stripe_account_id });
    } else {
      intent = await stripe.paymentIntents.create({
        amount,
        currency: 'aud',
        automatic_payment_methods: { enabled: true },
        application_fee_amount: fee,
        description: `${cafe.shop_name || 'Cafe'} - ${reservation.item_name || 'surplus bag'}`,
        metadata: {
          cafe_id: cafe.id,
          reservation_id: reservation.id,
          item_id: reservation.item_id || '',
          app: 'goodbutnotgreedy',
        },
      }, {
        stripeAccount: cafe.stripe_account_id,
        idempotencyKey: `goodbutnotgreedy-reservation-${reservation.id}`,
      });
      await supabase.from('rescue_reservations').update({
        stripe_payment_intent_id: intent.id,
        stripe_payment_status: intent.status,
        platform_fee_cents: fee,
        amount_cents: amount,
        payment_method: 'stripe',
        updated_at: new Date().toISOString(),
      }).eq('id', reservation.id);
    }

    return json(200, {
      client_secret: intent.client_secret,
      publishable_key: publishableKey(),
      stripe_account_id: cafe.stripe_account_id,
      amount_cents: amount,
      application_fee_cents: fee,
    });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message || 'Could not create payment' });
  }
};
