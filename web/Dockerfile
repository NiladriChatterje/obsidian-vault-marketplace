# Vault Market website (Next.js). Build context: ./web
#   docker build -t vaultmarket-web ./web
# EXPO_PUBLIC_* values are inlined into the client bundle at build time, so pass them as build args
# (docker-compose.yml does this from the repo-root .env).
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

ARG EXPO_PUBLIC_SUPABASE_URL=
ARG EXPO_PUBLIC_SUPABASE_ANON_KEY=
ARG EXPO_PUBLIC_PLATFORM_FEE_PERCENT=15
ARG EXPO_PUBLIC_PROVIDER_PERCENT_FEE=4
ARG EXPO_PUBLIC_PROVIDER_FIXED_FEE_CENTS=4000
ARG SERVER_API_URL=http://localhost:4000
ARG EXPO_PUBLIC_REDIRECT_ORIGIN=
ARG EXPO_PUBLIC_CATALOG_SOURCE=sanity
ENV EXPO_PUBLIC_SUPABASE_URL=$EXPO_PUBLIC_SUPABASE_URL \
    EXPO_PUBLIC_SUPABASE_ANON_KEY=$EXPO_PUBLIC_SUPABASE_ANON_KEY \
    EXPO_PUBLIC_PLATFORM_FEE_PERCENT=$EXPO_PUBLIC_PLATFORM_FEE_PERCENT \n    EXPO_PUBLIC_PROVIDER_PERCENT_FEE=$EXPO_PUBLIC_PROVIDER_PERCENT_FEE \n    EXPO_PUBLIC_PROVIDER_FIXED_FEE_CENTS=$EXPO_PUBLIC_PROVIDER_FIXED_FEE_CENTS \
    SERVER_API_URL=$SERVER_API_URL \
    EXPO_PUBLIC_REDIRECT_ORIGIN=$EXPO_PUBLIC_REDIRECT_ORIGIN \
    EXPO_PUBLIC_CATALOG_SOURCE=$EXPO_PUBLIC_CATALOG_SOURCE \
    NEXT_TELEMETRY_DISABLED=1
RUN npx next build

# Dev stage: the source is bind-mounted from the host (see docker-compose.dev.yml), so only
# the dependencies are baked in. EXPO_PUBLIC_* are read from the environment at request time
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
