# Vault Market website (Next.js). Build context: repo root, because the site imports ../src.
#   docker build -f web/Dockerfile -t vaultmarket-web .
# EXPO_PUBLIC_* values are inlined into the client bundle at build time, so pass them as build args
# (docker-compose.yml does this from .env). SUPABASE_SERVICE_ROLE_KEY is read at runtime.
FROM node:24-alpine AS builder
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-audit --no-fund
COPY src ./src
COPY web ./web

ARG EXPO_PUBLIC_SUPABASE_URL=
ARG EXPO_PUBLIC_SUPABASE_ANON_KEY=
ARG EXPO_PUBLIC_PLATFORM_FEE_PERCENT=15
ARG EXPO_PUBLIC_API_URL=http://localhost:4000
ARG EXPO_PUBLIC_REDIRECT_ORIGIN=
ARG EXPO_PUBLIC_CATALOG_SOURCE=sanity
ENV EXPO_PUBLIC_CATALOG_SOURCE=$EXPO_PUBLIC_CATALOG_SOURCE \
    EXPO_PUBLIC_SUPABASE_URL=$EXPO_PUBLIC_SUPABASE_URL \
    EXPO_PUBLIC_SUPABASE_ANON_KEY=$EXPO_PUBLIC_SUPABASE_ANON_KEY \
    EXPO_PUBLIC_PLATFORM_FEE_PERCENT=$EXPO_PUBLIC_PLATFORM_FEE_PERCENT \
    EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL \
    EXPO_PUBLIC_REDIRECT_ORIGIN=$EXPO_PUBLIC_REDIRECT_ORIGIN \
    NEXT_TELEMETRY_DISABLED=1
RUN cd web && npx next build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
# Standalone output is rooted at the repo root (outputFileTracingRoot), hence the web/ prefix.
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "web/server.js"]
