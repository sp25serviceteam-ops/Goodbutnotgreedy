-- Good But Not Greedy: optional Stripe Connect payments and safer public storefront RPC.
-- Apply this in the Supabase project hmihttoygvhhrjyudetn before enabling online payments.

begin;

alter table public.cafes
  add column if not exists channel_url text,
  add column if not exists stripe_account_id text unique,
  add column if not exists stripe_onboarded_at timestamptz,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_payments_enabled boolean not null default false;

-- Keep the existing app working. The old column stores either Instagram or WhatsApp for now.
update public.cafes
set channel_url = whatsapp_url
where channel_url is null and whatsapp_url is not null;

alter table public.rescue_reservations
  add column if not exists stripe_payment_intent_id text unique,
  add column if not exists stripe_payment_status text,
  add column if not exists platform_fee_cents integer,
  add column if not exists amount_cents integer;

create index if not exists idx_cafes_stripe_account_id
  on public.cafes(stripe_account_id)
  where stripe_account_id is not null;

create index if not exists idx_rescue_reservations_stripe_payment_intent_id
  on public.rescue_reservations(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- If payment_method is constrained, allow the new online Stripe value.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.rescue_reservations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%payment_method%'
  loop
    execute format('alter table public.rescue_reservations drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.rescue_reservations
  add constraint rescue_reservations_payment_method_check
  check (payment_method is null or payment_method in ('payid', 'instore', 'stripe'));

create or replace function public.get_public_store(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  items jsonb;
begin
  select
    id,
    slug,
    shop_name,
    brand_color,
    logo_url,
    payid,
    bank_details,
    pickup_window,
    coalesce(channel_url, whatsapp_url) as whatsapp_url,
    stripe_account_id,
    stripe_charges_enabled,
    stripe_payouts_enabled,
    stripe_payments_enabled
  into c
  from public.cafes
  where slug = p_slug
  limit 1;

  if not found then
    return jsonb_build_object('cafe', null, 'items', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'name', i.name,
    'price', i.price,
    'description', i.description,
    'photo_url', i.photo_url,
    'quantity', i.quantity,
    'reserved_count', i.reserved_count,
    'original_value', i.original_value,
    'pickup_window', i.pickup_window,
    'available_from', i.available_from,
    'available_until', i.available_until
  ) order by i.created_at desc), '[]'::jsonb)
  into items
  from public.rescue_items i
  where i.cafe_id = c.id
    and i.available = true
    and coalesce(i.archived, false) = false
    and (i.available_from is null or i.available_from <= now())
    and (i.available_until is null or i.available_until >= now());

  return jsonb_build_object(
    'cafe', jsonb_build_object(
      'id', c.id,
      'slug', c.slug,
      'shop_name', c.shop_name,
      'brand_color', c.brand_color,
      'logo_url', c.logo_url,
      'payid', c.payid,
      'bank_details', c.bank_details,
      'pickup_window', c.pickup_window,
      'whatsapp_url', c.whatsapp_url,
      'stripe_account_id', c.stripe_account_id,
      'stripe_charges_enabled', c.stripe_charges_enabled,
      'stripe_payouts_enabled', c.stripe_payouts_enabled,
      'stripe_payments_enabled', c.stripe_payments_enabled
    ),
    'items', items
  );
end;
$$;

grant execute on function public.get_public_store(text) to anon, authenticated;

commit;
