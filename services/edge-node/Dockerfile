# DPF Edge Node — multi-arch container image (linux/amd64 + linux/arm64).
#
# Spec:    docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
# Roadmap: docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md A3
#
# Phase 0 deployment mode: container with `network_mode: host` (Linux only).
# macOS / Windows native binary modes ship in T3 (Mode 4 Go binary).
#
# Node 24 — same major as the rest of the DPF stack so undici@8 works
# (markAsUncloneable was added in Node 22).

FROM node:24-alpine AS build
WORKDIR /app

# Workspace skeleton — pnpm needs to see pnpm-workspace.yaml + the
# root package.json + lockfile to resolve `workspace:*` protocols.
# PR #853 (SNMP ifTable / LLDP) introduced @dpf/validators as a direct
# dependency of services/edge-node, so the workspace context has to
# come along; we can no longer install from just the edge-node
# package.json.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# patchedDependencies in pnpm-workspace.yaml makes patches/ an INPUT to the
# install, not an optional extra: pnpm hashes every referenced patch file
# while resolving, so a missing one is a hard ENOENT rather than a skipped
# patch. PR #4321 (image-size ICNS fix, CVE-2025-71330) added this repo's
# first patched dependency and broke the edge-node image on exactly that.
# Copy the whole directory — it is a handful of KB, and scoping it to
# today's single patch would re-break the next time one is added.
COPY patches ./patches

# Every workspace package edge-node depends on (transitively). Today
# that's @dpf/validators only; add more here if the dep tree grows.
COPY packages/validators ./packages/validators

# Edge-node's own package metadata. Source comes AFTER deps install so
# source edits don't bust the install layer (Docker layer caching).
COPY services/edge-node/package.json services/edge-node/tsconfig.json ./services/edge-node/

# Filter narrows the install to just dpf-edge-node + its workspace
# transitive deps (`...` suffix). --ignore-scripts skips esbuild's
# postinstall (only used by tsx / vitest devDeps that the runtime
# image doesn't consume).
RUN corepack enable && pnpm install --filter dpf-edge-node... \
    --no-frozen-lockfile --ignore-scripts

COPY services/edge-node/src ./services/edge-node/src
RUN pnpm --filter dpf-edge-node build

# pnpm deploy bundles the edge-node package + all its dependencies
# (workspace and external alike) into a single self-contained
# directory with REAL files in node_modules — no symlinks back into
# /app/packages, no workspace context required at runtime. The
# runner stage just copies /app/deploy/edge-node and runs it.
RUN pnpm deploy --filter dpf-edge-node --prod --legacy --ignore-scripts /app/deploy/edge-node
# pnpm deploy --prod strips devDependencies but ALSO doesn't include
# our just-built dist/. Copy it in explicitly.
RUN cp -r /app/services/edge-node/dist /app/deploy/edge-node/dist

FROM node:24-alpine AS runner

# Discovery collector dependencies:
#
# - nmap            C2's active subnet sweep. Uses ARP requests when
#                   CAP_NET_RAW is granted (docker-compose.edge*.yml
#                   grants it on Linux); falls back to TCP connect
#                   probes otherwise.
# - net-snmp-tools  C3's network-device poll. Ships snmpget/snmpwalk
#                   with v2c + v3 support. No daemon, no listener —
#                   the binaries are invoked per query.
RUN apk add --no-cache nmap net-snmp-tools

# Phase 0 runs as a non-root user. The container needs no special
# capabilities for the Phase 0 collector set; future collectors that
# need CAP_NET_RAW are granted via docker-compose.edge*.yml.
RUN addgroup -S dpf && adduser -S -G dpf -u 10001 dpf
WORKDIR /app
# Self-contained deploy from pnpm — includes the edge-node package
# metadata, its dist/, and node_modules with @dpf/validators inlined
# as a real copy (no workspace symlinks). One directory, runtime-ready.
COPY --from=build /app/deploy/edge-node/ ./
# Bundled IEEE OUI dataset (~1.2 MB, ~39k entries). lib/mac-oui.ts
# reads this lazily on the first ARP enrichment lookup. Sourced from
# the build context rather than the deploy/ directory — pnpm deploy
# only includes files referenced by the package, not the bundled data.
COPY services/edge-node/data ./data

# State directory; mounted as a volume in docker-compose.edge.yml
# (A6) so the node token survives container restarts.
RUN mkdir -p /var/lib/dpf-edge-node && chown -R dpf:dpf /var/lib/dpf-edge-node
ENV DPF_EDGE_STATE_DIR=/var/lib/dpf-edge-node
USER dpf

ENTRYPOINT ["node", "dist/index.js"]
