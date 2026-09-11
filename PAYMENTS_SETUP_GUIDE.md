# Payments: Dodo Payments (merchant of record)

**Razorpay is gone entirely**, Route with it. Splitting a buyer's payment out to a seller's
linked account made this platform a payment aggregator, which RBI gates behind an
authorisation no individual can hold — and Route linked accounts only exist for India and
Malaysia anyway, so it could never have paid a seller abroad. Dodo accepts Indian methods
(UPI, RuPay, cards) as well as everywhere else, so a second domestic rail earned nothing but
its own maintenance.

The model instead: **Vault Market is the seller of record.** Dodo Payments is the merchant
of record on top of that — it is the legal seller to the buyer, takes payment in 150+
countries, registers and remits VAT and sales tax everywhere, carries chargebacks, and
settles the net to our bank as an inward remittance for export of services. Creators are
suppliers paid a royalty outside the checkout, which is an ordinary vendor payment rather
than third-party settlement.

## Dodo setup

1. **Dashboard → Developer → API Keys** → create a read-write key → `DODO_API_KEY`.
2. **Dashboard → Developer → Webhooks** → add `https://<api-domain>/webhooks/dodo`,
   subscribe to `payment.succeeded`, `payment.failed` and `refund.succeeded`, and put the
   signing secret in `DODO_WEBHOOK_SECRET`.
3. `DODO_ENVIRONMENT=live` when you are ready; anything else stays on the test host.

Products are created for you: the first checkout for a vault creates a Dodo product and
caches it in `public.dodo_products`, and a price change re-pushes to the same product so a
listing and its Dodo product cannot drift.

**Fulfilment is webhook-only.** The buyer's redirect back to `/checkout-result` is a
navigation they can close or replay, so it grants nothing; `payment.succeeded` does.

### Before you build on it

Ask Dodo two things in writing, because both can block this path:

- **Do they onboard an individual or sole proprietor**, or do they require a registered
  business? This is the same wall Stripe India puts up.
- **Which payout method reaches India.** INR-denominated payouts are discontinued, so you
  settle through a USD/GBP/EUR wallet and your own bank converts — that FX spread, not
  Dodo's 4%, is the largest cost. Payouts run twice a month once the balance clears $50.

### Tax, briefly

Dodo handles every foreign tax. In India, GST registration is not required below ₹20 lakh
aggregate turnover in a financial year (Notification 10/2017–IGST covers exports too);
above it, register and file an annual LUT so exports stay zero-rated. Income tax on the
profit is the only thing due below that threshold. Not legal advice — talk to a CA before
launch, especially about how you pay creators abroad.

## Paying sellers

Dodo has no sub-merchant concept. `client.payouts` exposes only `list()`, and every payout
carries your own `business_id`, so Dodo settles one amount to the platform and never pays a
seller. Paying creators is the platform's own job.

So each seller records where their share goes at `/sell/payouts`: country, currency, method
(bank, Wise, Payoneer or PayPal), account holder name and the account itself. It is held in
`public.seller_payouts`, which is owner-only under RLS and deliberately not on
`public.profiles`, because that table is world readable.

**A paid vault cannot be published, or bought, without it.** The server refuses on three
paths: saving a listing as published, flipping an existing listing to published, and
checkout itself. The last is the one that matters, since a seller could go live and have
their details removed afterwards, and taking money that cannot be passed on is worse than
refusing the sale. Free vaults are unaffected.

The currency is checked against Dodo's ISO 4217 payout list in
`server/src/payout-currencies.ts`. A seller whose currency is not on it is told so at the
form rather than after someone has bought from them.

## Actually paying them

Nothing splits a payment. Dodo settles every sale to the platform in full, so a seller's
share is a debt the platform carries until it transfers the money itself.

**The seller's share is 90% of the list price** at a 10% commission, so the payment
provider's fee comes entirely out of the platform's share. That has a sharp edge: Dodo's
fixed $0.40 per sale does not shrink with the price, so below a certain price every sale
costs the platform money.

That threshold is now derived rather than guessed:

```
kept = price x (commission - provider%) / 100 - providerFixed
```

which is zero at `providerFixed x 100 / (commission - provider%)`. `minPriceCents()` in
`server/src/config.ts` adds 20% of headroom, rounds up to a round Rs 50 and refuses any
paid listing below it. `web/src/lib/config.ts` mirrors it so the seller sees the same
number. Change `EXPO_PUBLIC_PLATFORM_FEE_PERCENT` and the floor follows:

| Commission | Break-even | Minimum price | Platform keeps on a Rs 2,499 sale |
| ---: | ---: | ---: | ---: |
| 8% | Rs 1,000 | Rs 1,200 | Rs 60 |
| 10% | Rs 667 | Rs 800 | Rs 110 |
| **15% (current)** | **Rs 364** | **Rs 450** | **Rs 235** |
| 20% | Rs 250 | Rs 300 | Rs 360 |

The commission was 10% with a Rs 49 floor, which lost Rs 32 on every sale at that floor.
It is 15% with a Rs 450 floor. Free vaults are unaffected: they never reach checkout, so
they cost nothing to give away, which is what makes them the top of the funnel.

`EXPO_PUBLIC_PROVIDER_PERCENT_FEE` and `EXPO_PUBLIC_PROVIDER_FIXED_FEE_CENTS` describe the
provider and default to Dodo's 4% and Rs 40, the latter being $0.40 with headroom over the
exchange rate. Revisit the fixed one if the rupee moves a long way.

The ledger is at `/admin/payouts`, gated on `ADMIN_USER_IDS` (a comma-separated list of
Supabase user ids; unset closes the routes rather than opening them):

```bash
curl -H "Authorization: Bearer <your supabase token>" https://<api>/admin/payouts
curl -H "Authorization: Bearer <token>" https://<api>/admin/payouts.csv -o payouts.csv
curl -X POST https://<api>/admin/payouts -H "Authorization: Bearer <token>"   -H 'Content-Type: application/json'   -d '{"sellerId":"<uuid>","amountCents":449820,"reference":"wise-123"}'
```

The CSV carries one row per seller with an outstanding balance and full account details,
ready for a batch transfer. Record the payment afterwards; `POST /admin/payouts` only
writes down a transfer that already happened, it never sends one.

A refund deletes the purchase, so the debt goes with it. If that seller was already paid,
their balance goes negative and carries against their next sale rather than being written
off.

## Deploy checklist

```
SERVER_API_URL=https://<api-domain>
EXPO_PUBLIC_API_URL=https://<api-domain>
ALLOWED_REDIRECT_ORIGINS=https://<site-domain>
EXPO_PUBLIC_PLATFORM_FEE_PERCENT=10
DODO_API_KEY=...
DODO_WEBHOOK_SECRET=...
DODO_ENVIRONMENT=live
```

Apply migrations through `0009_drop_razorpay.sql` first. Every webhook returns 500 until
the schema is in place, which makes Dodo retry rather than lose the event.

Rebuild the web image after changing any `EXPO_PUBLIC_*` value; the server reads its own at
runtime. Buy a cheap live vault once end to end and confirm the payment in the Dodo
dashboard and the `purchases` row in Supabase.

## The legal pages

Dodo's activation review checks that the site has working terms, refund/cancellation,
privacy and contact pages. They are served at `/terms`, `/refunds`, `/privacy` and
`/contact` and linked from every footer. **Fill in `web/src/lib/legal.ts` first** — it
starts with `TODO` placeholders for the legal name, address and support email, and a
reviewer will reject the pages while those are showing.
