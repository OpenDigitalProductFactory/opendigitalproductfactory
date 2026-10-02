# Integration test harness: fake vendor servers for the integration e2e suites.
#
# Installs from the workspace lockfile, as services/edge-node does. It used to
# run a bare `pnpm install` against this package.json alone, which resolved
# whatever the registry held at build time: no lockfile, no overrides, no
# release-age floor, and versions the SBOM never listed (plan 2026-09-08 S12).

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Workspace skeleton: the lockfile and pnpm-workspace.yaml (overrides,
# minimumReleaseAge, patchedDependencies) govern this install. pnpm hashes
# every referenced patch while resolving, so patches/ must be present.
#
# The root .npmrc is NOT copied, on purpose. It sets node-linker=hoisted,
# and under the hoisted linker the legacy `pnpm deploy` below skips the
# lockfile and resolves every range afresh from the registry. The
# isolated default makes the deploy read the lockfile. The assertion
# after the deploy fails the build if that ever stops being true.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY patches ./patches
COPY services/integration-test-harness/package.json services/integration-test-harness/tsconfig.json ./services/integration-test-harness/
RUN pnpm install --filter dpf-integration-test-harness... --frozen-lockfile --ignore-scripts

COPY services/integration-test-harness/src ./services/integration-test-harness/src
COPY services/integration-test-harness/vendors ./services/integration-test-harness/vendors
RUN pnpm --filter dpf-integration-test-harness build

# Self-contained runtime directory with real files and production deps only.
# allowUnusedPatches is scoped to this command: the pruned subgraph cannot
# contain the patched packages, which belong to other workspaces.
RUN pnpm --config.allowUnusedPatches=true deploy \
    --filter dpf-integration-test-harness --prod --legacy --ignore-scripts /app/deploy/harness \
  && cp -r /app/services/integration-test-harness/dist /app/deploy/harness/dist

# Fail the image build if the deploy tree ships anything the lockfile did
# not lock (see the .npmrc note above).
COPY scripts/lib/pnpm-lock.mjs ./scripts/lib/
COPY scripts/sbom/runtime-surface.mjs scripts/sbom/assert-deploy-matches-lockfile.mjs ./scripts/sbom/
RUN node scripts/sbom/assert-deploy-matches-lockfile.mjs \
    --root /app --importer services/integration-test-harness --deploy /app/deploy/harness

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/deploy/harness/ ./
COPY services/integration-test-harness/vendors ./dist/vendors
USER node
EXPOSE 8700
CMD ["node", "dist/src/harness.js"]
