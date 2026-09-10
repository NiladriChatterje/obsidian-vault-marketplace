# Razorpay: going live with sub-merchants (Route)

Sellers set their own price; Razorpay Route splits each payment and sends them their share while the platform keeps `EXPO_PUBLIC_PLATFORM_FEE_PERCENT` (10%). Dashboard paths below match the current UI.

## 1. Activate the account

1. **Account & Settings → Business details** — finish KYC (PAN, address proof, bank account, video KYC). Live keys need a verified website too.
2. Add the site URL under the same section. Razorpay checks that it has working terms, refund/cancellation, privacy and contact pages — the site serves these at `/terms`, `/refunds`, `/privacy` and `/contact`, linked from the footer of every page. **Fill in `web/src/lib/legal.ts` first**: it starts with `TODO` placeholders for the legal name, address and support email, and a reviewer will reject the pages while those are showing.

## 2. Route: check eligibility first

Route is **not available on request any more.** Razorpay discontinued it on **1 January 2026** for accounts that did not meet new RBI-driven criteria. To hold or regain access a business must show:

- **Turnover** — domestic above ₹40 lakh, *or* export above ₹5 lakh, in FY25 or FY26.
- **Payer-payee transparency** — evidence that each linked account really supplies the goods the buyer pays for.

A new marketplace will not clear the turnover bar on day one. You can reapply in a later financial year once you do. Route is also **INR only**: Razorpay states *"Currently, we support only INR for Razorpay Route"*, so international currency orders can never carry transfers.

Left menu → **Route** (under **PAYMENT PRODUCTS**) shows your status and the reapply route.

**Check whether you have it:** with live keys set, `GET /health` reports `"route": true`, and `POST /v1/orders` with a `transfers` array stops returning `This transfer is not supported`. That error is what an ineligible account gets today.

**Until then, run with `RAZORPAY_ROUTE=off`** (see the last section). Do not block launch on Route.

## 3. API keys

**Account & Settings → API Keys** (under *Website and app settings*) → **Generate Key**, with the mode switch on **Live**. Copy into `.env`:

```
RAZORPAY_CLIENT_KEY=rzp_live_...
RAZORPAY_SECRET_KEY=...
RAZORPAY_MERCHANT_ID=...
```

The secret is shown once. Test keys stay valid; switch modes to keep both.

## 4. Webhook

**Account & Settings → Webhooks** (under *Website and app settings*) → **Add New Webhook**.

| Field | Value |
| --- | --- |
| URL | `https://<api-domain>/webhooks/razorpay` |
| Secret | any strong string → paste into `RAZORPAY_WEBHOOK_SECRET` |
| Alert email | your ops address |
| Active events | `payment.captured`, `order.paid`, `payment.failed`, `product.route.activated`, `product.route.under_review`, `product.route.needs_clarification` |

The server verifies the signature over the raw body and rejects anything else.

## 5. Sellers (linked accounts)

Sellers never touch the dashboard. They fill the payout form at `/sell/payouts`, and the server creates the linked account, stakeholder, Route product and settlement bank details. Razorpay reviews it asynchronously and then sends `product.route.activated`, which flips `payouts_enabled` to true and unlocks paid listings. **The `product.route.*` events above are required for this**: buyers' checkouts read that flag, so without the webhook a seller's vaults stay unbuyable until the seller themselves reopens `/sell`, which re-reads the status directly from Razorpay as a fallback.

Watch them under **Route → Accounts**. New accounts show `Pending` until Razorpay's penny-testing of the bank account passes. Linked-account settlements run on T+2 regardless of your own schedule.

To onboard someone manually instead: **Route → Accounts → + Add Account**, then complete the KYC form.

## 6. Deploy checklist

```
SERVER_API_URL=https://<api-domain>
EXPO_PUBLIC_API_URL=https://<api-domain>
ALLOWED_REDIRECT_ORIGINS=https://<site-domain>
EXPO_PUBLIC_PLATFORM_FEE_PERCENT=10
RAZORPAY_ROUTE=on
```

Rebuild the web image after changing any `EXPO_PUBLIC_*` value; the server reads its own at runtime. Buy a cheap live vault once end to end and confirm the payment, the purchase row and the transfer under **Route → Transfers**.

## Running without Route (the default for a new account)

Set `RAZORPAY_ROUTE=off`. Payments land wholly in the platform account, sellers can still list, and the dashboard still shows each seller's 90% net from the `purchases` table. You pay them yourself — bank transfer, or RazorpayX Payouts once volume justifies it. Switch the flag back on later without code changes.

**Settle the legal structure before you take money for other people.** RBI's payment aggregator rules are the reason Route is gated: collecting funds and redistributing them to third-party sellers is payment aggregation, which needs a licence or a licensed aggregator's marketplace product. The usual way a small platform stays outside that is to become the **merchant of record** — you license each vault from its creator and sell it as your own product, paying them a royalty as a supplier. That makes payouts vendor payments rather than third-party settlement, and it changes the seller agreement, the invoice, and how TDS under section 194-O and GST on the commission apply. Take this to a CA or lawyer before launch; it is not a code decision.

## International payments

**Account & Settings → International payments** (under *Payment methods*) enables foreign cards, PayPal and bank transfers. Razorpay asks for PAN, GSTIN or Udyam, address proof and video KYC.

**Route does not support international payments,** and is INR-only by design. Foreign-card sales can never be auto-split, so those sellers are paid manually whatever your Route status. If international sales become the larger half of the business, the usual answer is a second rail alongside Razorpay — an international gateway that settles to INR, or a merchant-of-record provider that becomes the seller abroad — rather than trying to make Route stretch.
