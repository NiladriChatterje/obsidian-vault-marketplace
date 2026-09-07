# Vault Market

A two-sided marketplace for Obsidian vaults, built with Expo (React Native) and TypeScript. Sellers upload a zipped vault, set a price in INR, and get paid through Razorpay Route. Buyers browse by category, plugin and tag, buy or grab free vaults, and download them into Obsidian.

## Why this idea

- **Obsidian is huge and under-served.** Millions of users, a culture of sharing setups on YouTube and Reddit, and no dedicated store. Today creators sell vaults through Gumroad links buried in video descriptions.
- **Free vaults drive downloads.** Free listings are the top-of-funnel. Students and journalers install the app to grab a free starter vault, then discover paid systems.
- **Marketplace economics.** The platform takes a commission on every sale with no inventory and no content creation. Sellers bring their own audience, which markets the app for you.
- **Recurring demand.** Vaults get versioned. Buyers come back for updates and new releases from sellers they trust.

## Monetization

| Stream | How |
| --- | --- |
| Commission | 15% of every paid sale (`PLATFORM_FEE_PERCENT`), kept back when the seller's share is transferred via Razorpay Route. Sellers keep 85%. |
| Featured placement | The `featured` flag drives the home carousel. Sell slots to sellers weekly. |
| Seller Pro (future) | Analytics, coupons, early-access releases for a monthly fee. |

Fees are enforced server-side in `server/` (the Fastify payment service), never in the client.

## App store note

Vaults are used in Obsidian, not inside this app, but Apple can still classify them as digital content and require In-App Purchase. Two safe options: keep purchases on the web (the app opens the server's Razorpay checkout page in a browser sheet, as it does now) and be ready to make iOS "browse and download only" if review asks, or route iOS purchases through StoreKit. Android is more permissive. Talk to review early.

## Running it

```bash
npm install --legacy-peer-deps
npx expo start
```

With the Supabase keys empty in `.env`, the app runs in **demo mode**: 8 sample vaults, fake auth (any email works), and instant purchases stored on the device. Every screen is usable in Expo Go. If the payment server is running (below), tapping Buy in demo mode still opens a real Razorpay **test** checkout so the flow can be tried end to end.

## Payment server (Fastify)

`server/` is a small Node service that owns everything needing the Razorpay secret. The app and the site call it with the buyer's Supabase token.

| Route | What it does |
| --- | --- |
| `POST /checkout` | Validates the vault and buyer, creates a Razorpay **Order** (with a Route transfer to the seller), stores it in `orders`, returns the hosted checkout URL. |
| `GET /checkout/:orderId` | Hosted page that opens Razorpay Checkout.js for that order. Works in a browser sheet on mobile, so no native SDK is needed. |
| `POST /checkout/:orderId/callback` | Checkout.js posts `razorpay_payment_id` + `razorpay_signature` here. The server verifies HMAC(order_id\|payment_id), fetches the payment, captures it if needed, checks the amount, records the purchase and transfer id, then redirects to `/checkout-result`. |
| `GET /checkout/:orderId/status` | Order status for polling. |
| `POST /webhooks/razorpay` | Verifies `X-Razorpay-Signature` over the raw body and settles or fails the order (`payment.captured`, `order.paid`, `payment.failed`). Idempotent with the callback. |
| `POST /payouts`, `GET /payouts/status` | Seller onboarding to Razorpay Route (linked account, stakeholder, product, bank details) and activation sync. |

```bash
cd server
npm install
npm run dev        # http://localhost:4000, reads the repo-root .env
curl localhost:4000/health
```

Runs on plain Node 22.18+ (TypeScript type stripping, no build step). Without Supabase keys it runs in demo mode: orders are kept in memory and purchases are granted by the client.

```bash
npm run typecheck   # tsc --noEmit
npx expo-doctor
```

## Website (Next.js)

`web/` is the same marketplace as a website: sellers list vaults at their price, buyers pay through Razorpay Checkout (via the payment server), then download the zip or connect the vault to an AI assistant over MCP. It reuses the app's data layer (`src/lib`, `src/store`, `src/types`) directly; four tiny shims in `web/shims/` stand in for the React Native modules that layer touches, wired up in `web/next.config.ts`.

```bash
cd web
npm install
npm run dev        # http://localhost:3000, demo mode until the repo-root .env has Supabase keys
npm run build
```

The site reads the repo-root `.env`. Two extra keys matter for it:

| Key | Purpose |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Lets `web/app/api/mcp` resolve access tokens and stream vault zips. |
| `EXPO_PUBLIC_REDIRECT_ORIGIN` | Optional. Where the payment server sends buyers back (defaults to the browser origin). Also list it in `ALLOWED_REDIRECT_ORIGINS`. |
| `EXPO_PUBLIC_API_URL` | Base URL of the payment server (`server/`). |

### MCP access

Every buyer gets a personal token at `/connect` (only its SHA-256 hash is stored, table `mcp_tokens`, migration `0002`). Point any Model Context Protocol client at `https://<site>/api/mcp` with `Authorization: Bearer <token>`:

```bash
claude mcp add --transport http vault-market https://<site>/api/mcp --header "Authorization: Bearer vm_..."
```

Tools: `list_vaults`, `list_notes`, `read_note`, `search_notes`. The server unzips the purchased vault in memory (text files only) and caches it per process. In demo mode the endpoint accepts `vm_demo_token` and serves synthetic notes for the sample vaults.

## Going live

1. **Supabase project.** Create one, then apply the schema:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
   This creates `profiles`, `vaults`, `purchases`, `reviews`, the RPC helpers, row-level security, and two storage buckets (`vault-covers` public, `vault-files` private with 200 MB limit).
2. **App env.** Copy `.env.example` to `.env` and set the Supabase URL and anon key. Restart Expo.
3. **Razorpay.** Create a Razorpay account (KYC as an individual or business), ask support to enable **Route** on it, and put the key id / secret from Settings → API Keys into `.env` (`RAZORPAY_CLIENT_KEY`, `RAZORPAY_SECRET_KEY`, `MERCHANT_ID`). Deploy `server/` somewhere public (any Node host), set `EXPO_PUBLIC_API_URL` to its URL, and in the Razorpay dashboard add a webhook pointing at `<api>/webhooks/razorpay` with events `payment.captured`, `order.paid`, `payment.failed`; put the secret you choose there into `RAZORPAY_WEBHOOK_SECRET`. Set `RAZORPAY_ROUTE=off` to sell before Route is enabled (the platform then settles sellers manually).
4. **Redirects.** After checkout the server redirects to `<redirectOrigin>/checkout-result?status=success|failed|cancelled&vault=…&payment=pay_…`. The site passes its own origin; the app passes `vaultmarket:/`, so the in-app browser sheet closes on `vaultmarket://checkout-result`. Restrict accepted origins with `ALLOWED_REDIRECT_ORIGINS`.
5. **Assets.** Replace the placeholder icon and splash in `assets/`.

## How the money flows

1. Buyer taps Buy. The app calls `POST /checkout` on the payment server, which verifies the vault is published, the seller's linked account is activated, and the buyer does not already own it. It creates a Razorpay Order carrying a Route `transfers` entry for `price - fee` to the seller, stores it in `orders`, and returns the hosted checkout URL.
2. The server's checkout page opens Razorpay Checkout.js (UPI, cards, netbanking, wallets). On success Checkout.js posts the payment id and signature to the server's callback.
3. The server verifies the signature, confirms the payment is captured for the right amount, writes `purchases` (service role key) with the payment and transfer ids, and redirects the buyer. The webhook does the same independently, so a closed browser never loses a sale.
4. The app polls `has_vault_access` for a few seconds, then shows Download. Download URLs are signed and expire in 5 minutes. Storage policies only let owners and buyers read the file.

Free vaults skip Razorpay: `claim_free_vault` inserts the purchase row directly and is guarded in SQL.

### Seller onboarding

Sellers fill in one form (`/sell/payouts` on both app and web): legal name, phone, PAN, address, bank account, IFSC. `POST /payouts` on the server creates a Razorpay **linked account** (`POST /v2/accounts`), a stakeholder, requests the `route` product and attaches the settlement bank details. Razorpay reviews the account; `profiles.payouts_enabled` flips to true once `activation_status` is `activated` (the function re-syncs it whenever the Sell screen opens). Until then the seller can list free vaults but paid checkout is refused server-side.

## Project layout

```
app/
  (tabs)/index.tsx       Explore: search, featured, categories, trending, free, new
  (tabs)/library.tsx     Everything the user owns, with download
  (tabs)/sell.tsx        Seller pitch, payout status, dashboard, listings
  sell/payouts.tsx       Razorpay linked-account (KYC + bank) form
  (tabs)/profile.tsx     Account, public profile, sign out
  browse.tsx             Search and filter results
  vault/[id].tsx         Listing detail, buy/get/download, reviews
  seller/[id].tsx        Public seller page
  sell/[id].tsx          Create or edit a listing (id = "new")
  auth.tsx               Sign in / sign up modal
  checkout-result.tsx    Deep-link target after Razorpay checkout
src/
  lib/api/types.ts       Backend interface the UI depends on
  lib/api/demo.ts        In-memory backend with seed data
  lib/api/supabase.ts    Production backend
  lib/config.ts          Env, fee percent, INR minimum price, demo flag
  lib/payouts.ts         Payout form fields + validation shared by app and web
  store/auth.tsx         Session + profile context
  components/            UI kit, vault cards
supabase/
  migrations/0001_init.sql, 0002_mcp_tokens.sql, 0003_razorpay.sql, 0004_orders.sql
server/
  src/index.ts           Fastify bootstrap
  src/routes/checkout.ts Orders, hosted Checkout.js page, signature callback, status
  src/routes/webhook.ts  Razorpay webhook (raw-body HMAC)
  src/routes/payouts.ts  Route linked-account onboarding
  src/orders.ts          Order + purchase bookkeeping (Supabase or in-memory demo)
web/
  app/                   Next.js pages: explore, browse, vault, library, sell, connect (MCP), auth
  app/api/mcp/route.ts   MCP endpoint (Streamable HTTP) over purchased vaults
  lib/mcp-server.ts      Token lookup, zip unpacking, MCP tools
  shims/                 Browser stand-ins for the RN modules the shared data layer imports
```

## Launch checklist

- Seller agreement and buyer license text (personal, non-transferable).
- Content moderation: a `reports` table and an admin flag to unlist a vault.
- Virus scan uploaded zips before publishing (Supabase storage webhook to a scanner).
- Email receipts (Razorpay can send them per payment), update notifications when a seller ships a new version.
- Store keywords: obsidian vault, obsidian templates, second brain, zettelkasten, PKM, note templates.
