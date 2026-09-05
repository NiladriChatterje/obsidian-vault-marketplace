# Vault Market

A two-sided marketplace for Obsidian vaults, built with Expo (React Native) and TypeScript. Sellers upload a zipped vault, set a price, and get paid through Stripe Connect. Buyers browse by category, plugin and tag, buy or grab free vaults, and download them into Obsidian.

## Why this idea

- **Obsidian is huge and under-served.** Millions of users, a culture of sharing setups on YouTube and Reddit, and no dedicated store. Today creators sell vaults through Gumroad links buried in video descriptions.
- **Free vaults drive downloads.** Free listings are the top-of-funnel. Students and journalers install the app to grab a free starter vault, then discover paid systems.
- **Marketplace economics.** The platform takes a commission on every sale with no inventory and no content creation. Sellers bring their own audience, which markets the app for you.
- **Recurring demand.** Vaults get versioned. Buyers come back for updates and new releases from sellers they trust.

## Monetization

| Stream | How |
| --- | --- |
| Commission | 15% of every paid sale (`PLATFORM_FEE_PERCENT`), collected as a Stripe application fee. Sellers keep 85%. |
| Featured placement | The `featured` flag drives the home carousel. Sell slots to sellers weekly. |
| Seller Pro (future) | Analytics, coupons, early-access releases for a monthly fee. |

Fees are enforced server-side in `supabase/functions/create-checkout`, never in the client.

## App store note

Vaults are used in Obsidian, not inside this app, but Apple can still classify them as digital content and require In-App Purchase. Two safe options: keep purchases on the web (the app opens Stripe Checkout in a browser sheet, as it does now) and be ready to make iOS "browse and download only" if review asks, or route iOS purchases through StoreKit. Android is more permissive. Talk to review early.

## Running it

```bash
npm install --legacy-peer-deps
npx expo start
```

With no `.env`, the app runs in **demo mode**: 8 sample vaults, fake auth (any email works), and instant purchases stored on the device. Every screen is usable in Expo Go.

```bash
npm run typecheck   # tsc --noEmit
npx expo-doctor
```

## Going live

1. **Supabase project.** Create one, then apply the schema:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
   This creates `profiles`, `vaults`, `purchases`, `reviews`, the RPC helpers, row-level security, and two storage buckets (`vault-covers` public, `vault-files` private with 200 MB limit).
2. **App env.** Copy `.env.example` to `.env` and set the Supabase URL and anon key. Restart Expo.
3. **Stripe.** Enable Connect with Express accounts. Set secrets and deploy the functions:
   ```bash
   supabase secrets set --env-file supabase/functions/.env
   supabase functions deploy create-checkout
   supabase functions deploy connect-onboarding
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
   Point a Stripe webhook at the `stripe-webhook` function URL with events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `account.updated`.
4. **Deep links.** The scheme `vaultmarket://` is already configured. Stripe redirects to `vaultmarket://checkout-result` and `vaultmarket://sell` after checkout and onboarding.
5. **Assets.** Replace the placeholder icon and splash in `assets/`.

## How the money flows

1. Buyer taps Buy. The app calls `create-checkout`, which verifies the vault is published, the seller is onboarded, and the buyer does not already own it.
2. Stripe Checkout opens in an in-app browser. The session uses a destination charge: `transfer_data.destination` is the seller's account and `application_fee_amount` is our cut.
3. Stripe fires `checkout.session.completed`. The webhook inserts a `purchases` row with the service role key.
4. The app polls `has_vault_access` for a few seconds, then shows Download. Download URLs are signed and expire in 5 minutes. Storage policies only let owners and buyers read the file.

Free vaults skip Stripe: `claim_free_vault` inserts the purchase row directly and is guarded in SQL.

## Project layout

```
app/
  (tabs)/index.tsx       Explore: search, featured, categories, trending, free, new
  (tabs)/library.tsx     Everything the user owns, with download
  (tabs)/sell.tsx        Seller pitch, Stripe onboarding, dashboard, listings
  (tabs)/profile.tsx     Account, public profile, sign out
  browse.tsx             Search and filter results
  vault/[id].tsx         Listing detail, buy/get/download, reviews
  seller/[id].tsx        Public seller page
  sell/[id].tsx          Create or edit a listing (id = "new")
  auth.tsx               Sign in / sign up modal
  checkout-result.tsx    Deep-link target after Stripe Checkout
src/
  lib/api/types.ts       Backend interface the UI depends on
  lib/api/demo.ts        In-memory backend with seed data
  lib/api/supabase.ts    Production backend
  lib/config.ts          Env, fee percent, demo flag
  store/auth.tsx         Session + profile context
  components/            UI kit, vault cards
supabase/
  migrations/0001_init.sql
  functions/create-checkout, stripe-webhook, connect-onboarding
```

## Launch checklist

- Seller agreement and buyer license text (personal, non-transferable).
- Content moderation: a `reports` table and an admin flag to unlist a vault.
- Virus scan uploaded zips before publishing (Supabase storage webhook to a scanner).
- Email receipts via Stripe, update notifications when a seller ships a new version.
- Store keywords: obsidian vault, obsidian templates, second brain, zettelkasten, PKM, note templates.
