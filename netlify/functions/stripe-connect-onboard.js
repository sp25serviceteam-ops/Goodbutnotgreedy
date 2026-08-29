const { json, ownerCafe, stripeClient } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const { supabase, user, cafe } = await ownerCafe(event);
    const stripe = stripeClient();
    const body = JSON.parse(event.body || '{}');
    const returnUrl = body.return_url || 'https://cafecarepackage.com/';

    let accountId = cafe.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'AU',
        email: user.email || undefined,
        business_profile: {
          name: cafe.shop_name || undefined,
          product_description: 'Cafe surplus bag payments',
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { cafe_id: cafe.id },
      });
      accountId = account.id;
      await supabase
        .from('cafes')
        .update({ stripe_account_id: accountId, updated_at: new Date().toISOString() })
        .eq('id', cafe.id);
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: returnUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return json(200, { url: link.url });
  } catch (err) {
    console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Could not start Stripe setup' });
  }
};
