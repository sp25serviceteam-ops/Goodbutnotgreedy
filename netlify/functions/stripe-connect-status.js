const { json, ownerCafe, stripeClient } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  try {
    const { supabase, cafe } = await ownerCafe(event);
    let latest = cafe;

    if (cafe.stripe_account_id) {
      const stripe = stripeClient();
      const account = await stripe.accounts.retrieve(cafe.stripe_account_id);
      const patch = {
        stripe_charges_enabled: !!account.charges_enabled,
        stripe_payouts_enabled: !!account.payouts_enabled,
        stripe_onboarded_at: account.charges_enabled && account.payouts_enabled ? new Date().toISOString() : cafe.stripe_onboarded_at,
        stripe_payments_enabled: !!(account.charges_enabled && account.payouts_enabled),
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase.from('cafes').update(patch).eq('id', cafe.id).select('*').single();
      if (error) throw error;
      latest = data;
    }

    return json(200, {
      stripe_account_id: latest.stripe_account_id || null,
      charges_enabled: !!latest.stripe_charges_enabled,
      payouts_enabled: !!latest.stripe_payouts_enabled,
      payments_enabled: !!latest.stripe_payments_enabled,
    });
  } catch (err) {
    console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Could not load Stripe status' });
  }
};
