# Good But Not Greedy

A free "surprise bag" system for cafes to sell end-of-day surplus, in the spirit
of Too Good To Go but with no subscription, no marketplace lock-in, and the cafe keeps its own customers.

The tool is free for cafes. Optional online payments can run through Stripe Connect so customers can use Apple Pay, Google Pay or cards where available. Care Pack keeps a tiny 0.5% application fee from online payments only; PayID and in-store payments remain free.

One self-contained file (`index.html`), one Supabase project. Any number of cafes can sign up.

## How it works
- **Cafe owner** signs in with an email magic-link, gets a dashboard: build items (name, price,
  "worth" value, photo, description, quantity), set branding (name, colour, logo), payment details
  (PayID / bank), and their Instagram broadcast channel or WhatsApp group link. Sees live sales, payment screenshots, and stats.
- **Customer link**: each cafe gets a unique public page, `.../?c=<their-slug>`, shown as a copyable
  link + QR in the dashboard. Post it to Instagram or show the QR in-store. No app to install.
- **Customer** opens the link, reserves a bag (name + mobile), pays by **Apple Pay/card** if the cafe has connected Stripe, **PayID/bank transfer**
  (drops in a payment screenshot to confirm) or **in store**. Gets a pickup code. Bag count ticks
  down, sold-out locks, and they can self-release a bag they can't collect.

## Architecture
- Frontend: `index.html` (no build step). Supabase JS + qrcode from CDN.
- Backend: Supabase project `rescue-bags` (org DEMOS, separate from any other project).
  - `cafes` (one row per tenant = branding + settings, `owner_id` = auth user, unique `slug`)
  - `rescue_items` (per cafe, with `quantity` + `reserved_count`)
  - `rescue_reservations` (per cafe; PII visible only to the owning cafe via RLS)
  - RPCs (security-definer, so the public page never needs table write access):
    `reserve_bag` (atomic, no overselling), `attach_payment`, `release_bag`
  - Row-level security isolates every cafe; available items are the only public read.
  - Storage bucket `rescue-photos` for item photos, logos, and payment screenshots.
- Keys baked into `index.html` are the Supabase **publishable/anon** key (safe in a static page).

## Run locally
```bash
python3 -m http.server 8124
```
Owner dashboard: http://localhost:8124  ·  a cafe's page: http://localhost:8124/?c=little-fern

## Deploy (its own site)
Drag this folder onto Netlify (or `netlify deploy`). The dashboard is the site root; customer
pages are `yoursite/?c=<slug>`.

## Before real cafes use it (one-time setup, ~15 min)
1. **Email delivery**: Supabase's built-in email is rate-limited (a few/hour). For real sign-ups,
   add a free SMTP provider (e.g. Resend) under Supabase → Authentication → Emails → SMTP.
2. **Login redirect**: Supabase → Authentication → URL Configuration → set Site URL to your deployed
   domain and add it to Redirect URLs, so magic links land back on your site.
3. (Optional) Add Google / Apple login under Authentication → Providers.

## Optional online payments setup
Online payments are opt-in per cafe and require the Supabase migration plus Netlify environment variables.

1. Apply `supabase/migrations/20260829_stripe_connect_and_public_store.sql` in the rescue-bags Supabase project.
2. Add these env vars in Netlify, without committing secret values:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_PUBLISHABLE_KEY`
   - `STRIPE_WEBHOOK_SECRET`
3. In Stripe, enable Connect and add a webhook to `/.netlify/functions/stripe-webhook` for:
   - `account.updated`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
4. Verify the live domain for Apple Pay in Stripe.
5. Connect a cafe's Stripe Express account from Settings. Online payment buttons only appear after Stripe reports charges and payouts enabled.

## Timed drops
Each item has optional "Go live at" / "Close at" times. Set them and the item auto-appears at the
drop time and auto-hides after close, enforced in row-level security (no early peeking via the API),
and the customer page auto-refreshes every 30s so a page open before the drop reveals it on its own.
Leave them blank for an always-on item controlled by the "available" toggle.

## Daily use
Reuse a saved item each day: edit it, set today's quantity and (optionally) today's drop/close times,
make sure "available" is on. Post your customer link to your story and drop it in your Instagram broadcast channel or WhatsApp group.
