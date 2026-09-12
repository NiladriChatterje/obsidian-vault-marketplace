# Vault Market website (Next.js). Build context: ./web
#   docker build -t vaultmarket-web ./web
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so pass them as build args
# (docker-compose.yml does this from the repo-root .env).
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL=
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=
ARG NEXT_PUBLIC_PLATFORM_COUNTRY=IN
ARG NEXT_PUBLIC_PLATFORM_FEE_PERCENT_DOMESTIC=8
ARG NEXT_PUBLIC_PLATFORM_FEE_PERCENT_INTERNATIONAL=12
ARG NEXT_PUBLIC_PLATFORM_FEE_FIXED_CENTS=4000
ARG NEXT_PUBLIC_PROVIDER_PERCENT_FEE=4
ARG NEXT_PUBLIC_PROVIDER_FIXED_FEE_CENTS=3500
ARG NEXT_PUBLIC_SERVER_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_REDIRECT_ORIGIN=
ARG NEXT_PUBLIC_CATALOG_SOURCE=sanity
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_PLATFORM_COUNTRY=$NEXT_PUBLIC_PLATFORM_COUNTRY \
    NEXT_PUBLIC_PLATFORM_FEE_PERCENT_DOMESTIC=$NEXT_PUBLIC_PLATFORM_FEE_PERCENT_DOMESTIC \
    NEXT_PUBLIC_PLATFORM_FEE_PERCENT_INTERNATIONAL=$NEXT_PUBLIC_PLATFORM_FEE_PERCENT_INTERNATIONAL \
    NEXT_PUBLIC_PLATFORM_FEE_FIXED_CENTS=$NEXT_PUBLIC_PLATFORM_FEE_FIXED_CENTS \
    NEXT_PUBLIC_PROVIDER_PERCENT_FEE=$NEXT_PUBLIC_PROVIDER_PERCENT_FEE \
    NEXT_PUBLIC_PROVIDER_FIXED_FEE_CENTS=$NEXT_PUBLIC_PROVIDER_FIXED_FEE_CENTS \
    NEXT_PUBLIC_SERVER_API_URL=$NEXT_PUBLIC_SERVER_API_URL \
    NEXT_PUBLIC_REDIRECT_ORIGIN=$NEXT_PUBLIC_REDIRECT_ORIGIN \
    NEXT_PUBLIC_CATALOG_SOURCE=$NEXT_PUBLIC_CATALOG_SOURCE \
    NEXT_TELEMETRY_DISABLED=1
RUN npx next build

# Dev stage: the source is bind-mounted from the host (see docker-compose.dev.yml), so only
# the dependencies are baked in. NEXT_PUBLIC_* are read from the environment at request time
# here rather than inlined, so editing .env needs a restart but not a rebuild.
FROM node:24-alpine AS dev
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
EXPOSE 3000
# --webpack with WATCHPACK_POLLING: Turbopack exposes no polling option, and Docker Desktop
# does not deliver inotify events across a Windows/macOS bind mount, so edits go unnoticed.
CMD ["npx", "next", "dev", "--webpack", "--hostname", "0.0.0.0", "--port", "3000"]

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "server.js"]
