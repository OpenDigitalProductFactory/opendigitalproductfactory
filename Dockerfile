# ─── Stage 1: base ────────────────────────────────────────────────────────────
# Cache bust: 2026-04-09-ideate-dispatch
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app

# ─── Dev stage (parallel branch — not part of production chain) ──────────────
FROM base AS dev
WORKDIR /workspace
RUN apk add --no-cache git postgresql16-client
# BI-0DF1F354: bake preflight + entrypoint into the IMAGE. The primary failure
# mode is a deleted/empty bind mount — the worktree copy of this script is not
# available then, so it must not live only under /workspace.
COPY scripts/lib/dev-portal-workspace-preflight.mjs /usr/local/bin/dev-portal-workspace-preflight.mjs
COPY scripts/lib/dev-portal-entrypoint.sh /usr/local/bin/dev-portal-entrypoint.sh
RUN chmod +x /usr/local/bin/dev-portal-entrypoint.sh
# Entrypoint: preflight fails non-zero on missing workspace → exit 0 without pnpm
# (see planDevPortalBoot). Healthy workspace → pnpm install + next dev.
CMD ["/usr/local/bin/dev-portal-entrypoint.sh"]

# ─── Stage 2: deps ────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY patches/ ./patches/
# set-hooks-path runs as the root postinstall during `pnpm install` below, and
# it imports resolveHooksDir from scripts/lib/hooks-dir.mjs (BI-5CBDC146). The
# lib must land with it or the postinstall throws ERR_MODULE_NOT_FOUND and the
# whole image build fails.
COPY scripts/set-hooks-path.mjs ./scripts/
COPY scripts/lib/hooks-dir.mjs ./scripts/lib/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/db/prisma/schema ./packages/db/prisma/schema
COPY packages/db/prisma.config.ts ./packages/db/
COPY packages/db/src/load-env.ts ./packages/db/src/
# EVERY workspace importer that later stages COPY into the image must have its
# manifest here, so this cached layer fetches its deps into the pnpm store.
# Otherwise the stage-3/4 `pnpm install` (re-run on every source change) fetches
# the missing packages from the registry on EVERY build, and a single transient
# registry failure fails the whole self-upgrade (SUR-73668D5C: 6-minute retry
# on smol-toml, the one dep unique to packages/dpf-bootstrap).
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/coworker-sim-harness/package.json ./packages/coworker-sim-harness/
COPY packages/dpf-bootstrap/package.json ./packages/dpf-bootstrap/
COPY packages/finance-templates/package.json ./packages/finance-templates/
COPY packages/integration-shared/package.json ./packages/integration-shared/
COPY packages/storefront-templates/package.json ./packages/storefront-templates/
COPY packages/types/package.json ./packages/types/
COPY packages/validators/package.json ./packages/validators/
# pnpm-workspace.yaml `patchedDependencies` names patch files by repo-relative
# path. pnpm resolves them against the workspace root, so every stage that runs
# `pnpm install` needs them in the build context — without this COPY the install
# exits 254 with ENOENT on the patch file (SUR-8AB3353C, regression from #4321).
# The `build` and `init` stages are FROM deps and share WORKDIR /app, so they
# inherit /app/patches from this layer; only the runner stage needs its own copy.
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile

# ─── Stage 3: build ───────────────────────────────────────────────────────────
FROM deps AS build
# Copy source EXCLUDING pnpm-lock.yaml (preserve the deps stage lockfile which has no expo entries)
COPY pnpm-workspace.yaml tsconfig.base.json .gitignore ./
COPY scripts/set-hooks-path.mjs ./scripts/
COPY scripts/lib/hooks-dir.mjs ./scripts/lib/
COPY scripts/capability-service-catalog.generated.json ./scripts/
COPY scripts/lib/capability-service-projection.mjs ./scripts/lib/
COPY scripts/lib/capability-state-hash.mjs ./scripts/lib/
COPY scripts/lib/transition-signing.mjs ./scripts/lib/
COPY scripts/installer/resolve-host-identity.mjs ./scripts/installer/
COPY scripts/installer/local-model-policy.json ./scripts/installer/
COPY apps/web/ ./apps/web/
COPY packages/ ./packages/
COPY docs/professions/ ./docs/professions/
# Root-level config data statically imported at build time — e.g.
# apps/web/lib/build/seed-contribution-fit.ts imports
# ../../../../config/seed-content-paths.json. Without this COPY the Next.js build
# fails "Module not found" inside the image even though plain `next build` (CI)
# passes, because CI builds the full checkout while the image build only sees this
# narrow allowlist. This detonated self-upgrade SUR-BCFB72BB (BI-062CFB41); the
# dockerfile-build-context.guard.test.ts guard now fails CI if any build-time
# import escapes into a repo dir this stage doesn't COPY. Mirrors docs/professions.
COPY config/ ./config/
COPY docker-entrypoint.sh ./
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dpf/db exec prisma generate
# Next.js 16.2.7 minify-webpack-plugin crashes with "_webpack.WebpackError is
# not a constructor" when --webpack is forced. Use the default builder (Turbopack
# in Next 16, gated in next.config.mjs) which does not trigger the broken plugin.
# Re-evaluate --webpack on next version bump.
RUN NODE_OPTIONS="--max-old-space-size=8192" NEXT_TELEMETRY_DISABLED=1 pnpm --filter web exec next build

# ─── Stage 4: init (build source for migrations, seed, Prisma client) ─────────
FROM deps AS init
COPY pnpm-workspace.yaml tsconfig.base.json .gitignore ./
COPY docker-compose.yml docker-compose.release.yml docker-compose.pki.yml docker-compose.organization-trust.yml docker-compose.tls.yml docker-compose.edge-actions.yml ./
# The install docs tell operators to run these (docs/install/linux.md,
# docs/install/cloud-single-vm.md), and a consumer install has no git checkout, so they
# must ship in the bundle or the documented uninstall fails 'file not found' on every
# Ready-to-go install. Both halves are required: this COPY and the cp below (IMP-043).
COPY uninstall-dpf.sh uninstall-dpf.ps1 uninstall-dpf.bat ./
COPY scripts/pki/edge-client.tpl ./scripts/pki/
COPY scripts/set-hooks-path.mjs ./scripts/
COPY scripts/lib/resolve-capability-compose-profiles.mjs ./scripts/lib/
COPY scripts/lib/govern-capability-compose-args.mjs ./scripts/lib/
COPY scripts/lib/capability-state-hash.mjs ./scripts/lib/
# apps/web-src is copied from this stage into the runner for Build Studio's
# first-install sandbox. Keep every repo-relative import used by that source in
# the same source bundle; otherwise the production portal can be healthy while
# the sandbox's `next dev` exits with "Module not found".
COPY scripts/lib/capability-service-projection.mjs ./scripts/lib/
COPY scripts/lib/transition-signing.mjs ./scripts/lib/
COPY scripts/installer/resolve-host-identity.mjs ./scripts/installer/
COPY scripts/installer/local-model-policy.json ./scripts/installer/
COPY scripts/capability-service-catalog.generated.json ./scripts/
COPY scripts/installer/validate-install-state.mjs ./scripts/installer/
COPY scripts/installer/install-state-transaction.mjs ./scripts/installer/
COPY scripts/installer/install-release-assets.mjs ./scripts/installer/
COPY scripts/installer/install-state-lock-contract.json ./scripts/installer/
COPY scripts/installer/install-state-schema-registry.mjs ./scripts/installer/
COPY scripts/installer/install-state.schema.json ./scripts/installer/
COPY scripts/installer/install-state.v1.schema.json ./scripts/installer/
COPY scripts/installer/install-state.v2.schema.json ./scripts/installer/
COPY scripts/installer/native-edge-host.ps1 ./scripts/installer/
COPY scripts/bootstrap-organization-pki.ps1 ./scripts/
COPY scripts/installer/lib/state.ps1 ./scripts/installer/lib/
COPY scripts/installer/lib/compose-chain.ps1 ./scripts/installer/lib/
# The consumer installer copies the kernel-commandment shell guard out of the
# install dir, which on that path IS the release-asset bundle. The init stage
# COPYs each asset explicitly, so the guard must be pulled in here before the
# bundle-assembly RUN can cp it.
COPY scripts/safety/dpf-shell-guard.ps1 scripts/safety/dpf-shell-guard.sh \
     scripts/safety/dpf-shell-guard-fallback-patterns.json \
     scripts/safety/pre-destructive-snapshot.ps1 scripts/safety/pre-destructive-snapshot.sh \
     ./scripts/safety/
COPY monitoring/ ./monitoring/
COPY scripts/backup-postgres.sh ./scripts/
COPY scripts/restore-postgres.sh ./scripts/
COPY scripts/postgres-trial-restore.sh ./scripts/
COPY scripts/salvage-sweep.mjs ./scripts/
# Work Capsule change-impact planning executes the canonical gate-context CLI
# at runtime. Package its exact transitive source closure into the image so a
# mutable /host-dpf checkout can never substitute different rule bytes.
COPY scripts/gate-context.mjs ./scripts/
COPY scripts/check-design-grounding-decision.mjs ./scripts/
COPY scripts/check-data-impact.mjs ./scripts/
COPY scripts/lib/gate-context.mjs ./scripts/lib/
COPY scripts/lib/ci-evidence-plan.mjs ./scripts/lib/
COPY scripts/lib/derived-artifacts-registry.mjs ./scripts/lib/
COPY scripts/lib/gate-sensitivity.mjs ./scripts/lib/
COPY scripts/lib/seed-fit-gate.mjs ./scripts/lib/
COPY scripts/lib/pr-trailer-contract.mjs ./scripts/lib/
COPY scripts/lib/module-size-scope.mjs ./scripts/lib/
COPY scripts/lib/ci-policy-guards.mjs ./scripts/lib/
COPY scripts/lib/host-command-invocation.mjs ./scripts/lib/
COPY scripts/lib/git-fetch-shared-safe.mjs ./scripts/lib/
COPY scripts/lib/entry-module.mjs ./scripts/lib/
COPY scripts/module-size-baseline.txt ./scripts/
COPY scripts/prose-lint-baseline.json ./scripts/
COPY scripts/style-drift-baseline.json ./scripts/
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
# Profession registry — JSON data consumed at build time by
# lib/decision-perspective/resolve-profession-profile.ts (WSID/EP-WSID corpus).
# Without this COPY the Next.js build fails: "Cannot find module docs/professions/registry.json".
COPY docs/professions/ ./docs/professions/
# Root-level config data statically imported by the tool graph loaded at build
# time here — generate-tools-snapshot.js → mcp-tools.ts → contribution-review.ts
# → seed-contribution-fit.ts → config/seed-content-paths.json. Mirrors the build
# stage; see the dockerfile-build-context guard note there.
COPY config/ ./config/
# IT4IT functional criteria workbook is read at seed time by
# seed-ea-reference-models.ts. The rest of docs/Reference/ is large
# binary content not needed in the image.
COPY docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx ./docs/Reference/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dpf/db exec prisma generate
# Generate capability snapshot from mcp-tools.ts (runs at build time; output bundled into runner)
RUN node packages/db/scripts/generate-tools-snapshot.js
RUN mkdir -p /dpf-release-assets/scripts/lib /dpf-release-assets/scripts/installer/lib \
      /dpf-release-assets/monitoring && \
    cp docker-compose.yml docker-compose.release.yml docker-compose.pki.yml docker-compose.organization-trust.yml docker-compose.tls.yml docker-compose.edge-actions.yml /dpf-release-assets/ && \
    mkdir -p /dpf-release-assets/scripts/pki && cp scripts/pki/edge-client.tpl /dpf-release-assets/scripts/pki/ && \
    cp uninstall-dpf.sh uninstall-dpf.ps1 uninstall-dpf.bat /dpf-release-assets/ && \
    cp scripts/bootstrap-organization-pki.ps1 /dpf-release-assets/scripts/ && \
    cp scripts/lib/resolve-capability-compose-profiles.mjs scripts/lib/govern-capability-compose-args.mjs scripts/lib/capability-state-hash.mjs /dpf-release-assets/scripts/lib/ && \
    cp scripts/capability-service-catalog.generated.json /dpf-release-assets/scripts/ && \
    cp scripts/installer/local-model-policy.json /dpf-release-assets/scripts/installer/ && \
    cp scripts/installer/validate-install-state.mjs /dpf-release-assets/scripts/installer/ && \
    cp scripts/installer/install-state-transaction.mjs scripts/installer/install-release-assets.mjs scripts/installer/install-state-lock-contract.json /dpf-release-assets/scripts/installer/ && \
    cp scripts/installer/install-state-schema-registry.mjs /dpf-release-assets/scripts/installer/ && \
    cp scripts/installer/install-state.schema.json /dpf-release-assets/scripts/installer/ && \
    cp scripts/installer/install-state.v1.schema.json /dpf-release-assets/scripts/installer/ && \
    cp scripts/installer/install-state.v2.schema.json /dpf-release-assets/scripts/installer/ && \
    cp scripts/installer/native-edge-host.ps1 /dpf-release-assets/scripts/installer/ && \
    cp scripts/installer/lib/state.ps1 scripts/installer/lib/compose-chain.ps1 /dpf-release-assets/scripts/installer/lib/ && \
    cp config/consumer-install/agent-pointer.md /dpf-release-assets/AGENTS.md && \
    mkdir -p /dpf-release-assets/scripts/safety && \
    cp scripts/safety/dpf-shell-guard.ps1 scripts/safety/dpf-shell-guard.sh \
       scripts/safety/dpf-shell-guard-fallback-patterns.json \
       scripts/safety/pre-destructive-snapshot.ps1 scripts/safety/pre-destructive-snapshot.sh \
       /dpf-release-assets/scripts/safety/ && \
    cp -R monitoring/. /dpf-release-assets/monitoring/ && \
    cd /dpf-release-assets && \
    find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS

# ─── Stage 5: runner (unified — serves app AND runs init) ─────────────────────
FROM base AS runner
LABEL org.opencontainers.image.title="Open Digital Product Factory"
LABEL org.opencontainers.image.description="Self-developing digital product management platform"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/OpenDigitalProductFactory/opendigitalproductfactory"
WORKDIR /app
# nmap powers the fast path of the arp_scan discovery collector. Without it the
# collector falls back to a 254-host ping sweep; with it a /24 scans in seconds.
# (See packages/db/src/discovery-collectors/arp-scan.ts — BI-4CA890B7.)
RUN apk add --no-cache docker-cli docker-cli-buildx docker-cli-compose postgresql16-client git curl nmap
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
# The workspace bootstrap in docker-entrypoint.sh copies these root manifests to
# /workspace and runs `pnpm install` there. pnpm-workspace.yaml carries the
# `patchedDependencies` directive, so the patch files must travel with it or that
# runtime install fails the same way the image build did (SUR-8AB3353C).
COPY --from=init /app/patches ./patches
COPY --from=init /app/scripts ./scripts
# Checked-in registries read by the packaged gate-context generator. Preserve
# their repository-relative paths because the generator is also the CLI source
# of truth and deliberately has no portal-only path branch.
COPY --from=init /app/config/ci-evidence-policy.json ./config/
COPY --from=init /app/config/seed-content-paths.json ./config/
COPY --from=init /app/apps/web/lib/ux-budget/route-budget-baseline.json ./apps/web/lib/ux-budget/
COPY --from=init /dpf-release-assets /dpf-release-assets
# Managed operational scripts (backup/restore/trial-restore) are invoked at
# runtime by the backup runners. They are committed from a Windows checkout,
# where git cannot store the Unix executable bit, so they land here as 0644.
# The runners now invoke them via `/bin/sh <script>` (executable-bit
# independent), but restore the bit anyway as defense in depth so any direct
# exec — here or in a future call site — still works. chmod only touches the
# mode, not file content, so the source-content-hash below is unaffected.
RUN chmod +x ./scripts/*.sh
COPY --from=init /app/docs/user-guide ./docs/user-guide
COPY --from=init /app/docs/founder-kernel ./docs/founder-kernel
COPY --from=init /app/docs/professions ./docs/professions
COPY --from=init /app/prompts ./prompts
COPY --from=init /app/skills ./skills
# Deliberation pattern sources must reach the runtime image too — the seed
# runs in this unified runner stage at boot, reading /app/deliberation.
COPY --from=init /app/deliberation ./deliberation
COPY --from=init /app/docs/Reference ./docs/Reference
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
# BI-5322D025: the portal self-migrates on boot (see script header). Absolute
# path so it is invoked directly, not shadowed by the Node base image's
# /usr/local/bin/docker-entrypoint.sh passthrough.
COPY scripts/portal-migrate-boot.sh /usr/local/bin/portal-migrate-boot.sh
RUN chmod +x /usr/local/bin/portal-migrate-boot.sh

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
RUN (find /app/apps/web-src /app/packages-src /app/scripts /app/config /app/docs/professions /app/patches -type f \
      -not -path '*/node_modules/*' \
      -not -path '*/.pnpm-store/*' \
      -not -path '*/.next/*' \
      -not -path '*/generated/*' \
      -not -name '*.tsbuildinfo' \
      -exec sha256sum {} +; \
     sha256sum /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json /app/tsconfig.base.json /app/.gitignore /app/version.json) \
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

# Real platform version from the repo's git release tags (git describe),
# supplied by the build (scripts/build-images.*, installer, CI, promoter).
# When set, this is the authoritative version shown in the portal — version.json
# is only a dev fallback. Leading "v" is normalized at read time.
ARG DPF_PLATFORM_VERSION=
RUN if [ -n "$DPF_PLATFORM_VERSION" ]; then \
      echo "$DPF_PLATFORM_VERSION" > /app/.dpf-platform-version; \
    fi

# Promoter build context (autonomous deployment pipeline)
# These files let the portal build the dpf-promoter image on first use.
COPY Dockerfile.promoter /promoter/Dockerfile.promoter
COPY promoter-contract.json /promoter/promoter-contract.json
COPY scripts/promote.sh /promoter/scripts/promote.sh
COPY scripts/governed-teardown.mjs /promoter/scripts/governed-teardown.mjs
COPY scripts/salvage-sweep.mjs /promoter/scripts/salvage-sweep.mjs
COPY Dockerfile /promoter/Dockerfile
COPY scripts/apply-runtime-capability-transition.mjs /promoter/scripts/apply-runtime-capability-transition.mjs
COPY scripts/runtime-transition-authority.mjs /promoter/scripts/runtime-transition-authority.mjs
COPY scripts/rotate-runtime-transition-secret.mjs /promoter/scripts/rotate-runtime-transition-secret.mjs
COPY scripts/lib/transition-signing.mjs /promoter/scripts/lib/transition-signing.mjs
COPY scripts/promoter-migration-envelope.mjs /promoter/scripts/promoter-migration-envelope.mjs
COPY scripts/installer/validate-install-state.mjs /promoter/scripts/installer/validate-install-state.mjs
COPY scripts/installer/install-state-transaction.mjs /promoter/scripts/installer/install-state-transaction.mjs
COPY scripts/installer/install-release-assets.mjs /promoter/scripts/installer/install-release-assets.mjs
COPY scripts/installer/install-state-lock-contract.json /promoter/scripts/installer/install-state-lock-contract.json
COPY scripts/installer/migrate-install-state.mjs /promoter/scripts/installer/migrate-install-state.mjs
COPY scripts/installer/resolve-host-identity.mjs /promoter/scripts/installer/resolve-host-identity.mjs
COPY scripts/installer/install-state-schema-registry.mjs /promoter/scripts/installer/install-state-schema-registry.mjs
COPY scripts/installer/install-state.schema.json /promoter/scripts/installer/install-state.schema.json
COPY scripts/installer/install-state.v1.schema.json /promoter/scripts/installer/install-state.v1.schema.json
COPY scripts/installer/install-state.v2.schema.json /promoter/scripts/installer/install-state.v2.schema.json
COPY scripts/lib/resolve-capability-compose-profiles.mjs /promoter/scripts/lib/resolve-capability-compose-profiles.mjs
COPY scripts/lib/govern-capability-compose-args.mjs /promoter/scripts/lib/govern-capability-compose-args.mjs
COPY scripts/lib/capability-state-hash.mjs /promoter/scripts/lib/capability-state-hash.mjs
COPY scripts/capability-service-catalog.generated.json /promoter/scripts/capability-service-catalog.generated.json

EXPOSE 3000
# Self-upgrade image-identity guard (BI-5B6C1C35, spec §4.3): the running portal
# must carry the identity of the bytes it contains. Compose resolves
# `DEPLOYED_SHA: ${DEPLOYED_SHA:-${DPF_VERSION:-}}` from the SHELL env at
# `up` time, which is empty on a normal install/restart (neither var is exported)
# — leaving `printenv DEPLOYED_SHA` blank on the Live portal and silencing the
# only env-level drift signal. The image already bakes its true identity into
# /app/.dpf-image-version (the DPF_VERSION git SHA when promoted, else the source
# content hash); seed DEPLOYED_SHA from that baked file whenever the env is unset
# so the runtime always reports the identity of its own bytes regardless of how
# it was started. An explicit DEPLOYED_SHA from the deploy pipeline still wins.
# BI-5322D025: portal-migrate-boot.sh applies pending migrations from THIS
# image's bytes before exec'ing the server, so a self-upgrade swap (or any
# restart) can never leave the DB drifted. It is fail-closed: if migrations
# can't apply, the portal does not start. portal-init is unaffected — it
# overrides CMD with /docker-entrypoint.sh.
CMD ["/usr/local/bin/portal-migrate-boot.sh", "sh", "-c", "if [ -z \"$DEPLOYED_SHA\" ] && [ -s /app/.dpf-image-version ]; then DEPLOYED_SHA=\"$(tr -d '[:space:]' < /app/.dpf-image-version)\"; export DEPLOYED_SHA; fi; exec node apps/web/server.js"]
