# ─── Stage 1: base ────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.32.0 --activate
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
# Copy source EXCLUDING pnpm-lock.yaml (preserve the deps stage lockfile which has no expo entries)
COPY pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/ ./apps/web/
COPY packages/ ./packages/
COPY docker-entrypoint.sh ./
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dpf/db exec prisma generate
RUN pnpm --filter web build

# ─── Stage 4: init (build source for migrations, seed, Prisma client) ─────────
FROM deps AS init
COPY pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/ ./apps/web/
COPY packages/ ./packages/
COPY docker-entrypoint.sh ./
COPY docs/user-guide/ ./docs/user-guide/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dpf/db exec prisma generate

# ─── Stage 5: runner (unified — serves app AND runs init) ─────────────────────
FROM base AS runner
LABEL org.opencontainers.image.title="Open Digital Product Factory"
LABEL org.opencontainers.image.description="Self-developing digital product management platform"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/markdbodman/opendigitalproductfactory"
WORKDIR /app
RUN apk add --no-cache docker-cli docker-cli-compose postgresql16-client git curl
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
COPY --from=init /app/docs/user-guide ./docs/user-guide
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Source for Build Studio — copied to -src paths to avoid collision with standalone output
# Note: /app/apps/web/ and /app/packages/ are occupied by the standalone NFT output.
# The -src suffix paths are guaranteed free.
COPY --from=build /app/apps/web/ ./apps/web-src/
COPY --from=build /app/packages/ ./packages-src/

# Version file baked in at build time
ARG DPF_VERSION=dev
RUN echo "$DPF_VERSION" > /app/.dpf-image-version

# Promoter build context (autonomous deployment pipeline)
# These files let the portal build the dpf-promoter image on first use.
COPY Dockerfile.promoter /promoter/Dockerfile.promoter
COPY scripts/promote.sh /promoter/promote.sh
COPY Dockerfile /promoter/portal.Dockerfile
RUN chmod +x /promoter/promote.sh

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
