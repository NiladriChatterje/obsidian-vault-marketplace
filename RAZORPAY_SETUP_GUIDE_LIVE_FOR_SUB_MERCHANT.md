# Razorpay: going live with sub-merchants (Route)

Sellers set their own price; Razorpay Route splits each payment and sends them their share while the platform keeps `EXPO_PUBLIC_PLATFORM_FEE_PERCENT` (10%). Dashboard paths below match the current UI.

## 1. Activate the account

1. **Account & Settings → Business details** — finish KYC (PAN, address proof, bank account, video KYC). Live keys need a verified website too.
2. Add the site URL under the same section. Razorpay checks that it has working terms, refund/cancellation, privacy and contact pages — the site serves these at `/terms`, `/refunds`, `/privacy` and `/contact`, linked from the footer of every page. **Fill in `web/src/lib/legal.ts` first**: it starts with `TODO` placeholders for the legal name, address and support email, and a reviewer will reject the pages while those are showing.

## 2. Turn on Route

1. Left menu → **Route** (under **PAYMENT PRODUCTS**) → request activation.
2. If it is not visible, ask support for Route and describe the model: *marketplace selling digital Obsidian vaults; sellers price their own listings; platform keeps 10% per sale*.
3. Route is India/Malaysia only and generally needs a registered business.

**Check it worked:** with live keys set, `GET /health` on the server reports `"route": true`, and `POST /v1/orders` with a `transfers` array stops returning `This transfer is not supported`.

## 3. API keys

**Account & Settings → API Keys** (under *Website and app settings*) → **Generate Key**, with the mode switch on **Live**. Copy into `.env`:

```
RAZORPAY_CLIENT_KEY=rzp_live_...
RAZORPAY_SECRET_KEY=...
MERCHANT_ID=...
```

The secret is shown once. Test keys stay valid; switch modes to keep both.

## 4. Webhook

**Account & Settings → Webhooks** (under *Website and app settings*) → **Add New Webhook**.

| Field | Value |
| --- | --- |
| URL | `https://<api-domain>/webhooks/razorpay` |
| Secret | any strong string → paste into `RAZORPAY_WEBHOOK_SECRET` |
| Alert email | your ops address |
| Active events | `payment.captured`, `order.paid`, `payment.failed` |

The server verifies the signature over the raw body and rejects anything else.

## 5. Sellers (linked accounts)

Sellers never touch the dashboard. They fill the payout form at `/sell/payouts`, and the server creates the linked account, stakeholder, Route product and settlement bank details. Razorpay reviews it, then `payouts_enabled` flips to true and paid listings unlock.

Watch them under **Route → Accounts**. New accounts show `Pending` until Razorpay's penny-testing of the bank account passes. Linked-account settlements run on T+2 regardless of your own schedule.

To onboard someone manually instead: **Route → Accounts → + Add Account**, then complete the KYC form.

## 6. Deploy checklist

```
EXPO_PUBLIC_API_URL=https://<api-domain>
ALLOWED_REDIRECT_ORIGINS=https://<site-domain>
EXPO_PUBLIC_PLATFORM_FEE_PERCENT=10
RAZORPAY_ROUTE=on
```

Rebuild the web image after changing any `EXPO_PUBLIC_*` value; the server reads its own at runtime. Buy a cheap live vault once end to end and confirm the payment, the purchase row and the transfer under **Route → Transfers**.

## Before Route is approved

Set `RAZORPAY_ROUTE=off`. Payments land wholly in the platform account, sellers can still list and the dashboard still shows their 90% net, but you pay them out yourself. Switch it back on later without code changes.

## International payments

**Account & Settings → International payments** (under *Payment methods*) enables foreign cards, PayPal and bank transfers. Razorpay asks for PAN, GSTIN or Udyam, address proof and video KYC.

**Route does not support international payments.** With both enabled, foreign card payments cannot be auto-split, so those sellers must be paid manually (or keep international sales on free/platform-owned listings until Razorpay's support changes).
