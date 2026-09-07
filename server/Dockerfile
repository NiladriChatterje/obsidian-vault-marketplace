# Vault Market payment + catalog + MCP server (Fastify). Build context: ./server
#   docker build -t vaultmarket-api ./server
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
# Node 22.18+ strips TypeScript types natively; no build step.
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:${API_PORT:-4000}/health || exit 1
CMD ["node", "src/index.ts"]
