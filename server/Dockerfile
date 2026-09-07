# Vault Market payment + catalog server (Fastify). Build context: repo root, because the
# server imports the shared Sanity module from ../src/lib/sanity.
#   docker build -f server/Dockerfile -t vaultmarket-api .
FROM node:24-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY src/types.ts ./src/types.ts
COPY src/lib/sanity ./src/lib/sanity
COPY src/lib/demo-data.ts ./src/lib/demo-data.ts
COPY server/package.json ./server/
COPY server/src ./server/src
COPY server/scripts ./server/scripts
# Node 22.18+ strips TypeScript types natively; no build step.
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:${API_PORT:-4000}/health || exit 1
WORKDIR /app/server
CMD ["node", "src/index.ts"]
