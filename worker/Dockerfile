# Vault Market upload worker: consumes the scan queue. Build context is the REPO ROOT, not this
# folder, because the worker runs the API's own ingest code out of server/src:
#   docker build -f worker/Dockerfile -t vaultmarket-worker .
FROM node:24-alpine AS deps
WORKDIR /app
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# One node_modules at the root: both source trees below resolve their imports up to it.
COPY --from=deps /app/node_modules ./node_modules
COPY worker/package.json ./worker/
COPY worker/src ./worker/src
# Shared with the API: the scan + unpack + ingest step, the queue and store clients, Sanity.
COPY server/src ./server/src
# Node 22.18+ strips TypeScript types natively; no build step.
USER node
CMD ["node", "worker/src/index.ts"]
