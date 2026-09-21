# Vault Market

A two-sided marketplace for Obsidian vaults, built with Expo (React Native) and TypeScript. Sellers upload a zipped vault and set a price; Vault Market is the seller of record and pays them their share. Listings and the note index live in Supabase beside accounts and purchases; note bodies, attachments and the vault zips live in an S3 bucket. Buyers browse by category, plugin and tag, buy or grab free vaults, and download them into Obsidian.

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

`mobile/`, `web/`, `server/`, `worker/`, `antivirus/` and `supabase/` are independent projects with their own `package.json` and no shared code folder; there is no root install. The app and the site each carry their own copy of the small data layer (types, config, formatting, the `Backend` interface and its demo/Supabase/server-catalog implementations), so a change to the API contract is made in `mobile/src` and `web/src` alike.

With the Supabase keys empty in `.env`, the app runs in **demo mode**: 8 sample vaults, fake auth (any email works), and instant purchases stored on the device. Every screen is usable in Expo Go. Demo purchases are granted instantly and never touch the payment provider.

## Content: Postgres + the vault store

An Obsidian vault is a folder of markdown files. What is *asked* about a vault lives in Supabase Postgres (`supabase/migrations/0018_catalog_in_postgres.sql`); what is merely *large* lives in an S3 bucket, the vault store (`server/src/vault-store.ts`):

| Table | What it holds |
| --- | --- |
| `vaults` | The listing: title, slug, tagline, description, category, tags, `seller_id` → `profiles`, `cover_key`, price (minor units), currency, status, plugins, version, `entry_note` (start-here path), note count, size, downloads, rating (kept current by a trigger on `reviews`). |
| `bundles` | One unpacked upload: id, uploader, `vault_id` (null until the listing is saved), counts. |
| `notes` | One `.md` file's index: `path`, title, folder, parsed `frontmatter` (jsonb), tags (frontmatter + inline `#tags`), `links` (wikilink targets), `is_preview` (readable before purchase), size. The body is in the store. |
| `attachments` | The allowed files that are not notes — `.base`, `.json`, `.yaml`/`.yml`, `.toml`, `.txt`: path, MIME type, size. The bytes are in the store. Nothing else gets in: a vault may hold only `.md`, `.canvas` and those five, and every file is also judged by its bytes (`server/src/catalog/file-policy.ts`), so `image.png.md` is caught the same as `image.png`. |
| `seller_plans` | Which storage plan a seller is on and until when. No row means free (`server/src/plans.ts`). |

| Object key | What it is |
| --- | --- |
| `bundles/<bundle>.zip` | The scanned upload, exactly as it passed the scanner. This **is** the buyer's download; nothing is rebuilt. |
| `bundles/<bundle>/<path>` | Every note body and attachment, read by path for the reader, MCP and in-vault search. |
| `covers/<uuid>.<ext>` | Listing covers, served by `GET /files/covers/:name`. |

Uploading a zip does the conversion (`server/src/vault-upload.ts`): scan, unpack, strip the common root folder, parse each note, write the objects and the index rows under a new bundle id. Saving the listing calls `catalog_attach_bundle`, which points the bundle at the vault and drops the previous one, rows and objects. Uploads nobody saved are swept by the worker after two days.

**Access rules.** Note bodies are paid content. The app and site never touch Postgres's catalog tables or the store directly; they call the payment server, which holds the service role and the store keys, serves listings and note metadata publicly, and returns a note body only if it is a preview or the caller owns the vault (purchase row or seller). The MCP route uses the same module. `NEXT_PUBLIC_CATALOG_SOURCE=local` switches the app back to the built-in demo data.

**Storage plans.** A seller's listings together may not exceed their plan: Free 500 MB, Plus 2 GB, Pro 5 GB (`PLAN_*_MB`), measured unpacked. The seller dashboard shows the meter from the first visit, before anything is uploaded. `GET /me/stats` reports the limit and the plan; the upload refuses a vault that would not fit. Until subscriptions are sold, an operator grants a plan with `POST /admin/sellers/:userId/plan { plan }`. A lapsed plan blocks new uploads; it never deletes anything.

The tables start empty. Fill them by uploading a vault through `/sell`, which is the same path a real seller takes.

## Installing into Obsidian (obsidian-plugin/)

A zip is a one-time event: when a seller ships v2, the buyer has to unzip it somewhere and reconcile it by hand against months of their own notes, so most never update. The plugin in `obsidian-plugin/` makes an update something a buyer will actually accept. It writes a vault they own into a folder of their own vault and, on the next version, replaces only the files they never touched.

It keeps, per install, the hash of every file as the seller shipped it — the *base* — so an update is a three-way comparison per path: base, what is on disk now, and what the seller publishes today. Untouched files are overwritten; where both sides changed a note the seller’s version is written beside the buyer’s as `<name> (v2 from seller).md` and nothing of theirs is lost; a note the seller deleted goes only if the buyer never edited it. Bodies are fetched only for paths that actually moved.

Two things ride on that path. A seller may mark a listing **plugin-only** (`vaults.plugin_only`, migration 0020): buyers are issued no zip link, so there is no ready-made archive in a Downloads folder to repost. It is friction, not prevention — the notes are still files on their disk — and the seller keeps their own download. The other is a **per-buyer fingerprint** (`server/src/fingerprint.ts`): notes served to the plugin carry a 64-bit HMAC over (vault, buyer) written as zero-width characters, so a leaked copy can be traced back with `POST /admin/fingerprint/trace`. Both are off by default; the fingerprint needs `FINGERPRINT_SECRET`, which must never be rotated once set.

The fingerprint changes what a body is, so it changes what a hash is, and the two move together: the manifest promises the hash of the marked note the plugin will actually write. Without it the manifest is one index scan; with it the bodies are read once per (vault version, buyer) and cached, so the update that follows still costs nothing.

The server side is `server/src/routes/sync.ts` (`GET /sync/vaults`, `GET /sync/vaults/:id/manifest`, `POST /sync/vaults/:id/files`), authenticated with the same read-only personal token as MCP (`server/src/token-access.ts`, generated on the site’s Connect page). The manifest is answered from the `hash` column added in `supabase/migrations/0019_file_hashes.sql`; bundles ingested before it get theirs computed from the store on demand.

## Payment server (Fastify)

`server/` is a small Node service that owns every secret. The app and the site call it with the buyer's Supabase token. Dodo Payments is the merchant of record and the only payment rail.

| Route | What it does |
| --- | --- |
| `POST /checkout` | Validates the vault and buyer, opens a Dodo checkout session, stores it in `orders`, returns Dodo's hosted checkout URL. Nothing is split to anyone. |
| `GET /checkout/:orderId/status` | Order status for polling. |
| `POST /webhooks/dodo` | Standard Webhooks signature over the raw body, then settles, fails or refunds. The only way a Dodo purchase is granted — the buyer's redirect grants nothing. |
| `GET /vaults`, `GET /vaults/:id`, `GET /sellers/:id/vaults` | Public catalog from Postgres (filters: `category`, `q`, `sort`, `featured`, `free`, `ids`). |
| `GET /vaults/:id/notes`, `GET /vaults/:id/notes/*`, `GET /vaults/:id/search` | Note index (public), note body and search (preview or owners only). |
| `GET /vaults/:id/access`, `POST /vaults/:id/claim`, `GET /me/library` | Ownership check, free-vault claim, the buyer's library. |
| `GET /vaults/:id/download-link` → `GET /downloads/:token` | Five-minute signed link; the zip is built from the vault's notes and attachments. |
| `POST /vaults`, `POST /vaults/:id/status`, `DELETE /vaults/:id`, `GET /me/vaults`, `GET /me/stats` | Seller listing management; stats include the storage plan and its limit. |
| `GET /files/covers/:name`, `POST /admin/sellers/:userId/plan` | A cover image (public, cached a year); put a seller on a storage plan (operators). |
| `POST /uploads/vault-zip` | Multipart zip → scanned for malware → `note`/`attachment` documents; returns the bundle id the listing form saves as `filePath`. |
| `POST /uploads/vault-zip/init`, `POST /uploads/vault-zip/complete`, `GET /uploads/vault-zip/jobs/:id` | The queued variant: a presigned link into the upload store, then a ticket for the worker, then polling until it is done. `init` answers `{ mode: 'direct' }` where the queue is off. |
| `/mcp` | Model Context Protocol endpoint (Streamable HTTP) over the caller's purchased vaults. |

```bash
cd server
npm install
npm run dev        # http://localhost:4000, reads the repo-root .env
curl localhost:4000/health
```

Uploaded vaults are scanned before they are unpacked. A listing is other people's files going
out to every buyer who downloads it, so the archive is posted to the scanner in `antivirus/`
(`server/src/malware.ts`), whole and still zipped, and rejected on a hit. The browser's `.zip`
check stays where it is, for the fast no; it is not evidence about the contents. `SCANNER_URL`
is the switch: without it nothing is scanned, which is fine on a laptop; with it, a scanner that
cannot be reached refuses the upload rather than quietly passing it on. See
[antivirus/README.md](antivirus/README.md) for deploying it.

With `QUEUE_REDIS_URL` and the `MINIO_*` values set, uploads are queued instead of handled
inline: the browser PUTs the zip straight into an S3-compatible store by presigned link, the API
writes a ticket to Redis (BullMQ) and answers at once, and the worker in `worker/` pulls tickets
a few at a time, running the same scan → unpack → quota → catalog step (`server/src/vault-upload.ts`)
the inline path does. A rush of uploads waits in line rather than timing out against the scanner,
and the API never holds a 70 MB body. The browser asks `POST /uploads/vault-zip/init` which way to
go, so one client works against both. See [worker/README.md](worker/README.md).

Runs on plain Node 22.18+ (TypeScript type stripping, no build step). Without Supabase keys it runs in demo mode: orders are kept in memory, purchases are granted by the client, and the client identifies itself with an `x-demo-user` header (never expose demo mode publicly).

## Docker

Both services ship with Dockerfiles and a root `docker-compose.yml` that reads `.env`:

```bash
docker compose up --build      # web on :3000, api on :4000
docker compose logs -f api
```

The `antivirus` service comes up alongside them, built from `antivirus/`. Its signature database
ships inside the image, so it is scanning about a minute after boot; until then uploads answer
503 and the rest of the site is unaffected. Budget for it: clamd holds the whole database in
memory, about 1.1 GB idle, so a 512 MB instance will not run it.

Three more services back the upload queue: `redis` (the tickets), `minio` (the zips, S3 API on
:9000, console on :9001) and `worker` (the consumer, built from `worker/` with the repo root as
context). Compose wires the api and worker to them, so under compose every upload takes the
queued path; run the api on its own without those variables and it is inline as before. The
browser reaches MinIO by `MINIO_PUBLIC_URL`, which defaults to `http://localhost:9000`; set it in
`.env` when the site is opened from another machine. More workers: `docker compose up --scale worker=3`.

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

The site shows one side at a time, and the side sets the tabs for the visit:

| Side | Tabs | Home |
| --- | --- | --- |
| Buyer | Explore, Library, MCP | `/` |
| Seller | Store, New listing, Payouts | `/sell` |
| Administrator | Dashboard | `/admin` |

One account can buy and sell. Nobody is asked which at sign-in: everyone arrives buying, and
the account page (`/profile`) switches sides with the choice remembered per browser. The one
exception is the door someone came through: signing in or up from the Sell tab turns selling
on for the profile and, once there is a session, sends them to `/sell/payouts` to say where
their share should go, since no paid vault can be listed until that is filled in. At sign-up
that hint travels in the auth metadata as `role`, so with email confirmation on the profile is
created as a seller before there is any session to set it from (migration `0017`), and the
confirmation link lands them on the payout form. The account named in `ADMIN_USER_IDS` gets a
third side on the account page, **Dashboard**; everyone else sees buying and selling only. In
demo mode an email starting with `admin` plays that part.

`/sell` is the seller's store: every listing with its buyers, paid sales, earnings and rating,
and a **Buyers & reviews** page per vault (`/sell/<id>/insights`) listing who bought it, when,
for how much, and every rating and review.

`/admin` is the operator's dashboard, offered as a side only to the account named in
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

Tools: `list_vaults`, `list_notes`, `read_note`, `search_notes`, all reading the vault's notes through the catalog module. In demo mode the endpoint accepts `vm_demo_token`.

## Going live

1. **Supabase project.** Create one, then apply the schema:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
   Supabase holds `profiles`, `purchases`, `orders`, `reviews`, `mcp_tokens`, and since 0018 the catalog too: `vaults`, `bundles`, `notes`, `attachments`, `seller_plans`. Vault ids are text everywhere. Vault files and cover images live in the vault store, not in Supabase storage.

   Then set up **Authentication** in the dashboard — the app cannot do this for you, and email links silently fall back to the Site URL until it is done:

   | Setting | Value |
   | --- | --- |
   | URL Configuration → Site URL | the site's own origin, e.g. `https://vault.market` |
   | URL Configuration → Redirect URLs | `https://<site>/auth/callback`, `https://<site>/auth/reset` (add the `http://localhost:3000` pair for local work) |
   | Providers → Email → Confirm email | on, so an address is proven before it can buy |
   | Providers → Email → Minimum password length | 8, matching `MIN_PASSWORD_LENGTH` in `web/src/lib/config.ts` and `mobile/src/lib/config.ts` |
   | Providers → Email → Leaked password protection | on |
   | Email Templates → Magic Link | **must contain `{{ .Token }}`.** Sign-in is a six-digit code, and the stock template only carries `{{ .ConfirmationURL }}` — leave it and the mail arrives with a link and no code in it. |
   | Providers → Email → Email OTP Expiration | 600 seconds. The default is an hour, which is a long time for a code sitting in an inbox. |
   | Project Settings → Auth → SMTP | your own SMTP provider. The built-in sender is capped at a few messages an hour and is not for production: without it, sign-in codes and confirmation mails stop arriving as soon as you have real traffic. Brevo can serve this, but the dashboard wants the SMTP credentials, not the `BREVO_API_KEY` the server uses. |
1. **The vault store.** Any S3-compatible bucket: `VAULT_STORE_ENDPOINT` plus its keys in `.env`. docker-compose runs one (`minio-store`); in production point it at R2 or OCI Object Storage. Nothing else changes.
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
`/sell/payouts`: currency, method and account. There is no linked account and no KYC,
because Vault Market is the seller of record; these are simply the platform's own records of
who to pay. Dodo settles one amount to the platform and never pays a seller, so a paid vault
cannot be published or bought until the seller can be paid. Free vaults are unaffected.

### Paying sellers

Payouts go out once a month, on the 28th (`PAYOUT_CYCLE_DAY`, in `PAYOUT_CYCLE_TIMEZONE`).
On that day the server prepares a run for every seller whose cleared balance, as it stood at
the start of the day, has reached their threshold: Rs 5,000 for a payout inside India,
about USD 70 (Rs 6,200) for one abroad (`PAYOUT_THRESHOLD_DOMESTIC_CENTS`,
`PAYOUT_THRESHOLD_INTERNATIONAL_CENTS`). Routes that cost more to send than that covers,
such as an international bank wire, derive a higher threshold from `TRANSFER_COST_*` so no
payout can cost more than the commission behind it. Anything clearing after the 28th waits
for the next one. The operator makes the transfers from the batch file and confirms each run
at `/admin/payouts/runs`.

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
antivirus/                 Vault scanner: ClamAV + a small HTTP front (own Dockerfile, render.yaml)
  src/index.ts             POST /scan, GET /health
  src/clamd.ts             The clamd INSTREAM client
server/                    Fastify (own package.json)
  src/routes/checkout.ts   Opens a Dodo checkout session for a vault
  src/routes/payouts.ts    Seller payout details; gates publishing a paid vault
  src/seller-payouts.ts    Reads/validates them; hasPayoutDetails is the gate
  src/routes/admin-payouts.ts  Who is owed what, CSV for a batch transfer, record a payment
  src/routes/insights.ts   Who bought each vault and what they said: seller insights, admin dashboard
  src/insights.ts          Groups purchases and reviews by vault, hydrated from the catalog
  src/admin.ts             The ADMIN_USER_IDS gate shared by every /admin route
  src/payout-ledger.ts     Earned minus paid, per seller
  src/routes/catalog.ts    Catalog, notes, uploads, downloads, covers, seller CRUD, plans
  src/catalog/index.ts     The catalog: listings + note index in Postgres, bytes in the vault store
  src/catalog/markdown.ts  Frontmatter, tags, wikilinks out of an Obsidian note
  src/vault-store.ts       The S3 bucket a vault lives in for good: zip, note bodies, attachments, covers
  src/plans.ts             Storage plans and each seller's quota
  src/vault-upload.ts      One zip: scan, unpack, quota, ingest; shared by the route and the worker
  src/upload-store.ts      The S3/MinIO bucket a queued zip waits in; presigned links
  src/upload-queue.ts      The BullMQ ticket queue between api and worker
  src/s3.ts                The client both stores are built on
  src/malware.ts           Posts each uploaded zip to the scanner before it is unpacked
worker/                    Upload worker: consumes the queue, runs server/src/vault-upload.ts (own Dockerfile, repo-root context)
  src/index.ts             The BullMQ Worker: buffer -> scan -> catalog, retries vs. final refusals; sweeps unsaved uploads
  src/routes/mcp.ts        MCP endpoint over purchased vaults
  src/routes/sync.ts       Manifest + file reads for the Obsidian plugin: install and update in place
  src/fingerprint.ts       The per-buyer mark stamped into notes served to the plugin, and how to trace one
  src/token-access.ts      The Connect-page token: who is calling, and which vaults they own (MCP and sync)
  src/orders.ts            Order + purchase bookkeeping, provider-neutral, refunds
  src/dodo.ts              Dodo Payments client, product sync, webhook verification
  src/routes/dodo.ts       POST /webhooks/dodo - the only way a Dodo purchase is granted
obsidian-plugin/           The Obsidian community plugin (own package.json, esbuild -> main.js)
  main.ts                  Install a bought vault into a folder; update it with a three-way merge that never clobbers your edits
  manifest.json            What Obsidian reads: id, version, minAppVersion
supabase/                  migrations/0001_init.sql … 0020_plugin_only.sql
```

## Launch checklist

- Seller agreement and buyer license text (personal, non-transferable).
- Content moderation: a `reports` table and an admin flag to unlist a vault.
- Email receipts (Dodo issues the tax invoice itself), update notifications when a seller ships a new version (the plugin already applies them; buyers still have to ask).
- Store keywords: obsidian vault, obsidian templates, second brain, zettelkasten, PKM, note templates.
