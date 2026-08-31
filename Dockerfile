# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app

# ---- dependencies (cached separately from source) ----
FROM base AS deps
COPY package.json package-lock.json ./
# The desktop shell (see electron/) is built on a developer machine, never
# here — but `electron` is a devDependency, and `npm ci` installs those
# because the build stage below needs typescript/tailwind. Electron's
# postinstall would then download a ~330 MB platform binary that nothing in
# this image ever runs, and the runtime stage copies node_modules verbatim,
# so it would ship in the final image too.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci

# ---- build ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are baked into the client bundle at build time.
# No defaults here on purpose — pass real values via:
#   docker build --build-arg NEXT_PUBLIC_SIGNALING_URL=wss://seu-dominio/ws ...
ARG NEXT_PUBLIC_SIGNALING_URL
ENV NEXT_PUBLIC_SIGNALING_URL=${NEXT_PUBLIC_SIGNALING_URL}
ARG NEXT_PUBLIC_TURN_URLS
ENV NEXT_PUBLIC_TURN_URLS=${NEXT_PUBLIC_TURN_URLS}
ARG NEXT_PUBLIC_TURN_USERNAME
ENV NEXT_PUBLIC_TURN_USERNAME=${NEXT_PUBLIC_TURN_USERNAME}
ARG NEXT_PUBLIC_TURN_CREDENTIAL
ENV NEXT_PUBLIC_TURN_CREDENTIAL=${NEXT_PUBLIC_TURN_CREDENTIAL}
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID
ENV NEXT_PUBLIC_UMAMI_WEBSITE_ID=${NEXT_PUBLIC_UMAMI_WEBSITE_ID}
ARG NEXT_PUBLIC_STATS_DASHBOARD_URL
ENV NEXT_PUBLIC_STATS_DASHBOARD_URL=${NEXT_PUBLIC_STATS_DASHBOARD_URL}
# The commit half of the version every browser reports, counted as
# sharescreen_clients_by_version on the API (see lib/buildVersion.ts). The
# release half comes from package.json, which is already in this image;
# next.config.ts would read the commit from git on its own, but .dockerignore
# keeps .git out of the build context — so it has to be passed in:
#   docker build --build-arg NEXT_PUBLIC_BUILD_COMMIT=$(git rev-parse --short HEAD) ...
# Left unset the build still works and still reports, as "<versão>-unknown".
ARG NEXT_PUBLIC_BUILD_COMMIT
ENV NEXT_PUBLIC_BUILD_COMMIT=${NEXT_PUBLIC_BUILD_COMMIT}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- runtime ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 sharescreen

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json

USER sharescreen

EXPOSE 3000
ENV PORT=3000

# UMAMI_URL is read at request time by app/api/umami/[...path]/route.ts (not
# baked in at build time) — it must be supplied when running the container,
# e.g. `docker run -e UMAMI_URL=https://seu-umami.exemplo.com ...`.

CMD ["npm", "start"]
