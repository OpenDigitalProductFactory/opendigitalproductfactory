# ─── Stage 1: base ────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

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

# ─── Stage 4: init (migrations, seed, hardware detection) ─────────────────────
FROM deps AS init
COPY . .
# Ensure dependencies are intact before running database migrations/seeding
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dpf/db exec prisma generate
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]

# ─── Stage 5: runner (production Next.js) ──────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Copy standalone output
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
