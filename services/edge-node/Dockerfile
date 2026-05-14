# DPF Edge Node — multi-arch container image (linux/amd64 + linux/arm64).
#
# Spec:    docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
# Roadmap: docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md A3
#
# Phase 0 deployment mode: container with `network_mode: host` (Linux only).
# macOS / Windows native binary modes ship in T3.
#
# Node 24 — same major as the rest of the DPF stack so undici@8 works
# (markAsUncloneable was added in Node 22).

FROM node:24-alpine AS build
WORKDIR /app/services/edge-node
COPY services/edge-node/package.json services/edge-node/tsconfig.json ./
RUN corepack enable && pnpm install --no-frozen-lockfile
COPY services/edge-node/src ./src
RUN pnpm build

FROM node:24-alpine AS runner

# Discovery collector dependencies:
#
# - nmap     C2's active subnet sweep. Uses ARP requests when
#            CAP_NET_RAW is granted (docker-compose.edge*.yml grants
#            it on Linux); falls back to TCP connect probes otherwise.
#
# Future collectors will add `arp-scan` (alternative ARP-request
# probe) and SNMP tooling — held off until those collectors land so
# the image surface stays small.
RUN apk add --no-cache nmap

# Phase 0 runs as a non-root user. The container needs no special
# capabilities for the Phase 0 collector set (ip addr, docker ps, ss
# from outside the host? - actually Phase 0 collectors live in A5; A3
# only needs network egress to the Authority).
RUN addgroup -S dpf && adduser -S -G dpf -u 10001 dpf
WORKDIR /app
COPY services/edge-node/package.json ./package.json
COPY --from=build /app/services/edge-node/dist ./dist
COPY --from=build /app/services/edge-node/node_modules ./node_modules

# State directory; mounted as a volume in docker-compose.edge.yml
# (A6) so the node token survives container restarts.
RUN mkdir -p /var/lib/dpf-edge-node && chown -R dpf:dpf /var/lib/dpf-edge-node
ENV DPF_EDGE_STATE_DIR=/var/lib/dpf-edge-node
USER dpf

ENTRYPOINT ["node", "dist/index.js"]
