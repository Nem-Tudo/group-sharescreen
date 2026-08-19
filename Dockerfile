# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app

# ---- dependencies (cached separately from source) ----
FROM base AS deps
COPY package.json package-lock.json ./
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
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID
ENV NEXT_PUBLIC_UMAMI_WEBSITE_ID=${NEXT_PUBLIC_UMAMI_WEBSITE_ID}
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
COPY --from=builder /app/server ./server

USER sharescreen

# 3000 = Next.js (web), 4000 = Fastify (sinalização WebRTC)
EXPOSE 3000 4000
ENV PORT=3000
ENV SIGNALING_PORT=4000
ENV SIGNALING_HOST=0.0.0.0

# UMAMI_URL is read at request time by app/api/umami/[...path]/route.ts (not
# baked in at build time) — it must be supplied when running the container,
# e.g. `docker run -e UMAMI_URL=https://seu-umami.exemplo.com ...`.

CMD ["npm", "start"]
