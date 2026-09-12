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

## Refunds

Vault Market does not offer them. The whole vault is delivered on payment, so there is
nothing to return; the policy is stated at `/refunds`, in the terms, and next to the Buy
button before the buyer pays rather than only in a page they will not open.

**The refund webhook still has to work.** Not offering refunds is a policy, not a
guarantee: Dodo is the merchant of record and may refund at its own discretion, and a card
network can force one through a chargeback regardless. `refund.succeeded` marks the order
refunded and deletes the buyer's `purchases` row, so access goes back with the money and
the seller's balance is corrected. Remove that handler and a refunded buyer keeps the vault
while the ledger still shows the seller owed money that was returned.

**And a refund only costs the platform if that sale was already paid out**, which is what
the clearing window in `clearing.ts` prevents. A sale is not payable until the buyer can no
longer reverse it: 14 days for a buyer in the EU, the EEA or the UK, who has a statutory
right of withdrawal on digital goods whatever this site's policy says, and 3 days elsewhere.
An unknown buyer country gets the longer window. The buyer's country comes from the Dodo
payment's billing address, falling back to the card's issuing country, and is stored on the
purchase with the date it clears.

A seller therefore sees two numbers: **Awaiting payout**, which is cleared and payable, and
**Clearing**, which is earned but still reversible. Set the windows with
`HOLDBACK_DAYS_WITHDRAWAL` and `HOLDBACK_DAYS_DEFAULT`.

This does not cover a card chargeback, which can arrive months later, and nothing reasonable
would: holding every sale for the full chargeback window would mean paying sellers twice a
year. It covers the reversals that actually happen.

Keep the page itself too: providers check that a refund and cancellation policy exists
before activating an account.

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

**The commission is a percentage plus a fixed amount, and the percentage depends on where
the seller banks**: 8% + Rs 40 for a seller paid in India, 12% + Rs 40 for one paid abroad.
The seller keeps the rest of the list price.

The split is not arbitrary. Dodo charges the same either way, but the money still has to
reach the seller: a domestic payout is a near-free local transfer with nothing converted,
while reaching a seller abroad costs a transfer fee and a conversion spread. Charging one
blended rate would make Indian sellers subsidise international payouts. Set
`EXPO_PUBLIC_PLATFORM_COUNTRY` to whichever country counts as domestic.

| List | Indian seller keeps | Seller abroad keeps |
| ---: | ---: | ---: |
| Rs 149 | Rs 97 (65%) | Rs 91 (61%) |
| Rs 999 | Rs 879 (88%) | Rs 839 (84%) |
| Rs 2,499 | Rs 2,259 (90%) | Rs 2,159 (86%) |

Note the commission does not change what a **buyer** pays. The seller sets the price; the
commission only decides how it splits. `MIN_PRICE_CENTS` is what governs how cheap a vault
can be, and it is Rs 149.

The fixed half is the whole point. Dodo charges 4% + $0.40, and a commission that is only a
percentage is guaranteed to lose money below some price: the percentage shrinks with the
price, the provider's flat fee does not. At a flat 10% every sale under about Rs 587 cost
the platform money, and the minimum listing price was Rs 49. Matching the provider's shape
fixes it at the root:

```
kept = price x (commission% - provider%) / 100 + (commissionFixed - providerFixed)
     = price x 0.06 + Rs 5
```

Positive at every price, because each sale now carries its own processing cost instead of
being subsidised by larger ones.

| List | Seller gets | Seller's share | Platform keeps |
| ---: | ---: | ---: | ---: |
| Rs 199 | 139 | 70% | Rs 17 |
| Rs 499 | 409 | 82% | Rs 35 |
| Rs 999 | 859 | 86% | Rs 65 |
| Rs 2,499 | 2,209 | 88% | Rs 155 |

Sellers keep a **larger** share on expensive vaults than a flat 15% would give them, and the
platform is solvent on cheap ones. Free vaults never reach the provider, so they cost
nothing and are charged nothing.

`MIN_PRICE_CENTS` is Rs 199. It is a product choice now rather than a solvency one: at a
very low price the flat part is most of the sale and the seller is left with almost nothing.
`minPriceCents()` keeps the old derivation as a backstop, in case the commission is ever
configured so its fixed half no longer covers the provider's.

Both halves must cover the provider's or the platform loses money:
`EXPO_PUBLIC_PLATFORM_FEE_PERCENT` >= `EXPO_PUBLIC_PROVIDER_PERCENT_FEE`, and
`EXPO_PUBLIC_PLATFORM_FEE_FIXED_CENTS` >= `EXPO_PUBLIC_PROVIDER_FIXED_FEE_CENTS`. Revisit the
fixed ones if the rupee moves a long way against the dollar.

### When a seller is paid

Sending money costs a fixed fee per payout, while the commission is earned per sale. That is
the same shape mismatch the fixed half of the commission fixed one level down, so it gets the
same treatment: hold the balance until the sales behind it have earned enough to cover the
transfer.

The threshold is derived, not chosen. Per sale the platform keeps at least
`(fee% - provider%) / (100 - fee%)` of what the seller accrues, which is 4/92 at an 8%
commission against a 4% provider. So by the time a seller has accrued T, the platform has
earned at least T/15 whatever mix of prices got them there. Pay at 15x the transfer fee and
it is always covered; `PAYOUT_SAFETY_FACTOR` adds 35% on top.

| Seller | Route | Costs to send | Paid once they reach |
| --- | --- | ---: | ---: |
| India, bank | IMPS / NEFT | Rs 5 | Rs 500 |
| Anywhere, PayPal | PayPal | Rs 150 | Rs 3,100 |
| Anywhere, Wise or Payoneer | Wise / Payoneer | Rs 200 | Rs 4,100 |
| Outside India, bank | international wire | Rs 1,500 | Rs 30,400 |

An Indian seller is paid almost immediately because the transfer is nearly free. A seller
abroad who picks a plain bank wire waits a long time, which is deliberate: the payout form
says so, and Wise gets them paid roughly seven times sooner. The cost of the route falls on
whoever chooses it, in waiting rather than in a deduction.

`/admin/payouts` splits sellers into payable and accruing, and the CSV carries only the
payable ones. Adjust the estimates with `TRANSFER_COST_*` if your bank charges differently;
they are pessimistic on purpose, because guessing high only delays a payout while guessing
low loses money on it.

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
