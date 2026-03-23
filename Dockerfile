# ─── Stage 1: base ────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# ─── Dev stage (parallel branch — not part of production chain) ──────────────
FROM base AS dev
WORKDIR /workspace
RUN apk add --no-cache git
CMD ["sh", "-c", "pnpm install && pnpm --filter @dpf/db exec prisma generate && pnpm --filter web dev"]

# ─── Stage 2: deps ────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/db/prisma/schema.prisma ./packages/db/prisma/
COPY packages/db/prisma.config.ts ./packages/db/
RUN pnpm install --frozen-lockfile

# ─── Stage 3: build ───────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
# Ensure dependencies are intact after copying source files (which may include symlinks)
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dpf/db exec prisma generate
RUN pnpm --filter web build

# ─── Stage 4: init (build source for migrations, seed, Prisma client) ─────────
FROM deps AS init
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dpf/db exec prisma generate

# ─── Stage 5: runner (unified — serves app AND runs init) ─────────────────────
FROM base AS runner
LABEL org.opencontainers.image.title="Open Digital Product Factory"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/markdbodman/opendigitalproductfactory"
WORKDIR /app
RUN apk add --no-cache docker-cli
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Copy standalone Next.js output
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

# Copy init dependencies: pnpm workspace, migrations, seed, Prisma client, tsx
COPY --from=init /app/packages/db ./packages/db
COPY --from=init /app/node_modules ./node_modules
COPY --from=init /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
