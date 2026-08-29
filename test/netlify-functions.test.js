'use strict';
// Unit + integration tests for the Netlify Stripe Connect functions.
// External deps (stripe, @supabase/supabase-js) are stubbed via require.cache,
// so these run offline and prove the handler logic without live credentials.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const FUNC_DIR = path.join(ROOT, 'netlify', 'functions');
const STRIPE_PATH = require.resolve('stripe', { paths: [ROOT] });
const SUPABASE_PATH = require.resolve('@supabase/supabase-js', { paths: [ROOT] });

// ---- env for the function code ----
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'service-role-test';
process.env.STRIPE_SECRET_KEY = 'sk_test_123';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_456';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

function resetModuleCache() {
  for (const id of Object.keys(require.cache)) {
    if (id.startsWith(FUNC_DIR)) delete require.cache[id];
  }
}

function installMocks(state) {
  // fake supabase client
  function makeBuilder(table) {
    const b = {
      _table: table,
      _filters: [],
      select() { return b; },
      eq(k, v) { b._filters.push([k, v]); return b; },
      order() { return b; },
      maybeSingle() { return resolveRow(table, b._filters); },
      single() { return resolveRow(table, b._filters); },
      update(payload) {
        const ufilters = [];
        const u = {
          eq(k, v) { ufilters.push([k, v]); return u; },
          select() { return u; },
          single() {
            recordUpdate(table, payload, ufilters);
            return resolveUpdatedRow(table);
          },
          maybeSingle() {
            recordUpdate(table, payload, ufilters);
            return resolveUpdatedRow(table);
          },
          then(resolve) {
            recordUpdate(table, payload, ufilters);
            return Promise.resolve({ data: null, error: state.supabase.errors[table] || null }).then(resolve);
          },
        };
        return u;
      },
    };
    return b;
  }
  function resolveRow(table, filters) {
    if (state.supabase.errors[table]) return Promise.resolve({ data: null, error: state.supabase.errors[table] });
    return Promise.resolve({ data: state.supabase.rows[table] ?? null, error: null });
  }
  function resolveUpdatedRow(table) {
    if (state.supabase.errors[table]) return Promise.resolve({ data: null, error: state.supabase.errors[table] });
    return Promise.resolve({ data: state.supabase.rows[table] ?? null, error: null });
  }
  function recordUpdate(table, payload, filters) {
    state.supabase.updates.push({ table, payload, filters });
  }
  const supabaseClient = {
    from: makeBuilder,
    auth: {
      getUser: async () => ({ data: { user: { id: state.supabase.userId || 'u1', email: state.supabase.email || 'a@b.com' } }, error: null }),
      getSession: async () => ({ data: { session: state.supabase.session || null }, error: null }),
    },
    rpc: async () => ({ data: null, error: null }),
  };
  const fakeSupabase = { createClient: () => supabaseClient };

  // fake stripe client (constructed with `new Stripe(key, opts)`)
  function fakeStripe() {
    return {
      paymentIntents: {
        create: async (params, opts) => {
          state.stripe.createdIntents.push({ params, opts });
          if (state.stripe.createError) throw state.stripe.createError;
          return state.stripe.createResult;
        },
        retrieve: async (id) => {
          if (state.stripe.retrieveError) throw state.stripe.retrieveError;
          return state.stripe.retrieveResult;
        },
      },
      accounts: {
        create: async (params) => {
          state.stripe.createdAccounts.push(params);
          return state.stripe.accountCreateResult;
        },
        retrieve: async () => state.stripe.accountRetrieveResult,
      },
      accountLinks: {
        create: async (params) => {
          state.stripe.createdLinks.push(params);
          return state.stripe.linkCreateResult;
        },
      },
      webhooks: {
        constructEvent: () => {
          if (state.stripe.constructEventError) throw state.stripe.constructEventError;
          return state.stripe.constructEventResult;
        },
      },
    };
  }

  require.cache[STRIPE_PATH] = { id: STRIPE_PATH, filename: STRIPE_PATH, loaded: true, exports: fakeStripe };
  require.cache[SUPABASE_PATH] = { id: SUPABASE_PATH, filename: SUPABASE_PATH, loaded: true, exports: fakeSupabase };
}

function freshState() {
  return {
    supabase: { rows: {}, errors: {}, updates: [], userId: 'u1' },
    stripe: {
      createdIntents: [], createdAccounts: [], createdLinks: [],
      createResult: null, retrieveResult: null, constructEventResult: null, constructEventError: null,
    },
  };
}

function loadHandler(name, state) {
  resetModuleCache();
  installMocks(state);
  return require(path.join(FUNC_DIR, name + '.js'));
}

// ---------- _shared ----------
test('platformFeeCents is 0.5% with a 1c floor', () => {
  const { platformFeeCents } = require(path.join(FUNC_DIR, '_shared.js'));
  assert.strictEqual(platformFeeCents(1000), 5);      // $10 -> 5c
  assert.strictEqual(platformFeeCents(20000), 100);   // $200 -> 100c
  assert.strictEqual(platformFeeCents(100), 1);       // $1 -> rounds to 1c
  assert.strictEqual(platformFeeCents(0), 1);         // floor
  assert.strictEqual(platformFeeCents(undefined), 1); // floor
});

test('json() returns a JSON envelope', () => {
  const { json } = require(path.join(FUNC_DIR, '_shared.js'));
  const out = json(200, { ok: true });
  assert.strictEqual(out.statusCode, 200);
  assert.strictEqual(out.headers['Content-Type'], 'application/json');
  assert.deepStrictEqual(JSON.parse(out.body), { ok: true });
});

// ---------- stripe-create-payment ----------
test('create payment: rejects missing body', async () => {
  const state = freshState();
  const { handler } = loadHandler('stripe-create-payment', state);
  const res = await handler({ httpMethod: 'POST', body: '{}' });
  assert.strictEqual(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /Missing reservation/);
});

test('create payment: reservation not found -> 404', async () => {
  const state = freshState();
  state.supabase.rows['rescue_reservations'] = null;
  const { handler } = loadHandler('stripe-create-payment', state);
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ reservation_id: 'r1', pickup_code: 'ABC123' }) });
  assert.strictEqual(res.statusCode, 404);
});

test('create payment: cafe not ready -> 400', async () => {
  const state = freshState();
  state.supabase.rows['rescue_reservations'] = { id: 'r1', cafe_id: 'c1', item_name: 'Bag', price: 10, status: 'reserved', pickup_code: 'ABC123', stripe_payment_intent_id: null };
  state.supabase.rows['cafes'] = { id: 'c1', shop_name: 'Demo', stripe_account_id: null, stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_payments_enabled: false };
  const { handler } = loadHandler('stripe-create-payment', state);
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ reservation_id: 'r1', pickup_code: 'ABC123' }) });
  assert.strictEqual(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /not ready/);
});

test('create payment: happy path creates direct-charge intent with 0.5% fee and idempotency', async () => {
  const state = freshState();
  state.supabase.rows['rescue_reservations'] = { id: 'r1', cafe_id: 'c1', item_id: 'i1', item_name: 'Bag', price: 10, status: 'reserved', pickup_code: 'ABC123', stripe_payment_intent_id: null };
  state.supabase.rows['cafes'] = { id: 'c1', shop_name: 'Demo Cafe', stripe_account_id: 'acct_1', stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_payments_enabled: true };
  state.stripe.createResult = { id: 'pi_1', client_secret: 'pi_1_secret', status: 'requires_payment_method' };
  const { handler } = loadHandler('stripe-create-payment', state);

  const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ reservation_id: 'r1', pickup_code: 'ABC123' }) });
  assert.strictEqual(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.client_secret, 'pi_1_secret');
  assert.strictEqual(body.publishable_key, 'pk_test_456');
  assert.strictEqual(body.stripe_account_id, 'acct_1');
  assert.strictEqual(body.amount_cents, 1000);
  assert.strictEqual(body.application_fee_cents, 5);

  const intent = state.stripe.createdIntents[0];
  assert.strictEqual(intent.params.amount, 1000);
  assert.strictEqual(intent.params.currency, 'aud');
  assert.strictEqual(intent.params.application_fee_amount, 5);
  assert.strictEqual(intent.params.metadata.reservation_id, 'r1');
  assert.strictEqual(intent.opts.stripeAccount, 'acct_1');
  assert.match(intent.opts.idempotencyKey, /^goodbutnotgreedy-reservation-r1$/);

  // reservation recorded with intent id, fee, amount and stripe method
  const upd = state.supabase.updates.find((u) => u.table === 'rescue_reservations');
  assert.ok(upd, 'expected a reservation update');
  assert.strictEqual(upd.payload.stripe_payment_intent_id, 'pi_1');
  assert.strictEqual(upd.payload.platform_fee_cents, 5);
  assert.strictEqual(upd.payload.amount_cents, 1000);
  assert.strictEqual(upd.payload.payment_method, 'stripe');
});

// ---------- stripe-webhook ----------
test('webhook: missing secret -> 500', async () => {
  const saved = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  try {
    const state = freshState();
    const { handler } = loadHandler('stripe-webhook', state);
    const res = await handler({ httpMethod: 'POST', body: '{}', headers: {} });
    assert.strictEqual(res.statusCode, 500);
  } finally {
    process.env.STRIPE_WEBHOOK_SECRET = saved;
  }
});

test('webhook: bad signature -> 400', async () => {
  const state = freshState();
  state.stripe.constructEventError = new Error('signature mismatch');
  const { handler } = loadHandler('stripe-webhook', state);
  const res = await handler({ httpMethod: 'POST', body: '{}', headers: { 'stripe-signature': 'bad' } });
  assert.strictEqual(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /signature/i);
});

test('webhook: payment_intent.succeeded marks reservation paid', async () => {
  const state = freshState();
  state.stripe.constructEventResult = {
    type: 'payment_intent.succeeded',
    data: { object: { status: 'succeeded', metadata: { reservation_id: 'r9' } } },
  };
  const { handler } = loadHandler('stripe-webhook', state);
  const res = await handler({ httpMethod: 'POST', body: '{}', headers: { 'stripe-signature': 'ok' } });
  assert.strictEqual(res.statusCode, 200);
  const upd = state.supabase.updates.find((u) => u.table === 'rescue_reservations');
  assert.ok(upd);
  assert.strictEqual(upd.payload.status, 'paid');
  assert.strictEqual(upd.payload.payment_method, 'stripe');
  assert.deepStrictEqual(upd.filters, [['id', 'r9']]);
});

test('webhook: account.updated syncs cafe payout flags', async () => {
  const state = freshState();
  state.stripe.constructEventResult = {
    type: 'account.updated',
    data: { object: { id: 'acct_x', charges_enabled: true, payouts_enabled: false } },
  };
  const { handler } = loadHandler('stripe-webhook', state);
  const res = await handler({ httpMethod: 'POST', body: '{}', headers: { 'stripe-signature': 'ok' } });
  assert.strictEqual(res.statusCode, 200);
  const upd = state.supabase.updates.find((u) => u.table === 'cafes');
  assert.ok(upd);
  assert.strictEqual(upd.payload.stripe_charges_enabled, true);
  assert.strictEqual(upd.payload.stripe_payouts_enabled, false);
  assert.strictEqual(upd.payload.stripe_payments_enabled, false);
  assert.deepStrictEqual(upd.filters, [['stripe_account_id', 'acct_x']]);
});

// ---------- stripe-connect-onboard ----------
test('onboard: creates express account + link when cafe has no account', async () => {
  const state = freshState();
  state.supabase.rows['cafes'] = { id: 'c1', owner_id: 'u1', shop_name: 'Demo', stripe_account_id: null };
  state.stripe.accountCreateResult = { id: 'acct_new' };
  state.stripe.linkCreateResult = { url: 'https://connect.stripe.com/onboard/xyz' };
  const { handler } = loadHandler('stripe-connect-onboard', state);

  const res = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer token' },
    body: JSON.stringify({ return_url: 'https://site.com/' }),
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(JSON.parse(res.body).url, 'https://connect.stripe.com/onboard/xyz');
  const acct = state.stripe.createdAccounts[0];
  assert.strictEqual(acct.type, 'express');
  assert.strictEqual(acct.country, 'AU');
  assert.strictEqual(acct.capabilities.card_payments.requested, true);
  assert.strictEqual(acct.capabilities.transfers.requested, true);
  assert.strictEqual(acct.metadata.cafe_id, 'c1');
  assert.ok(state.stripe.createdLinks.length === 1);
  // account id persisted to cafe
  const upd = state.supabase.updates.find((u) => u.table === 'cafes');
  assert.strictEqual(upd.payload.stripe_account_id, 'acct_new');
});

test('onboard: unauthenticated -> 401', async () => {
  const state = freshState();
  const { handler } = loadHandler('stripe-connect-onboard', state);
  const res = await handler({ httpMethod: 'POST', body: '{}', headers: {} });
  assert.strictEqual(res.statusCode, 401);
});

// ---------- stripe-connect-status ----------
test('status: returns payments_enabled from cafe row', async () => {
  const state = freshState();
  state.supabase.rows['cafes'] = { id: 'c1', owner_id: 'u1', stripe_account_id: 'acct_1', stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_payments_enabled: true };
  state.stripe.accountRetrieveResult = { id: 'acct_1', charges_enabled: true, payouts_enabled: true };
  const { handler } = loadHandler('stripe-connect-status', state);
  const res = await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer token' } });
  assert.strictEqual(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.payments_enabled, true);
  assert.strictEqual(body.stripe_account_id, 'acct_1');
});
