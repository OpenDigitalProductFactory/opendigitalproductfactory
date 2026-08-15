# Truthful Physical Network Topology — Implementation Plan

> Execute as one atomic defect repair on `fix/truthful-network-topology`. Use red-green-refactor for every behavior change. Do not revive portal-owned production collection, add a second topology store, or use `MEMBER_OF` as a physical fallback.

| Field | Value |
|---|---|
| Backlog | `BI-6649C95A` (`xlarge`, in progress) |
| Design | `docs/superpowers/specs/2026-08-08-truthful-physical-network-topology-design.md` |
| Coverage decision | Atomic; receipt `cmsl594pe00ht01qlsihodwo6` |
| Architecture decision | `DI-7162CCF4A3D8` |
| UX decision | `DI-1709E09FD759` |
| Branch | `fix/truthful-network-topology` |

## Backlog coverage

This plan has four sequenced deliverables mapped to one live BI. None is independently shippable:

- native collection without truthful connection health would continue telling operators that zero devices is success;
- health semantics without the collector would accurately report a product that still cannot obtain topology;
- collector output without a physical-only projection would remain mixed into the subnet starburst;
- UI projection without collector parity would produce an honest but permanently empty physical view on the installed runtime.

The release boundary must therefore contain the compatible collector, health classifier, integrity guard, and read-model/UX projection together. This is one concern—truthful physical network topology—not a bundle of unrelated features.

Deliverable graph:

```text
A official-first edge adapter parity
  └─> B truthful test/rerun and scan integrity
        └─> C physical projection and operator UX
              └─> D canonical-runtime verification and documentation
```

Coverage receipt: `cmsl594pe00ht01qlsihodwo6` — `atomic`, recorded against live `BI-6649C95A`.

## Task 1 — Freeze contract fixtures and prove the native gap red

**Files**

- Add: `services/edge-node-go/internal/api/adapters_test.go`
- Add: `services/edge-node-go/internal/collect/unifi_test.go`
- Add: `services/edge-node-go/testdata/unifi/official-*.json`
- Modify: `services/edge-node/src/__tests__/unifi.test.ts`
- Modify: `apps/web/app/api/v1/edge/__tests__/wire-contract.test.ts` if fixture registration is required

1. Add official local-API fixtures for local sites, paginated devices, device detail with uplink/ports, and connected clients.
2. Write Go tests requiring authenticated `GET /api/v1/edge/adapters`, site resolution by UUID/internal reference/name/default, pagination, parent-before-child `HOSTS`, client `CONNECTS_TO`, canonical keys, and warning classification.
3. Extend TypeScript tests with the same fixtures and assertions.
4. Run `go test ./internal/api ./internal/collect` and the focused TypeScript test. Capture the expected failures showing the Go client/collector and official-first path do not exist.

## Task 2 — Implement the native adapter transport and collector

**Files**

- Modify: `services/edge-node-go/internal/api/client.go`
- Modify: `services/edge-node-go/internal/api/types.go`
- Add: `services/edge-node-go/internal/api/adapters.go`
- Add: `services/edge-node-go/internal/collect/unifi.go`
- Modify: `services/edge-node-go/cmd/dpf-edge-node/main.go`
- Modify: `services/edge-node-go/README.md`

1. Add the bounded authenticated GET seam and typed adapter response.
2. Implement per-connection HTTP clients with strict TLS by default and explicit `tlsInsecure` handling.
3. Implement official local API site resolution, pagination, device/detail/client collection, validation, stable key mapping, and physical relationships.
4. Add the version-gated legacy fallback. Permit fallback only for missing/unsupported official API responses; never for auth, TLS, timeout, malformed, or empty-success outcomes.
5. Fetch adapters on every sweep, isolate each adapter's failure, and merge items/relationships/warnings into the existing envelope.
6. Make sweep assembly a testable function instead of hiding parity inside the ticker closure.
7. Run `gofmt`, focused Go tests, then `go test ./...` until green.

## Task 3 — Bring the TypeScript adapter to the same official contract

**Files**

- Modify: `services/edge-node/src/collectors/unifi.ts`
- Modify: `services/edge-node/src/__tests__/unifi.test.ts`
- Modify: `services/edge-node/src/sweep.ts` only if output plumbing changes
- Modify: `services/edge-node/src/__tests__/sweep.test.ts`

1. Use the official local integration API first, including site UUID resolution and pagination.
2. Emit the same keys, device types, relationship types, and warning classes as Go.
3. Honor `discoverClients` in both runtimes.
4. Preserve the bounded legacy fallback under the same rules.
5. Run the focused edge-node Vitest files and cross-runtime contract fixture test until green.

## Task 4 — Make connection health and reruns truthful

**Files**

- Modify: `apps/web/lib/actions/discovery.test.ts`
- Modify: `apps/web/lib/actions/discovery.ts`
- Modify: `packages/db/src/discovery-collectors/unifi.test.ts`
- Modify: `packages/db/src/discovery-collectors/unifi.ts`
- Modify: `apps/web/components/inventory/SavedConnectionRow.tsx` if status copy needs a distinct degraded treatment
- Modify: matching component test

1. Write failing tests proving `unifi_no_devices` is degraded, partial endpoint failures remain visible, `tlsInsecure` survives manual rerun, and rerun does not force `active/ok`.
2. Extract one warning classifier shared by connection test and rerun.
3. Make the portal probe official-first so Save & Test validates the API the edge will use.
4. Persist honest status/message fields and return an operator-readable result.
5. Keep production collection edge-owned; the portal action remains a one-shot compatibility probe only.
6. Run focused db/web tests until green.

## Task 5 — Reject impossible ARP scan output

**Files**

- Modify: `packages/db/src/discovery-collectors/arp-scan.test.ts`
- Modify: `packages/db/src/discovery-collectors/arp-scan.ts`

1. Add red tests for network address, directed broadcast, multicast, out-of-subnet, duplicates, and a saturated `/24` result with no trustworthy MAC evidence.
2. Canonicalize CIDR and validate every discovered host against it.
3. On saturation, retain the subnet entity, emit `arp_scan_untrustworthy`, and emit no host membership rows.
4. Run the focused collector tests until green.

## Task 6 — Split physical topology from subnet inventory

**Files**

- Add: `apps/web/lib/graph/physical-topology.ts`
- Add: `apps/web/lib/graph/physical-topology.test.ts`
- Modify: `apps/web/lib/graph/view-config.ts`
- Modify: `apps/web/lib/graph/use-graph-layout.ts`
- Modify: `apps/web/lib/graph/__tests__/use-graph-layout.test.ts`
- Modify: `apps/web/lib/graph/subnet-scope.ts`
- Modify: matching subnet tests

1. Write red tests proving Network Topology accepts only `HOSTS`, `CONNECTS_TO`, `PEER_OF`, and `UPLINKS_TO`; `MEMBER_OF` stays only in Subnet Inventory.
2. Add a pure physical read-model helper that filters dangling/nonphysical edges, orients them for WAN→gateway→switch→AP→client layout, counts corroborated physical links, and calculates integrity from observation metadata.
3. Rename the operator label to **Subnet Inventory** and update its description/live-region copy.
4. Add `UPLINKS_TO` to the relationship vocabulary and visual config without introducing hardcoded UI colors.
5. Run focused graph/layout tests until green.

## Task 7 — Add the topology integrity summary and honest empty state

**Files**

- Modify: `apps/web/lib/actions/graph.ts`
- Modify: graph action tests
- Add: `apps/web/components/inventory/TopologyIntegritySummary.tsx`
- Add: `apps/web/components/inventory/TopologyIntegritySummary.test.tsx`
- Modify: `apps/web/components/inventory/TopologyGraph.tsx`
- Modify: `apps/web/components/inventory/TopologyGraph.test.tsx`
- Modify: `apps/web/components/inventory/__tests__/TopologyGraph.subnet.test.tsx`
- Add: `docs/ux-fit/2026-08-08-truthful-network-topology.ux-fit.json`

1. Extend `GraphData` with optional source/freshness/integrity metadata derived from canonical discovery records; do not query a vendor-specific table from the component.
2. Write red component tests for Current, Partial, Stale, and No physical evidence states; include accessible text and an Estate Discovery action.
3. Render the physical-only graph in Network Topology and the membership graph only in Subnet Inventory.
4. Ensure an empty physical view does not fall back to all data or a force starburst.
5. Resolve canvas colors through existing theme-aware mechanisms and use `--dpf-*` tokens for new DOM surfaces.
6. Commit the measured propose-n-pick UX-fit manifest referencing `DI-1709E09FD759` and every changed UI file.
7. Run focused component/action tests until green.

## Task 8 — Documentation, gates, and live verification

**Files**

- Modify: `docs/edge-node/unifi-adapter.md`
- Modify: relevant topology user guide discovered by doc-impact tooling
- Modify: this plan/spec only for actual verification receipts and deviations

1. Update the operator guide to the official API, site resolution, degraded semantics, and edge-owned collection model.
2. Run formatting and focused unit suites for Go, edge-node, db, and web.
3. Run `pnpm --filter web build` with zero errors.
4. Run repository documentation, UX-fit, plan-coverage, and relevant static checks.
5. Claim the shared nonproduction environment lease; never start an ad-hoc portal or compose stack.
6. Against the canonical runtime, exercise Save & Test, wait/trigger a real native edge sweep, and verify WAN/gateway/switch/AP/client hierarchy, source/freshness status, Subnet Inventory, empty/degraded states, keyboard access, dark/light themes, and no console errors.
7. Record runtime evidence against `BI-6649C95A`; release the lease.
8. Re-run affected tests after any live-found correction.

## Task 9 — Independent review and one ready PR

1. Confirm the diff is one concern and contains no secrets or live-network fixture data.
2. Obtain a fresh independent semantic-review receipt for the stable commit and resolve all findings.
3. Run the DPF local merged-code CI workflow against current `origin/main`.
4. Commit with DCO sign-off, push immediately, and open one non-draft PR.
5. Use `pnpm pr:health <number>` to verify merge readiness; do not substitute a visual check.
6. Update `BI-6649C95A` to done only after required evidence is recorded and the implementation is genuinely complete.

## Verification matrix

| Layer | Proof |
|---|---|
| Go transport/collector | focused red-green tests, `go test ./...`, official + fallback fixtures |
| TypeScript edge parity | focused Vitest and shared fixture assertions |
| Connection truth | action/collector tests for zero, partial, auth, TLS, unreachable, and rerun |
| Scan integrity | invalid-address and saturation tests |
| Read model | pure physical-filter/orientation/integrity tests |
| UI | component accessibility tests plus canonical dark/light interactive pass |
| Integration | canonical native edge sweep produces managed devices and physical relationships |
| Release | web production build, docs/UX/coverage gates, merged-code local CI, semantic review, PR health |

## No-migration and documentation decisions

No schema migration is planned: existing `DiscoveryConnection`, `DiscoveryRun`, inventory entity/relationship, attribution, and graph projection contracts are sufficient. If implementation reveals a truly missing closed enum or persisted field, stop and amend the design/coverage before adding substrate.

Documentation is required because the current UniFi guide claims the edge already renders the real network, which the installed runtime disproves.

## Design grounding

- Existing specs/plans reviewed: this implementation plan and its accepted truthful physical topology design.
- Current code substrate reviewed: physical projection, hierarchical layout, viewport transforms, canvas rendering, and the live UniFi graph output.
- Source of truth: canonical inventory entities and relationships; the layout changes display direction and coordinates only.
- Decision: complete the accepted physical hierarchy contract with a compact, automatically fitted topology projection.

## Implementation record

Implemented on `fix/truthful-network-topology` as one atomic repair. The final shape preserves the design decisions while making these execution-level adjustments:

- HTTP test servers replaced checked-in vendor fixtures, keeping real network identifiers and payloads out of the repository while covering official pagination, device detail, clients, and bounded legacy fallback.
- The physical read model filters and orients canonical graph data before layout, so no change to the generic layout engine or subnet-scoping helper was required.
- Canonical-runtime review after the official UniFi evidence repair exposed that the initial projection had not actually implemented its specified display orientation: child-to-parent facts rendered clients above the gateway, and Dagre placed every client on one clipped row. The physical read model now orients and deduplicates display edges, while a topology-specific layout wraps clients beneath their observed AP/switch and automatically fits the first viewport. Canonical facts remain unchanged.
- Source kind and observation freshness are projected through `discovery-sync.ts` and `graph-sync.ts`; the UI does not query UniFi-specific persistence.
- Shared topology constants and the UniFi TLS-aware fetch helper were extracted to keep changed modules within repository size limits.
- No migration was required; the existing discovery, inventory, attribution, and graph contracts were sufficient.

Source-local verification completed:

- Go: `go test ./...` passed.
- TypeScript edge: 15 files / 204 tests passed.
- Database collectors and projection: 4 files / 51 tests passed; package typecheck passed.
- Web actions, read model, and integrity UI: 5 files / 30 tests passed; TypeScript passed with the repository compiler at an 8 GiB heap after the default 4 GiB process exhausted memory.
- Production web build passed (142/142 static pages); it retained 25 pre-existing Edge Runtime compatibility warnings and introduced no build errors.
- Module-size, style-drift, documentation-index, prose, derived-artifact, diff, and 35-check preflight guards passed.

Exact committed-tree merged-code CI, canonical runtime evidence, independent semantic review, and PR health are intentionally recorded after the stable DCO commit in Task 9.
