# ─── Stage 1: base ────────────────────────────────────────────────────────────
# Cache bust: 2026-04-09-ideate-dispatch
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ─── Dev stage (parallel branch — not part of production chain) ──────────────
FROM base AS dev
WORKDIR /workspace
RUN apk add --no-cache git postgresql16-client
CMD ["sh", "-c", "pnpm install && pnpm --filter @dpf/db exec prisma generate && pnpm --filter web dev"]

# ─── Stage 2: deps ────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY scripts/set-hooks-path.mjs ./scripts/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/db/prisma/schema.prisma ./packages/db/prisma/
COPY packages/db/prisma.config.ts ./packages/db/
COPY packages/db/src/load-env.ts ./packages/db/src/
RUN pnpm install --frozen-lockfile

# ─── Stage 3: build ───────────────────────────────────────────────────────────
FROM deps AS build
# Copy source EXCLUDING pnpm-lock.yaml (preserve the deps stage lockfile which has no expo entries)
COPY pnpm-workspace.yaml tsconfig.base.json .gitignore ./
COPY scripts/set-hooks-path.mjs ./scripts/
COPY apps/web/ ./apps/web/
COPY packages/ ./packages/
COPY docker-entrypoint.sh ./
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dpf/db exec prisma generate
# Node 24 Alpine + Turbopack can crash the separate build worker in Docker
# with SIGSEGV/SIGTRAP while the same source build passes on the host. Keep the
# production bundler path but run Turbopack in-process for image builds.
RUN NODE_OPTIONS="--max-old-space-size=4096" NEXT_TELEMETRY_DISABLED=1 NEXT_TURBOPACK_USE_WORKER=0 pnpm --filter web build

# ─── Stage 4: init (build source for migrations, seed, Prisma client) ─────────
FROM deps AS init
COPY pnpm-workspace.yaml tsconfig.base.json .gitignore ./
COPY scripts/set-hooks-path.mjs ./scripts/
COPY apps/web/ ./apps/web/
COPY packages/ ./packages/
COPY prompts/ ./prompts/
COPY skills/ ./skills/
# Deliberation pattern definitions — markdown sources read at seed time by
# seed-deliberation.ts (seed.ts:2480). Without this COPY the seed logs
# "deliberation/ directory not found — skipping" and the DeliberationPattern
# table stays empty, so reviewDesignDoc cannot select the "review" pattern,
# the Build Studio review-gate trail never records, and every build wedges in
# Ideate (Ideate -> Plan never opens). Mirrors prompts/skills handling.
COPY deliberation/ ./deliberation/
COPY docker-entrypoint.sh ./
COPY docs/user-guide/ ./docs/user-guide/
# Founder kernel content — markdown sources + wiki pages + manifest +
# embeddings.jsonl sidecar — is read at seed time by seed-wiki-kernel.ts
# and exposed to the portal via /wiki and the wiki_query MCP tool. Without
# this COPY the seed silently throws ENOENT (swallowed by the entrypoint's
# `|| echo WARN`), the wiki_page table stays empty, and /wiki shows nothing.
# Trailing slash + glob-friendly path matches the founder-kernel layout
# (docs/founder-kernel/{manifest.json,wiki/,raw-sources/,embeddings.jsonl,…}).
COPY docs/founder-kernel/ ./docs/founder-kernel/
# IT4IT functional criteria workbook is read at seed time by
# seed-ea-reference-models.ts. The rest of docs/Reference/ is large
# binary content not needed in the image.
COPY docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx ./docs/Reference/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dpf/db exec prisma generate
# Generate capability snapshot from mcp-tools.ts (runs at build time; output bundled into runner)
RUN node packages/db/scripts/generate-tools-snapshot.js

# ─── Stage 5: runner (unified — serves app AND runs init) ─────────────────────
FROM base AS runner
LABEL org.opencontainers.image.title="Open Digital Product Factory"
LABEL org.opencontainers.image.description="Self-developing digital product management platform"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/OpenDigitalProductFactory/opendigitalproductfactory"
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
# All workspace packages are copied so @dpf/* symlinks in node_modules resolve.
# Without the full packages/ tree, seeds that import @dpf/storefront-templates
# (and any future workspace-dep seed) fail to resolve and either throw or
# silently skip depending on the call site.
COPY --from=init /app/packages ./packages
COPY --from=init /app/node_modules ./node_modules
COPY --from=init /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json /app/tsconfig.base.json /app/.gitignore ./
COPY --from=init /app/scripts ./scripts
COPY --from=init /app/docs/user-guide ./docs/user-guide
COPY --from=init /app/docs/founder-kernel ./docs/founder-kernel
COPY --from=init /app/prompts ./prompts
COPY --from=init /app/skills ./skills
# Deliberation pattern sources must reach the runtime image too — the seed
# runs in this unified runner stage at boot, reading /app/deliberation.
COPY --from=init /app/deliberation ./deliberation
COPY --from=init /app/docs/Reference ./docs/Reference
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Source for Build Studio — copied to -src paths to avoid collision with standalone output
# Note: /app/apps/web/ and /app/packages/ are occupied by the standalone NFT output.
# The -src suffix paths are guaranteed free.
COPY --from=init /app/apps/web/ ./apps/web-src/
COPY --from=init /app/packages/ ./packages-src/
RUN rm -rf /app/apps/web-src/.next \
           /app/apps/web-src/tsconfig.tsbuildinfo \
           /app/packages-src/db/generated

# Canonical platform version (Phase 1 of governed-upgrade lifecycle).
# Hand-edited until Phase 2 CI bump automation lands. Read at boot by
# /api/platform/version and surfaced in /ops/self-upgrade.
# Deliberate cache boundary: a version bump invalidates this layer (and
# everything below) so the runtime image carrying platform metadata is
# rebuilt whenever the declared version changes.
# See docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md §4.1, §4.2.
COPY version.json ./version.json

# Source content hash — ALWAYS computed from the bundled source bytes,
# independent of the DPF_VERSION label. This is the honest fingerprint of what
# actually went into the image: the self-upgrade promoter compares it between
# the freshly built image and the recreated container (content-verify guard),
# and it is the fallback identity when no explicit version is supplied.
# Decoupling it from DPF_VERSION is the fix for BI-C8E90A79 — a stamped label
# can no longer mask which source was built. Exclusions keep it reproducible
# across builds of the same source (node_modules / .next / generated / tsbuildinfo).
RUN (find /app/apps/web-src /app/packages-src /app/scripts -type f \
      -not -path '*/node_modules/*' \
      -not -path '*/.pnpm-store/*' \
      -not -path '*/.next/*' \
      -not -path '*/generated/*' \
      -not -name '*.tsbuildinfo' \
      -exec sha256sum {} +; \
     sha256sum /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json /app/tsconfig.base.json /app/.gitignore) \
      | sort -k 2 | sha256sum | cut -d ' ' -f 1 > /app/.dpf-source-content-hash

# Operator-facing image version baked in at build time. The explicit
# DPF_VERSION (a git SHA when built via scripts/build-images.{ps1,sh} or the
# promoter) when supplied, else the source content hash so managed /workspace
# volumes can still detect that the image source changed during local dev builds.
ARG DPF_VERSION=
RUN if [ -n "$DPF_VERSION" ]; then \
      echo "$DPF_VERSION" > /app/.dpf-image-version; \
    else \
      cp /app/.dpf-source-content-hash /app/.dpf-image-version; \
    fi

# Build timestamp (UTC, ISO-8601), surfaced alongside the source identity in
# /ops/self-upgrade so operators can see when the running image was produced,
# independent of the static version.json baseline.
RUN date -u +%Y-%m-%dT%H:%M:%SZ > /app/.dpf-image-built-at

# Promoter build context (autonomous deployment pipeline)
# These files let the portal build the dpf-promoter image on first use.
COPY Dockerfile.promoter /promoter/Dockerfile.promoter
COPY scripts/promote.sh /promoter/promote.sh
COPY Dockerfile /promoter/portal.Dockerfile
RUN chmod +x /promoter/promote.sh

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
