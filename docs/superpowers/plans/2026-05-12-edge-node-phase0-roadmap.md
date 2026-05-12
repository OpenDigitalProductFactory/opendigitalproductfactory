# DPF Edge Node — Phase 0 Roadmap

> **Status:** in-flight planning. This roadmap depends on the spec
> being implementation-ready
> ([`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../specs/2026-05-09-dpf-edge-node-design.md)
> — see PR landing the R&B pass + open-question resolutions).
> Implementation PRs do not land on `main` until heavy security
> review (the one remaining maturity gate on the spec) is complete.
>
> **Outcome this roadmap delivers:** one Edge Node, running on a
> separate host (or as a sibling container in the same compose
> project), enrolls itself against an Authority Core (the portal),
> runs periodic discovery sweeps, and the results land in Postgres
> + Neo4j with the `edgeNodeId` FK populated and visible in a
> portal Admin UI page.
>
> macOS native binary, multi-host real-LAN, mTLS hardening, and
> air-gapped operation are out of scope and ship in separate
> threads (T2–T5 prompts in the parent installer roadmap PR thread).

## Phase 0 scope (what "done" means)

End-to-end demo, locally reproducible:

```bash
# Authority Core
bash dpf-start.sh

# Authority operator opens Admin > Platform Development > Edge Nodes,
# clicks "Issue bootstrap token", copies the token (one-time, 15 min TTL).

# In a separate terminal, bring up the Edge Node sidecar:
docker compose -f docker-compose.edge.yml up -d \
  -e DPF_AUTHORITY_URL=http://host.docker.internal:3000 \
  -e DPF_BOOTSTRAP_TOKEN=<token>

# Within ~30s the Edge Node enrolls. Within ~1 min it submits its
# first discovery run.

# Verify in the portal:
#   Admin > Platform Development > Edge Nodes
#     - row exists, trustState=trusted, lastSeenAt within 60s
#     - one DiscoveryRun visible with edgeNodeId populated
#     - rows in DiscoveredItem / DiscoveredRelationship show the
#       edgeNodeId attribution
```

## Out of scope for Phase 0 (deferred per spec resolutions)

- macOS / Windows native binary modes
- Multi-host LAN deployment (Edge Node on a separate machine from Authority)
- mTLS — Phase 0 uses bearer-over-HTTPS; CSR field is reserved
- Auto-update — operator pulls new image and restarts
- Capabilities other than `discovery.network`
- Quarantine *automatic* triggers (manual quarantine works)
- MCP / A2A gateway capabilities
- `windows_exporter` / `node-exporter` retirement (parallel data path,
  not a replacement)

## Slice plan (10 PRs, one concern each per AGENTS.md §4)

Each slice opens a separate PR. Slices have explicit dependencies
listed; some can ship in parallel where the dependency graph allows.

### A1 — Prisma schema + PrincipalAlias linkage

**Files:**
- `packages/db/prisma/schema.prisma` — add `EdgeNode`, `BootstrapToken`,
  `EdgeNodeCapability` per spec § Edge Node registry. Add optional
  `edgeNodeId` FK on `DiscoveryRun`.
- `packages/db/prisma/migrations/<ts>_add_edge_node/migration.sql` —
  generated migration.
- `packages/db/src/edge-node-types.ts` — TypeScript types for the new
  models.
- `packages/db/src/edge-node-types.test.ts` — type-safety + invariant
  tests (e.g. `BootstrapToken.consumedAt` set ⇒ `consumedByEdgeNodeId`
  set).
- `packages/db/prisma/schema.prisma` — register `EdgeNode` as a
  `PrincipalAlias.kind = "edge_node"` per AGENTS.md §11
  principal-convergence rule.

**Exit:** `pnpm --filter @dpf/db typecheck` clean. `pnpm --filter
@dpf/db exec prisma migrate dev --name add_edge_node` succeeds locally.
Existing tests pass. New invariant tests pass.

**Depends on:** nothing.

### A2 — Authority API: enrollment + heartbeat + ingestion

**Files:**
- `apps/web/app/api/v1/edge/enroll/route.ts` —
  `POST /api/v1/edge/enroll`. Accepts bootstrap token; validates
  one-time consumption; mints `dpfedge_*` node token; returns
  `{ edgeNodeId, nodeToken, heartbeatIntervalSec, sweepIntervalSec }`.
- `apps/web/app/api/v1/edge/heartbeat/route.ts` —
  `POST /api/v1/edge/heartbeat`. Bearer auth. Updates `lastSeenAt`.
  Returns updated intervals + capability acceptance set.
- `apps/web/app/api/v1/edge/discovery-runs/route.ts` —
  `POST /api/v1/edge/discovery-runs`. Bearer auth. Validates
  envelope; calls `persistSubmittedDiscoveryRun` (added in A4).
- `apps/web/lib/auth/edge-node-token.ts` — bearer-token validation
  middleware. Hashes incoming token; lookup against
  `EdgeNode.tokenHash`; verifies `trustState IN ('pending','trusted')`
  per scope rules.
- `apps/web/lib/auth/edge-node-token.test.ts` — unit tests for the
  middleware (valid, expired, revoked, quarantined, scope mismatch).
- `apps/web/app/api/v1/edge/__tests__/*` — endpoint integration tests.

**Exit:** Endpoints return correct status codes for happy path +
error matrix. Unit tests cover token validation. Integration tests
cover the enroll → heartbeat → submit flow with a mocked DB.

**Depends on:** A1 (schema must exist).

### A3 — Edge Node service skeleton

**Files:**
- `services/edge-node/` — new directory.
- `services/edge-node/Dockerfile` — multi-stage (`node:24-alpine`
  builder + slim runtime). Multi-arch (`linux/amd64` + `linux/arm64`).
- `services/edge-node/package.json` — minimal dependencies (node-fetch,
  better-sqlite3, dotenv).
- `services/edge-node/tsconfig.json`.
- `services/edge-node/src/index.ts` — entry point. Loads config from
  env, kicks off enrollment if no node token cached, then heartbeat
  loop + sweep loop.
- `services/edge-node/src/config.ts` — env-var schema (`DPF_AUTHORITY_URL`,
  `DPF_BOOTSTRAP_TOKEN`, `DPF_EDGE_NODE_NAME`, `DPF_EDGE_STATE_DIR`).
- `services/edge-node/src/state.ts` — local state file at
  `${DPF_EDGE_STATE_DIR}/state.json` (0600 perms; per spec § Token
  namespaces and lifecycle the libsecret fallback for the Linux
  container case).
- `services/edge-node/src/enroll.ts` — POST to `/api/v1/edge/enroll`,
  persist node token + edgeNodeId + intervals.
- `services/edge-node/src/heartbeat.ts` — periodic POST to
  `/api/v1/edge/heartbeat`; honors Authority-returned intervals.
- `services/edge-node/src/__tests__/*` — unit tests against mocked
  Authority (httpmock).

**Exit:** `docker build -t dpf-edge-node:dev services/edge-node`
succeeds. Container starts, attempts enrollment against a stub
HTTP server, persists state, sends heartbeats. Unit tests pass.

**Depends on:** A2 (API contract must exist for the service to call).

### A4 — `persistSubmittedDiscoveryRun` + collector extraction

**Files:**
- `packages/db/src/discovery-collectors/network.ts` (existing) —
  extract its `collectNetworkDiscovery` shape into a host-runnable
  variant that doesn't depend on Prisma client (Edge Node imports
  this).
- `packages/db/src/discovery-collectors/host-runnable.ts` (new) —
  exports `collectHostNetwork()` and `collectHostDocker()` — pure
  functions returning a `CollectorOutput` shape.
- `packages/db/src/discovery-collectors/host-runnable.test.ts` —
  unit tests.
- `packages/db/src/persist-submitted-discovery-run.ts` (new) —
  `persistSubmittedDiscoveryRun({ edgeNodeId, agentMode,
  agentVersion, submittedOutput, trigger: "edge_node" })`. Sibling
  to existing `persistBootstrapDiscoveryRun`; takes a *prepared*
  observation set, normalizes, infers cross-collector relationships,
  persists to Postgres, projects to Neo4j.
- `packages/db/src/persist-submitted-discovery-run.test.ts` — covers
  envelope validation, idempotency on duplicate submissions
  (same `runId`), edgeNodeId attribution.

**Exit:** Submitted-observation path produces the same DB shape as
the bootstrap-discovery path, plus `edgeNodeId` attribution.
Bootstrap-discovery path unchanged.

**Depends on:** A1 (schema). Can ship in parallel with A2 / A3.

### A5 — Edge Node sweep + submission wiring

**Files:**
- `services/edge-node/src/sweep.ts` — periodic sweep loop. Calls
  `collectHostNetwork()` + `collectHostDocker()` from the shared
  package; bundles into a submission envelope; POSTs to
  `/api/v1/edge/discovery-runs`.
- `services/edge-node/src/buffer.ts` — local SQLite buffer per spec
  § S6. Bounded by 1000 sweeps OR 7 days; drop-oldest on overflow;
  exponential backoff retry (1s → 2s → 4s → ... cap 5 min).
- `services/edge-node/src/buffer.test.ts` — unit tests for buffer
  bounds + drop-oldest + retry behavior.

**Exit:** Edge Node submits one discovery run per `sweepIntervalSec`
(Authority-decided, default 5 min in dev). When Authority is
unreachable, submissions queue locally and replay on reconnect.

**Depends on:** A3 (service skeleton), A4 (collector extraction).

### A6 — `docker-compose.edge.yml` overlay + dev workflow

**Files:**
- `docker-compose.edge.yml` (new) — adds the `edge-node` service
  with `network_mode: host`, env-driven config, the multi-arch
  GHCR image reference + a `build: ./services/edge-node` block for
  dev-mode local builds.
- `.env.docker.example` — document `DPF_EDGE_AUTHORITY_URL`,
  `DPF_EDGE_BOOTSTRAP_TOKEN` placeholder names.
- `scripts/installer/lib/compose.sh` — extend `dpf_compose_files`
  to honor an optional extra-overlay flag for `docker-compose.edge.yml`.

**Exit:** `docker compose -f docker-compose.yml -f
docker-compose.linux.yml -f docker-compose.edge.yml config` renders.
Manual smoke: bring up portal + edge-node side-by-side in dev mode;
edge-node enrolls and submits within 60s.

**Depends on:** A3 (image builds), A5 (sweep/submission works end-to-end).

### A7 — Portal Admin UI: Edge Nodes settings page

**Files:**
- `apps/web/app/(shell)/admin/platform-development/edge-nodes/page.tsx`
  — server component listing enrolled nodes (id, displayName,
  platform, status, trustState, lastSeenAt, capabilities, tags).
- `apps/web/components/admin/edge-nodes/EdgeNodeList.tsx` — client
  component for filtering / sorting.
- `apps/web/components/admin/edge-nodes/EdgeNodeRow.tsx` — per-row
  display + actions (manual quarantine, revoke, view discovery
  history).
- `apps/web/components/admin/edge-nodes/IssueBootstrapTokenButton.tsx`
  — opens a modal that issues a bootstrap token and displays it
  once (operator copies; never re-shown per the one-time
  contract).
- `apps/web/lib/actions/edge-node-actions.ts` — server actions for
  issue-token / quarantine / revoke. Auth-gated to
  `manage_platform_development` permission.
- Tests for each component + action.

**Exit:** `/admin/platform-development/edge-nodes` route renders;
operator can issue a bootstrap token and see the resulting node
appear after enrollment. Quarantine and revoke actions move the
node to the appropriate `trustState`.

**Depends on:** A1 (schema), A2 (API for the page to call —
issue-token uses the same internal flow as the API endpoint,
ideally reusing the same code).

### A8 — Audit log integration

**Files:**
- `apps/web/lib/audit/edge-node-events.ts` — emit `ToolExecution`
  rows for: bootstrap-token issuance, enrollment, heartbeat (sampled
  — every Nth or every state-change), discovery submission,
  quarantine, revoke.
- Tests verifying each event lands in `ToolExecution` with
  `surface=edge-node` + correct principal attribution.

**Exit:** Every state-changing Edge Node operation has an audit
trail entry. Heartbeat sampling configured to avoid filling the
audit table.

**Depends on:** A2, A7 (the operations to instrument).

### A9 — Unit + integration test sweep

**Files:**
- `apps/web/app/api/v1/edge/__tests__/integration.test.ts` —
  full enroll → heartbeat → submit → query DB integration test
  using the test DB fixture.
- `services/edge-node/src/__tests__/integration.test.ts` —
  end-to-end test against an in-memory mock authority.

**Exit:** `pnpm test` passes; new tests cover happy path + the
top-5 error paths (expired token, revoked node, missing scope,
schema mismatch, Authority offline).

**Depends on:** A1–A8.

### A10 — Local integration smoke + verification runbook entry

**Files:**
- `docs/install/edge-node.md` (new) — operator guide. Bringing up
  the Edge Node sidecar in dev; troubleshooting; capability
  reference.
- `docs/install/verification-runbook.md` — new section for Edge
  Node. Pre-built checklist mirroring the install_verification
  template.
- `.github/ISSUE_TEMPLATE/edge_node_verification.md` — issue
  template for community Edge Node verification reports.
- `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
  — append a "follow-up: Edge Node Phase 0 landed" entry.

**Exit:** A clean-checkout developer can follow `docs/install/edge-node.md`
and reach the demo state described in this roadmap's "Phase 0 scope"
section. Verification runbook entry mirrors the install one.

**Depends on:** A1–A9.

## Dependency graph

```
A1 (schema)
  ├── A2 (API)
  │     ├── A3 (service skeleton)
  │     │     └── A5 (sweep + submission)
  │     │           └── A6 (compose overlay)
  │     ├── A7 (portal UI)
  │     └── A8 (audit)
  └── A4 (persistSubmittedDiscoveryRun)
        └── A5
            └── A9 (test sweep)
                  └── A10 (docs + smoke)
```

Sequential critical path: **A1 → A2 → A3 → A5 → A6 → A9 → A10**.
A4 ships in parallel with A2 / A3. A7 + A8 can ship in parallel
with A5 / A6 once A2 is on `main`.

## Verification gate (before declaring Phase 0 complete)

A clean-checkout developer runs the demo at the top of this doc.
The four assertions in the demo's `Verify in the portal` section
all pass. Doctor bundle (`bash install-dpf.sh doctor` from the
Authority host) shows the new Edge Node section.

When the demo above passes, **Outcome 4** in the parent thread
ledger flips from `in_progress` to `verified locally`. Real-LAN
multi-host verification is then T2's job; macOS / Windows modes
are T3's; mTLS is T4's; air-gapped is T5's.

## Cross-references

- Spec: [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../specs/2026-05-09-dpf-edge-node-design.md)
- Doctrine: [`docs/superpowers/specs/2026-05-09-deployment-contracts.md`](../specs/2026-05-09-deployment-contracts.md) — Contract 5 (host trust + discovery)
- Principal convergence: AGENTS.md §11 — `EdgeNode` is a `PrincipalAlias.kind = "edge_node"`
- Parent thread (installer roadmap): [`docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`](2026-05-09-macos-linux-native-support.md)
