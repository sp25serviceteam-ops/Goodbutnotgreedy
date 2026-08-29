const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hmihttoygvhhrjyudetn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function requireValues(values) {
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);
}

function supabaseAdmin() {
  requireValues({ SUPABASE_URL, SUPABASE_SERVICE_KEY });
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

function stripeClient() {
  requireValues({ STRIPE_SECRET_KEY });
  return new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
}

function publishableKey() {
  requireValues({ STRIPE_PUBLISHABLE_KEY });
  return STRIPE_PUBLISHABLE_KEY;
}

function bearerToken(event) {
  const h = event.headers.authorization || event.headers.Authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : '';
}

async function ownerCafe(event) {
  const token = bearerToken(event);
  if (!token) throw Object.assign(new Error('Sign in first'), { statusCode: 401 });
  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) throw Object.assign(new Error('Invalid session'), { statusCode: 401 });
  const { data: cafe, error: cafeError } = await supabase
    .from('cafes')
    .select('*')
    .eq('owner_id', userData.user.id)
    .maybeSingle();
  if (cafeError) throw cafeError;
  if (!cafe) throw Object.assign(new Error('Cafe not found'), { statusCode: 404 });
  return { supabase, user: userData.user, cafe };
}

function platformFeeCents(amountCents) {
  return Math.max(1, Math.round(Number(amountCents || 0) * 0.005));
}

module.exports = {
  json,
  ownerCafe,
  platformFeeCents,
  publishableKey,
  stripeClient,
  supabaseAdmin,
};
