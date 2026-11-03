# The image Render (or anything else that runs a container) serves.
#
# Three stages so the thing that ends up on the internet carries only what
# it runs: no pnpm store, no source, no dev dependencies. The app is built
# as a Next standalone bundle, which traces exactly the node_modules it
# needs — see `output: "standalone"` and `outputFileTracingRoot` in
# web/next.config.mjs.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- dependencies -----------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/package.json
COPY packages/js/package.json packages/js/package.json
RUN pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY --from=deps /app/packages/js/node_modules ./packages/js/node_modules
COPY . .

# NEXT_PUBLIC_* is inlined at build time, so it has to be here and not in
# the runtime environment. Everything else is read when the server runs.
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_PAYPAL_CLIENT_ID
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_PAYPAL_CLIENT_ID=$NEXT_PUBLIC_PAYPAL_CLIENT_ID
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

# ---- runtime ----------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The standalone bundle puts node_modules at the root and the server under
# web/, because the tracing root is the repository.
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static
COPY --from=builder /app/web/public ./web/public

# The migrations, and the script that applies them, beside each other —
# `migrate.mjs` looks for the folder next to itself. `cron.mjs` is here for
# the scheduled containers, which share this image and have no curl.
COPY --from=builder /app/web/drizzle ./web/scripts/drizzle
COPY --from=builder /app/web/scripts/migrate.mjs ./web/scripts/migrate.mjs
COPY --from=builder /app/web/scripts/cron.mjs ./web/scripts/cron.mjs
COPY docker-entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

# Not root: this process takes payments.
RUN addgroup -g 1001 -S payus && adduser -u 1001 -S payus -G payus \
  && chown -R payus:payus /app
USER payus

EXPOSE 3000
ENTRYPOINT ["entrypoint"]
CMD ["node", "web/server.js"]
