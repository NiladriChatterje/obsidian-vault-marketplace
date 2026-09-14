# Vault Market

A two-sided marketplace for Obsidian vaults, built with Expo (React Native) and TypeScript. Sellers upload a zipped vault and set a price; Vault Market is the seller of record and pays them their share. Listings and every note inside a vault live in Sanity; Supabase handles accounts and purchases. Buyers browse by category, plugin and tag, buy or grab free vaults, and download them into Obsidian.

## Why this idea

- **Obsidian is huge and under-served.** Millions of users, a culture of sharing setups on YouTube and Reddit, and no dedicated store. Today creators sell vaults through Gumroad links buried in video descriptions.
- **Free vaults drive downloads.** Free listings are the top-of-funnel. Students and journalers install the app to grab a free starter vault, then discover paid systems.
- **Marketplace economics.** The platform takes a commission on every sale with no inventory and no content creation. Sellers bring their own audience, which markets the app for you.
- **Recurring demand.** Vaults get versioned. Buyers come back for updates and new releases from sellers they trust.

## Monetization

| Stream | How |
| --- | --- |
| Commission | 8% + ₹40 per sale for sellers paid in India, 12% + ₹40 for sellers paid abroad, settled outside the checkout. The fixed half mirrors Dodo's own 4% + $0.40, so no sale can cost more than it earns; the split rate reflects that reaching a seller abroad costs a transfer fee and a conversion spread. See `PAYMENTS_SETUP_GUIDE.md`. |
| Featured placement | The `featured` flag drives the home carousel. Sell slots to sellers weekly. |
| Seller Pro (future) | Analytics, coupons, early-access releases for a monthly fee. |

Fees are enforced server-side in `server/` (the Fastify payment service), never in the client.

## App store note

Vaults are used in Obsidian, not inside this app, but Apple can still classify them as digital content and require In-App Purchase. Two safe options: keep purchases on the web (the app opens the provider's hosted checkout page in a browser sheet, as it does now) and be ready to make iOS "browse and download only" if review asks, or route iOS purchases through StoreKit. Android is more permissive. Talk to review early.

## Running it

```bash
cd mobile && npm install --legacy-peer-deps
npm start                        # expo start, reading ../.env
```

`mobile/`, `web/`, `server/`, `sanity-studio/` and `supabase/` are independent projects with their own `package.json` and no shared code folder; there is no root install. The app and the site each carry their own copy of the small data layer (types, config, formatting, the `Backend` interface and its demo/Supabase/server-catalog implementations), so a change to the API contract is made in `mobile/src` and `web/src` alike.

With the Supabase keys empty in `.env`, the app runs in **demo mode**: 8 sample vaults, fake auth (any email works), and instant purchases stored on the device. Every screen is usable in Expo Go. Demo purchases are granted instantly and never touch the payment provider.

## Content: Sanity

An Obsidian vault is a folder of markdown files, so that is how it is stored. `sanity-studio/` holds the schema:

| Document | What it holds |
| --- | --- |
| `vault` | The listing: title, slug, tagline, markdown description, category, tags, seller ref, cover URL, price (minor units), currency, status, plugins, version, `entryNote` (start-here path), note count, size, downloads and rating. |
| `note` | One `.md` file: `path` inside the vault, title, folder, full `content`, parsed `frontmatter` (JSON), tags (frontmatter + inline `#tags`), `links` (wikilink targets), `isPreview` (readable before purchase), size. References its vault. |
| `attachment` | Any non-markdown file (images, PDFs, `.obsidian` config) as a Sanity file asset with its path. |
| `seller` | Public profile mirrored from Supabase (`userId`, username, display name, bio). |

Uploading a zip does the conversion: the server unpacks it, strips the common root folder, parses each note, and writes `note`/`attachment` documents tagged with a bundle id. Saving the listing attaches the bundle to the vault and removes the previous contents. Downloads are zipped back together from Sanity on demand, so the original archive is never stored.

**Access rules.** Note bodies are paid content, so the dataset should be **private** (`npx sanity dataset visibility set production private` in `sanity-studio/`). The app and site never call Sanity; they call the payment server, which holds `SANITY_API_TOKEN`, serves listings and note metadata publicly, and returns a note body only if it is a preview or the caller owns the vault (purchase row or seller). The MCP route uses the same shared module. `NEXT_PUBLIC_CATALOG_SOURCE=local` switches the app back to the built-in demo data.

```bash
cd sanity-studio
npx sanity login          # once
npm run dev               # Studio on http://localhost:3333
node ../server/scripts/seed-sanity.ts   # sample sellers, vaults and notes (needs SANITY_API_TOKEN)
```

Studio structure: Vaults → each vault → Listing / Notes / Attachments, plus Sellers and "Unattached uploads" (bundles that were uploaded but never saved to a listing).

## Payment server (Fastify)

`server/` is a small Node service that owns every secret. The app and the site call it with the buyer's Supabase token. Dodo Payments is the merchant of record and the only payment rail.

| Route | What it does |
| --- | --- |
| `POST /checkout` | Validates the vault and buyer, opens a Dodo checkout session, stores it in `orders`, returns Dodo's hosted checkout URL. Nothing is split to anyone. |
| `GET /checkout/:orderId/status` | Order status for polling. |
| `POST /webhooks/dodo` | Standard Webhooks signature over the raw body, then settles, fails or refunds. The only way a Dodo purchase is granted — the buyer's redirect grants nothing. |
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

`server/Dockerfile` runs the TypeScript sources directly on Node 24 (no build step). `web/Dockerfile` builds Next.js in standalone mode and inlines the `NEXT_PUBLIC_*` values as build args (compose passes them from `.env`). Each image builds from its own folder. Rebuild the web image after changing those; server values are read at runtime. The Expo app is not containerised: run it with `npm start` in `mobile/` against the running api.

```bash
cd mobile
npm run typecheck   # tsc --noEmit (includes ../src)
npx expo-doctor
```

To work on the website inside the container, add the `docker-compose.dev.yml` overlay. It swaps the
`web` service to the Dockerfile's `dev` stage, bind-mounts `web/` over `/app`, and runs `next dev`,
so edits under `web/` recompile in about a second with no rebuild:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Only the website is mounted; the api already runs its sources directly. `node_modules` and `.next`
stay on anonymous volumes so the container keeps its own Linux-built copies. The overlay also forces
`next dev --webpack` with `WATCHPACK_POLLING=true`, because Turbopack has no polling option and
Docker Desktop does not deliver file events across a Windows or macOS bind mount. Without the
overlay, `docker compose up` runs the production build as before.

The dev stage builds to its own image (`vaultmarket-web-dev`), so the two modes never overwrite each
other and you can switch between them without `--build`. Keep `--build` for a first run or after
changing `web/package.json`, since dependencies are installed into the image, not the mount.

## Website (Next.js)

`web/` is the same marketplace as a website: sellers list vaults at their price, buyers pay through Dodo's hosted checkout (opened by the payment server), then download the zip or connect the vault to an AI assistant over MCP. It is a plain Next.js project under `web/src/` with a browser-native copy of the app's data layer and no server-side secrets.

```bash
cd web
npm install
npm run dev        # http://localhost:3000, demo mode until the repo-root .env has Supabase keys
npm run build
```

The site reads the repo-root `.env` (and its own `web/.env*` files). Keys that matter for it:

| Key | Purpose |
| --- | --- |
| `SERVER_API_URL` | Base URL of the payment server (`server/`); every data call from the browser goes there. |
| `NEXT_PUBLIC_API_URL` | The same URL for the Expo app. Metro inlines only `NEXT_PUBLIC_*` names, so the app cannot read `SERVER_API_URL`. |
| `NEXT_PUBLIC_REDIRECT_ORIGIN` | Optional. Where the payment server sends buyers back (defaults to the browser origin). Also list it in `ALLOWED_REDIRECT_ORIGINS`. |

### Buyers, sellers and the admin dashboard

Signing in asks what you are here for. **Buy vaults** is the default. **Sell vaults** turns
selling on for the profile and, once there is a session, sends the seller to `/sell/payouts`
to say where their share should go, since no paid vault can be listed until that is filled
in. At sign-up the choice travels in the auth metadata as `role`, so with email confirmation
on the profile is created as a seller before there is any session to set it from
(migration `0017`), and the confirmation link lands them on the payout form.

`/sell` is the seller's store: every listing with its buyers, paid sales, earnings and rating,
and a **Buyers & reviews** page per vault (`/sell/<id>/insights`) listing who bought it, when,
for how much, and every rating and review.

`/admin` is the operator's dashboard, shown in the nav only to users named in
`ADMIN_USER_IDS` on the server: totals across the marketplace, every vault with its buyer
count, sales, fees and rating, and the latest purchases. Each vault opens
`/admin/vaults/<id>` with the full buyer list (including where each sale's money stands:
clearing, awaiting Dodo, or settled) and every review. The routes behind it are
`GET /admin/overview`, `GET /admin/vaults/:id`, `GET /me/insights` and
`GET /me/vaults/:id/insights`; the payout ledger stays at `/admin/payouts`.

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
   Supabase holds `profiles`, `purchases`, `orders`, `reviews`, `mcp_tokens` and their row-level security. Vault ids in those tables are Sanity document ids (0005), and vault files and cover images live in Sanity, not in Supabase storage.

   Then set up **Authentication** in the dashboard — the app cannot do this for you, and email links silently fall back to the Site URL until it is done:

   | Setting | Value |
   | --- | --- |
   | URL Configuration → Site URL | the site's own origin, e.g. `https://vault.market` |
   | URL Configuration → Redirect URLs | `https://<site>/auth/callback`, `https://<site>/auth/reset` (add the `http://localhost:3000` pair for local work) |
   | Providers → Email → Confirm email | on, so an address is proven before it can buy |
   | Providers → Email → Minimum password length | 8, matching `MIN_PASSWORD_LENGTH` in `web/src/lib/config.ts` and `mobile/src/lib/config.ts` |
   | Providers → Email → Leaked password protection | on |
   | Project Settings → Auth → SMTP | your own SMTP provider. The built-in sender is capped at a few messages an hour and is not for production: without it, confirmation and reset mails stop arriving as soon as you have real traffic. |
1. **Sanity.** Log in once (`npx sanity login` in `sanity-studio/`), create an Editor token at sanity.io/manage → API → Tokens, put it in `.env` as `SANITY_API_TOKEN`, make the dataset private, and optionally seed it (`node server/scripts/seed-sanity.ts`). Deploy the Studio with `npm run deploy` in `sanity-studio/`.
2. **App env.** Copy `.env.example` to `.env` and set the Supabase URL and anon key. Restart Expo.
3. **Dodo Payments.** Create an account, take a read-write key from Developer → API Keys into `DODO_API_KEY`, and deploy `server/` somewhere public (any Node host). Set `SERVER_API_URL` to its URL, then add a webhook in Dodo pointing at `<api>/webhooks/dodo` with events `payment.succeeded`, `payment.failed`, `refund.succeeded`, `dispute.lost` and `payout.success`, putting its signing secret into `DODO_WEBHOOK_SECRET`. See `PAYMENTS_SETUP_GUIDE.md`.
4. **Redirects.** After checkout the server redirects to `<redirectOrigin>/checkout-result?status=success|failed|cancelled&vault=…&payment=pay_…`. The site passes its own origin; the app passes `vaultmarket:/`, so the in-app browser sheet closes on `vaultmarket://checkout-result`. Restrict accepted origins with `ALLOWED_REDIRECT_ORIGINS`.
5. **Assets.** Replace the placeholder icon and splash in `assets/`.

## How the money flows

1. Buyer taps Buy. The site calls `POST /checkout`, which verifies the vault is published, priced and not already owned. It ensures the vault's Dodo product exists, opens a checkout session carrying `vault_id` and `buyer_id` as metadata, stores the session in `orders`, and returns Dodo's hosted checkout URL. Nothing is split to anyone.
2. The buyer pays on the provider's page — Dodo presents local methods and charges in their own currency, after tax.
3. **The webhook grants the purchase, never the redirect.** `payment.succeeded` re-reads the payment from Dodo, then writes `purchases` with the service role key. The buyer's return to `/checkout-result` only shows them the result, so a closed browser never loses a sale and a replayed redirect never fakes one.
4. A refund (`refund.succeeded`) marks the order refunded and deletes the `purchases` row, so access goes back with the money.
5. Creators are paid their 90% separately, as suppliers. That is the whole reason this is a merchant-of-record setup: the platform never holds anyone else's money, which would make it a payment aggregator.

Free vaults skip the provider entirely: `claim_free_vault` inserts the purchase row directly and is guarded in SQL.

### Seller onboarding

A creator switches on selling from `/sell`, then records where their share should go at
`/sell/payouts`: country, currency, method and account. There is no linked account and no KYC,
because Vault Market is the seller of record; these are simply the platform's own records of
who to pay. Dodo settles one amount to the platform and never pays a seller, so a paid vault
cannot be published or bought until the seller can be paid. Free vaults are unaffected.

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
  src/app/                 Pages: explore, browse, vault, library, sell (store + per-vault insights), admin, connect (MCP), auth
  src/components/          UI kit, VaultContents
  src/lib/                 Browser copy of the data layer + mcp-token.ts, web.ts
server/                    Fastify (own package.json)
  src/routes/checkout.ts   Opens a Dodo checkout session for a vault
  src/routes/payouts.ts    Seller payout details; gates publishing a paid vault
  src/seller-payouts.ts    Reads/validates them; hasPayoutDetails is the gate
  src/routes/admin-payouts.ts  Who is owed what, CSV for a batch transfer, record a payment
  src/routes/insights.ts   Who bought each vault and what they said: seller insights, admin dashboard
  src/insights.ts          Groups purchases and reviews by vault, hydrated from the catalog
  src/admin.ts             The ADMIN_USER_IDS gate shared by every /admin route
  src/payout-ledger.ts     Earned minus paid, per seller
  src/routes/catalog.ts    Sanity catalog, notes, uploads, downloads, seller CRUD
  src/routes/mcp.ts        MCP endpoint over purchased vaults
  src/sanity/              GROQ queries, mappers, markdown parsing, writes
  src/orders.ts            Order + purchase bookkeeping, provider-neutral, refunds
  src/dodo.ts              Dodo Payments client, product sync, webhook verification
  src/routes/dodo.ts       POST /webhooks/dodo - the only way a Dodo purchase is granted
  scripts/seed-sanity.ts   Seeds sample vaults + notes into Sanity
sanity-studio/             Studio: schemaTypes/ (vault, note, attachment, seller), structure.ts
supabase/                  migrations/0001_init.sql … 0017_signup_role.sql
```

## Launch checklist

- Seller agreement and buyer license text (personal, non-transferable).
- Content moderation: a `reports` table and an admin flag to unlist a vault.
- Virus scan uploaded zips before publishing (Supabase storage webhook to a scanner).
- Email receipts (Dodo issues the tax invoice itself), update notifications when a seller ships a new version.
- Store keywords: obsidian vault, obsidian templates, second brain, zettelkasten, PKM, note templates.
