# ADP MCP server — standalone Node 24 service.
# The runtime ships as its own container and consumes packages/integration-shared.
#
# Node 24 is required: undici@8.x calls webidl.util.markAsUncloneable, which
# was added in Node 22. Keep this aligned with the portal/promoter/sandbox
# images so a single Node major governs the whole stack.
#
# Installs from the workspace lockfile, as services/edge-node does. It used to
# run `pnpm install --no-frozen-lockfile` against the two package.json files
# alone, which resolved whatever the registry held at build time: no lockfile,
# no overrides, no release-age floor, and runtime versions (undici, zod) the
# SBOM never listed (plan 2026-09-08 S12).

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Workspace skeleton: the lockfile and pnpm-workspace.yaml (overrides,
# minimumReleaseAge, patchedDependencies) govern this install. pnpm hashes
# every referenced patch while resolving, so patches/ must be present.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY patches ./patches
COPY packages/integration-shared ./packages/integration-shared
COPY services/adp/package.json services/adp/tsconfig.json ./services/adp/
RUN pnpm install --filter dpf-adp-mcp... --frozen-lockfile --ignore-scripts

# integration-shared exports its TypeScript source with extensionless relative
# re-exports, which the web app's Turbopack build needs. Node can load neither
# from node_modules. prepare-dist points the manifest (main, types, exports)
# at the compiled dist/ and completes its relative specifiers. The previous
# inline rewrite covered only main/types, so the server failed at import
# (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING, then ERR_MODULE_NOT_FOUND).
WORKDIR /app/packages/integration-shared
RUN pnpm build && node scripts/prepare-dist.mjs

WORKDIR /app
COPY services/adp/src ./services/adp/src
RUN pnpm --filter dpf-adp-mcp build

# Self-contained runtime directory with real files and production deps only
# (integration-shared inlined with its dist/). allowUnusedPatches is scoped to
# this command: the pruned subgraph cannot contain the patched packages, which
# belong to other workspaces.
RUN pnpm --config.allowUnusedPatches=true deploy \
    --filter dpf-adp-mcp --prod --legacy --ignore-scripts /app/deploy/adp \
  && cp -r /app/services/adp/dist /app/deploy/adp/dist

# Fail the image build, not the first container start, if the runtime tree
# cannot load: import every compiled module that reaches integration-shared.
WORKDIR /app/deploy/adp
RUN node -e "Promise.all(['./dist/lib/creds.js', './dist/lib/crypto.js', './dist/lib/redact.js'].map((m) => import(m))).then(() => console.log('adp runtime imports OK'))"

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/deploy/adp/ ./
USER node
EXPOSE 8600
CMD ["node", "dist/server.js"]
