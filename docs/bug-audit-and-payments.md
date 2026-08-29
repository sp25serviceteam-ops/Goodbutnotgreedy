# Good But Not Greedy audit and payments notes

## Current state

Repo: `/Users/somberh/projects/goodbutnotgreedy`
Remote: `https://github.com/sp25serviceteam-ops/Goodbutnotgreedy.git`
App shape: one static `index.html` backed by Supabase project `hmihttoygvhhrjyudetn`.

## Live backend counts verified from the public API

The public Supabase key can safely confirm:

- Cafes: 17
- Rescue items: 8
- Reservations/orders: blocked by RLS from the public key, which is good for privacy

To get the real reservation/order count I need either:

1. a Supabase service role key for the `rescue-bags` project, put into a local `.env` file, not pasted into chat, or
2. access through the Supabase dashboard/API as the project owner.

I checked local env candidates without printing secrets. I found Supabase keys for the wholesale portal project, not a service key for this rescue-bags project.

## Bugs and risks found

### 1. Fixed: reserve button can double submit

In the customer payment step, both `PayID / bank transfer` and `Pay in store` called `reserve_bag` directly with no in-flight lock. A fast double tap could send two reserve RPC calls before the modal changed.

Fix applied:

- Added a `reserveInFlight` guard.
- Disabled all modal buttons immediately when a reserve starts.
- Shows a `Reserving` spinner before the RPC completes.
- Keeps the existing backend `reserve_bag` atomic stock check as the second layer of protection.

### 2. Fixed: Instagram or WhatsApp channel URL needed protocol validation

The channel URL was HTML-escaped before rendering, but any protocol could still be saved and rendered in an href.

Fix applied:

- Added `safeExternalUrl()`.
- Only `http` and `https` links are accepted.
- Settings now rejects invalid Instagram or WhatsApp links with a friendly toast.
- Rendered external links now use `rel="noopener"`.

### 3. Backend/RLS audit item: public API can enumerate cafe and item rows

The public key can list cafe rows and rescue item rows. Reservations are blocked, which is good.

What is exposed publicly:

- `cafes`: id, owner_id, slug, shop name, branding, PayID/bank presence, pickup window, Instagram or WhatsApp URL, timestamps.
- `rescue_items`: id, cafe_id, item name, price, description, photo URL, quantity, reserved_count, available flags and schedule fields.

This might be acceptable for a lightweight public customer page, but it does not match the README claim that public read is limited to available items only. Before putting real cafes on it, I would tighten this with a public read view or RPC that returns only the fields the customer page needs for one slug.

Recommended backend fix:

- Keep `cafes` and `rescue_items` private by default.
- Add a `get_public_store(slug)` RPC or public view that returns only:
  - cafe display fields needed for the storefront,
  - payment instructions needed after reserve,
  - currently live, non-archived, in-window items.
- Do not expose `owner_id` publicly.

### 4. Scale tidy item: sales and stats load all reservations for a cafe

Owner stats and sales currently query all matching rows client-side. That is fine at tiny volume, but should become paginated or server-side once real use starts.

Recommended follow-up:

- Sales tab: page the latest 50 or 100 reservations.
- Stats: use server-side counts/sums or a materialized summary if volume grows.

## Notifications

The app does not have real push notifications yet. Because this is currently a static site, the safe lightweight version is Instagram or WhatsApp led:

- cafe adds an Instagram broadcast channel or WhatsApp group link in Settings,
- customer sees the link after a successful reservation,
- copy tells them to join and turn notifications on.

Real browser push notifications would need:

- a service worker,
- stored push subscriptions,
- a backend function to send notifications,
- unsubscribe handling,
- careful permission timing so it does not feel spammy.

I would not build that before Stripe Connect. Instagram broadcast channels or WhatsApp are enough for the first cafe trial.

## Stripe Connect plan for this cafe tool

The repo now has the first Stripe Connect implementation staged behind per-cafe opt-in. The current product remains free and PayID/in-store still work if Stripe is not connected.

Implemented shape:

1. Cafe owner connects a Stripe Express account from Settings.
2. Customer reserves a bag.
3. If Stripe is enabled for that cafe, the customer can pay through Stripe Payment Element with Apple Pay/cards available where supported.
4. Server creates the PaymentIntent with:
   - amount from the reservation in Supabase,
   - currency `aud`,
   - direct charge scoped to the cafe's connected Stripe account,
   - `application_fee_amount` set to the Care Pack fee,
   - idempotency key tied to reservation id.
5. Webhook marks reservation paid only after Stripe confirms success.
6. Cafe receives payout through Stripe. Care Pack receives the platform fee.

Pricing decision implemented in code:

- 0.5% on online Stripe payments only.
- No fee on PayID or pay in store.
- No subscription for cafes.

Files added:

- `netlify/functions/stripe-connect-onboard.js`
- `netlify/functions/stripe-connect-status.js`
- `netlify/functions/stripe-create-payment.js`
- `netlify/functions/stripe-webhook.js`
- `netlify/functions/_shared.js`
- `supabase/migrations/20260829_stripe_connect_and_public_store.sql`
- `package.json`
- `scripts/check-js.js`

Provider setup still required before live use:

- Apply the Supabase migration.
- Set Netlify env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.
- Enable Stripe Connect.
- Add the Stripe webhook endpoint.
- Verify the live domain for Apple Pay.

Safety rule:

Do not remove PayID/in-store. Stripe stays opt-in per cafe.

## Verification run locally

Completed:

- JavaScript syntax extracted from `index.html` and checked with `node --check`.
- Static assertions confirmed the reserve lock exists, modal buttons disable before the RPC, and only one `reserve_bag` call site exists.
- Public Supabase API checked for cafe/item counts and reservation privacy.

Still needed before deploy:

- Real Supabase service-role order count.
- Manual smoke test in browser with a test cafe.
- If we add backend RLS fixes, test the public customer page and owner dashboard against real rows.
