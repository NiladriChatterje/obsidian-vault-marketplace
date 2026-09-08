# Vault Market

A two-sided marketplace for Obsidian vaults, built with Expo (React Native) and TypeScript. Sellers upload a zipped vault, set a price in INR, and get paid through Razorpay Route. Listings and every note inside a vault live in Sanity; Supabase handles accounts and purchases. Buyers browse by category, plugin and tag, buy or grab free vaults, and download them into Obsidian.

## Why this idea

- **Obsidian is huge and under-served.** Millions of users, a culture of sharing setups on YouTube and Reddit, and no dedicated store. Today creators sell vaults through Gumroad links buried in video descriptions.
- **Free vaults drive downloads.** Free listings are the top-of-funnel. Students and journalers install the app to grab a free starter vault, then discover paid systems.
- **Marketplace economics.** The platform takes a commission on every sale with no inventory and no content creation. Sellers bring their own audience, which markets the app for you.
- **Recurring demand.** Vaults get versioned. Buyers come back for updates and new releases from sellers they trust.

## Monetization

| Stream | How |
| --- | --- |
| Commission | 10% of every paid sale (`PLATFORM_FEE_PERCENT`), kept back when the seller's share is transferred via Razorpay Route. Sellers keep 90%. |
| Featured placement | The `featured` flag drives the home carousel. Sell slots to sellers weekly. |
| Seller Pro (future) | Analytics, coupons, early-access releases for a monthly fee. |

Fees are enforced server-side in `server/` (the Fastify payment service), never in the client.

## App store note

Vaults are used in Obsidian, not inside this app, but Apple can still classify them as digital content and require In-App Purchase. Two safe options: keep purchases on the web (the app opens the server's Razorpay checkout page in a browser sheet, as it does now) and be ready to make iOS "browse and download only" if review asks, or route iOS purchases through StoreKit. Android is more permissive. Talk to review early.

## Running it

```bash
cd mobile && npm install --legacy-peer-deps
npm start                        # expo start, reading ../.env
```

`mobile/`, `web/`, `server/`, `sanity-studio/` and `supabase/` are independent projects with their own `package.json` and no shared code folder; there is no root install. The app and the site each carry their own copy of the small data layer (types, config, formatting, the `Backend` interface and its demo/Supabase/server-catalog implementations), so a change to the API contract is made in `mobile/src` and `web/src` alike.

With the Supabase keys empty in `.env`, the app runs in **demo mode**: 8 sample vaults, fake auth (any email works), and instant purchases stored on the device. Every screen is usable in Expo Go. If the payment server is running (below), tapping Buy in demo mode still opens a real Razorpay **test** checkout so the flow can be tried end to end.

## Content: Sanity

An Obsidian vault is a folder of markdown files, so that is how it is stored. `sanity-studio/` holds the schema:

| Document | What it holds |
| --- | --- |
| `vault` | The listing: title, slug, tagline, markdown description, category, tags, seller ref, cover URL, price (minor units), currency, status, plugins, version, `entryNote` (start-here path), note count, size, downloads and rating. |
| `note` | One `.md` file: `path` inside the vault, title, folder, full `content`, parsed `frontmatter` (JSON), tags (frontmatter + inline `#tags`), `links` (wikilink targets), `isPreview` (readable before purchase), size. References its vault. |
| `attachment` | Any non-markdown file (images, PDFs, `.obsidian` config) as a Sanity file asset with its path. |
| `seller` | Public profile mirrored from Supabase (`userId`, username, display name, bio). |

Uploading a zip does the conversion: the server unpacks it, strips the common root folder, parses each note, and writes `note`/`attachment` documents tagged with a bundle id. Saving the listing attaches the bundle to the vault and removes the previous contents. Downloads are zipped back together from Sanity on demand, so the original archive is never stored.

**Access rules.** Note bodies are paid content, so the dataset should be **private** (`npx sanity dataset visibility set production private` in `sanity-studio/`). The app and site never call Sanity; they call the payment server, which holds `SANITY_API_TOKEN`, serves listings and note metadata publicly, and returns a note body only if it is a preview or the caller owns the vault (purchase row or seller). The MCP route uses the same shared module. `EXPO_PUBLIC_CATALOG_SOURCE=local` switches the app back to the built-in demo data.

```bash
cd sanity-studio
npx sanity login          # once
npm run dev               # Studio on http://localhost:3333
node ../server/scripts/seed-sanity.ts   # sample sellers, vaults and notes (needs SANITY_API_TOKEN)
```

Studio structure: Vaults → each vault → Listing / Notes / Attachments, plus Sellers and "Unattached uploads" (bundles that were uploaded but never saved to a listing).

## Payment server (Fastify)

`server/` is a small Node service that owns everything needing the Razorpay secret. The app and the site call it with the buyer's Supabase token.

| Route | What it does |
| --- | --- |
| `POST /checkout` | Validates the vault and buyer, creates a Razorpay **Order** (with a Route transfer to the seller), stores it in `orders`, returns the hosted checkout URL. |
| `GET /checkout/:orderId` | Hosted page that opens Razorpay Checkout.js for that order. Works in a browser sheet on mobile, so no native SDK is needed. |
| `POST /checkout/:orderId/callback` | Checkout.js posts `razorpay_payment_id` + `razorpay_signature` here. The server verifies HMAC(order_id\|payment_id), fetches the payment, captures it if needed, checks the amount, records the purchase and transfer id, then redirects to `/checkout-result`. |
| `GET /checkout/:orderId/status` | Order status for polling. |
| `POST /webhooks/razorpay` | Verifies `X-Razorpay-Signature` over the raw body, then settles or fails the order (`payment.captured`, `order.paid`, `payment.failed`) or syncs a seller's Route activation (`product.route.activated`, `product.route.under_review`, `product.route.needs_clarification`). Idempotent with the callback. |
| `POST /payouts`, `GET /payouts/status` | Seller onboarding to Razorpay Route (linked account, stakeholder, product, bank details) and activation sync. |
| `GET /vaults`, `GET /vaults/:id`, `GET /sellers/:id/vaults` | Public catalog from Sanity (filters: `category`, `q`, `sort`, `featured`, `free`, `ids`). |
| `GET /vaults/:id/notes`, `GET /vaults/:id/notes/*`, `GET /vaults/:id/search` | Note index (public), note body and search (preview or owners only). |
| `GET /vaults/:id/access`, `POST /vaults/:id/claim`, `GET /me/library` | Ownership check, free-vault claim, the buyer's library. |
| `GET /vaults/:id/download-link` → `GET /downloads/:token` | Five-minute signed link; the zip is built from the vault's notes and attachments. |
| `POST /vaults`, `POST /vaults/:id/status`, `DELETE /vaults/:id`, `GET /me/vaults`, `GET /me/stats` | Seller listing management, written to Sanity. |
| `POST /uploads/vault-zip` | Multipart zip → `note`/`attachment` documents; returns the bundle id the listing form saves as `filePath`. |
| `/mcp` | Model Context Protocol endpoint (Streamable HTTP) over the caller's purchased vaults. |

```bash
cd server
npm install
npm run dev        # http://localhost:4000, reads the repo-root .env
curl localhost:4000/health
```

Runs on plain Node 22.18+ (TypeScript type stripping, no build step). Without Supabase keys it runs in demo mode: orders are kept in memory, purchases are granted by the client, and the client identifies itself with an `x-demo-user` header (never expose demo mode publicly).

## Docker

Both services ship with Dockerfiles and a root `docker-compose.yml` that reads `.env`:

```bash
docker compose up --build      # web on :3000, api on :4000
docker compose logs -f api
```

`server/Dockerfile` runs the TypeScript sources directly on Node 24 (no build step). `web/Dockerfile` builds Next.js in standalone mode and inlines the `EXPO_PUBLIC_*` values as build args (compose passes them from `.env`). Each image builds from its own folder. Rebuild the web image after changing those; server values are read at runtime. The Expo app is not containerised: run it with `npm start` in `mobile/` against the running api.

```bash
cd mobile
npm run typecheck   # tsc --noEmit (includes ../src)
npx expo-doctor
```

## Website (Next.js)

`web/` is the same marketplace as a website: sellers list vaults at their price, buyers pay through Razorpay Checkout (via the payment server), then download the zip or connect the vault to an AI assistant over MCP. It is a plain Next.js project under `web/src/` with a browser-native copy of the app's data layer and no server-side secrets.

```bash
cd web
npm install
npm run dev        # http://localhost:3000, demo mode until the repo-root .env has Supabase keys
npm run build
```

The site reads the repo-root `.env` (and its own `web/.env*` files). Keys that matter for it:

| Key | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Base URL of the payment server (`server/`); every data call from the browser goes there. |
| `EXPO_PUBLIC_REDIRECT_ORIGIN` | Optional. Where the payment server sends buyers back (defaults to the browser origin). Also list it in `ALLOWED_REDIRECT_ORIGINS`. |

### MCP access

Every buyer gets a personal token at `/connect` (only its SHA-256 hash is stored, table `mcp_tokens`, migration `0002`). The endpoint is served by the payment server. Point any Model Context Protocol client at `https://<api>/mcp` with `Authorization: Bearer <token>`:

```bash
claude mcp add --transport http vault-market https://<api>/mcp --header "Authorization: Bearer vm_..."
```

Tools: `list_vaults`, `list_notes`, `read_note`, `search_notes`, all reading the vault's notes from Sanity. In demo mode the endpoint accepts `vm_demo_token`.

## Going live

1. **Supabase project.** Create one, then apply the schema:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
   After migration 0005 Supabase holds `profiles`, `purchases`, `orders`, `reviews`, `mcp_tokens`, row-level security, and the public `vault-covers` bucket. Vault ids in those tables are Sanity document ids.
1. **Sanity.** Log in once (`npx sanity login` in `sanity-studio/`), create an Editor token at sanity.io/manage → API → Tokens, put it in `.env` as `SANITY_API_TOKEN`, make the dataset private, and optionally seed it (`node server/scripts/seed-sanity.ts`). Deploy the Studio with `npm run deploy` in `sanity-studio/`.
2. **App env.** Copy `.env.example` to `.env` and set the Supabase URL and anon key. Restart Expo.
3. **Razorpay.** Create a Razorpay account (KYC as an individual or business), ask support to enable **Route** on it, and put the key id / secret from Settings → API Keys into `.env` (`RAZORPAY_CLIENT_KEY`, `RAZORPAY_SECRET_KEY`, `MERCHANT_ID`). Deploy `server/` somewhere public (any Node host), set `EXPO_PUBLIC_API_URL` to its URL, and in the Razorpay dashboard add a webhook pointing at `<api>/webhooks/razorpay` with events `payment.captured`, `order.paid`, `payment.failed`, `product.route.activated`, `product.route.under_review`, `product.route.needs_clarification`; put the secret you choose there into `RAZORPAY_WEBHOOK_SECRET`. Set `RAZORPAY_ROUTE=off` to sell before Route is enabled (the platform then settles sellers manually).
4. **Redirects.** After checkout the server redirects to `<redirectOrigin>/checkout-result?status=success|failed|cancelled&vault=…&payment=pay_…`. The site passes its own origin; the app passes `vaultmarket:/`, so the in-app browser sheet closes on `vaultmarket://checkout-result`. Restrict accepted origins with `ALLOWED_REDIRECT_ORIGINS`.
5. **Assets.** Replace the placeholder icon and splash in `assets/`.

## How the money flows

1. Buyer taps Buy. The app calls `POST /checkout` on the payment server, which verifies the vault is published, the seller's linked account is activated, and the buyer does not already own it. It creates a Razorpay Order carrying a Route `transfers` entry for `price - fee` to the seller, stores it in `orders`, and returns the hosted checkout URL.
2. The server's checkout page opens Razorpay Checkout.js (UPI, cards, netbanking, wallets). On success Checkout.js posts the payment id and signature to the server's callback.
3. The server verifies the signature, confirms the payment is captured for the right amount, writes `purchases` (service role key) with the payment and transfer ids, and redirects the buyer. The webhook does the same independently, so a closed browser never loses a sale.
4. The app polls `has_vault_access` for a few seconds, then shows Download. Download URLs are signed and expire in 5 minutes. Storage policies only let owners and buyers read the file.

Free vaults skip Razorpay: `claim_free_vault` inserts the purchase row directly and is guarded in SQL.

### Seller onboarding

Sellers fill in one form (`/sell/payouts` on both app and web): legal name, mobile number with country code (E.164, e.g. +91…), PAN, address, bank account, IFSC. `POST /payouts` on the server creates a Razorpay **linked account** (`POST /v2/accounts`), a stakeholder, requests the `route` product and attaches the settlement bank details. Razorpay reviews the account; `profiles.payouts_enabled` flips to true once `activation_status` is `activated` (the function re-syncs it whenever the Sell screen opens). Until then the seller can list free vaults but paid checkout is refused server-side.

## Project layout

```
mobile/                    Expo app (own package.json)
  app/                     Screens: (tabs)/, vault/[id], seller/[id], sell/[id], sell/payouts, auth, checkout-result
  src/types.ts             Domain types
  src/lib/api/             Backend interface + demo / Supabase / server-catalog implementations
  src/lib/config.ts        Env, fee percent, INR minimum price, demo flag
  src/lib/payouts.ts       Payout form fields + validation
  src/store, hooks, components, theme
web/                       Next.js site (own package.json), no server-side secrets
  src/app/                 Pages: explore, browse, vault, library, sell, sell/payouts, connect (MCP), auth
  src/components/          UI kit, VaultContents
  src/lib/                 Browser copy of the data layer + mcp-token.ts, web.ts
server/                    Fastify (own package.json)
  src/routes/checkout.ts   Razorpay orders, hosted Checkout.js page, signature callback
  src/routes/webhook.ts    Razorpay webhook (raw-body HMAC)
  src/routes/payouts.ts    Route linked-account onboarding
  src/routes/catalog.ts    Sanity catalog, notes, uploads, downloads, seller CRUD
  src/routes/mcp.ts        MCP endpoint over purchased vaults
  src/sanity/              GROQ queries, mappers, markdown parsing, writes
  src/orders.ts            Order + purchase bookkeeping (Supabase or in-memory demo)
  scripts/seed-sanity.ts   Seeds sample vaults + notes into Sanity
sanity-studio/             Studio: schemaTypes/ (vault, note, attachment, seller), structure.ts
supabase/                  migrations/0001_init.sql … 0005_sanity_catalog.sql
```

## Launch checklist

- Seller agreement and buyer license text (personal, non-transferable).
- Content moderation: a `reports` table and an admin flag to unlist a vault.
- Virus scan uploaded zips before publishing (Supabase storage webhook to a scanner).
- Email receipts (Razorpay can send them per payment), update notifications when a seller ships a new version.
- Store keywords: obsidian vault, obsidian templates, second brain, zettelkasten, PKM, note templates.
