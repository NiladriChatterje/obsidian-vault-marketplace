# Payments: Dodo Payments (merchant of record), with Razorpay for India

**Route is gone.** Splitting a buyer's payment out to a seller's linked account made this
platform a payment aggregator, which RBI gates behind an authorisation no individual can
hold — and Route linked accounts only exist for India and Malaysia anyway, so it could
never have paid a seller abroad.

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

## Razorpay, for India

Razorpay stays wired up as the domestic rail and is what every existing order was taken
on. Set `PAYMENT_PROVIDER=razorpay` to force it, or leave `DODO_API_KEY` unset. Route
config (`RAZORPAY_ROUTE`, linked categories) is gone; nothing splits a payment.

## Razorpay account activation

1. **Account & Settings → Business details** — finish KYC (PAN, address proof, bank account, video KYC). Live keys need a verified website too.
2. Add the site URL under the same section. Razorpay checks that it has working terms, refund/cancellation, privacy and contact pages — the site serves these at `/terms`, `/refunds`, `/privacy` and `/contact`, linked from the footer of every page. **Fill in `web/src/lib/legal.ts` first**: it starts with `TODO` placeholders for the legal name, address and support email, and a reviewer will reject the pages while those are showing.

## Razorpay API keys

**Account & Settings → API Keys** (under *Website and app settings*) → **Generate Key**, with the mode switch on **Live**. Copy into `.env`:

```
RAZORPAY_CLIENT_KEY=rzp_live_...
RAZORPAY_SECRET_KEY=...
RAZORPAY_MERCHANT_ID=...
```

The secret is shown once. Test keys stay valid; switch modes to keep both.

## Razorpay webhook

**Account & Settings → Webhooks** (under *Website and app settings*) → **Add New Webhook**.

| Field | Value |
| --- | --- |
| URL | `https://<api-domain>/webhooks/razorpay` |
| Secret | any strong string → paste into `RAZORPAY_WEBHOOK_SECRET` |
| Alert email | your ops address |
| Active events | `payment.captured`, `order.paid`, `payment.failed`, `refund.created`, `refund.processed` |

The server verifies the signature over the raw body and rejects anything else.

The server answers `refund.created` / `refund.processed` by marking the order refunded and revoking the buyer's `purchases` row. Nothing is reversed to anyone else: the platform is the seller, so a creator's royalty is settled with them like any other supplier credit.

## Deploy checklist

```
SERVER_API_URL=https://<api-domain>
EXPO_PUBLIC_API_URL=https://<api-domain>
ALLOWED_REDIRECT_ORIGINS=https://<site-domain>
EXPO_PUBLIC_PLATFORM_FEE_PERCENT=10
PAYMENT_PROVIDER=dodo
```

Apply migrations through `0008_dodo_merchant_of_record.sql` first: it drops the linked-account columns, makes `orders` provider-neutral and adds `dodo_products`. Every webhook returns 500 until it is in place, which makes the provider retry rather than lose the event.

Rebuild the web image after changing any `EXPO_PUBLIC_*` value; the server reads its own at runtime. Buy a cheap live vault once end to end and confirm the payment in the Dodo dashboard and the `purchases` row in Supabase.

## International payments

**Account & Settings → International payments** (under *Payment methods*) enables foreign cards, PayPal and bank transfers. Razorpay asks for PAN, GSTIN or Udyam, address proof and video KYC.

You do not need this for foreign buyers: Dodo is the merchant of record and already accepts them worldwide. Enabling it on Razorpay only matters if you want foreign cards on the *domestic* rail too, which is rarely worth the extra KYC.
