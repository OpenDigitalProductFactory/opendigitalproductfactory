# Federated Demand Network Implementation Plan

> **For agentic workers:** Follow the repository `AGENTS.md` contract: one worktree and PR per independently shippable slice, tests before implementation, DCO-signed commits, governed runtime verification, and ready-only pull requests.

**Backlog item:** `BI-E3A084ED`

**Design authority:** `docs/superpowers/specs/2026-07-19-federated-demand-network-design.md`

**Goal:** Let sovereign DPF installations share explicitly projected demand through approved relationships while keeping each local backlog authoritative, making internal two-node operation low-touch, preserving the reseller channel, and keeping Hive Mind code contributions result-only.

**Architecture:** Extend the existing federation identity, dual-approval, projection, mirror, and contribution substrates. Exchange a versioned `DemandEnvelopeV1` inside the existing CloudEvents-compatible wrapper; never serialize `BacklogItem` over a federation link. Treat business/channel data, demand projections, and Hive contribution results as three independently authorized channels. Ship each slice behind additive contracts and reversible enablement.

**First independently shippable slice:** Task 1. It adds closed relationship/activity/schema registries, safe demand projection templates, runtime conformance helpers, and a Hive result-only negative-egress guard. It changes no schema, route, discovery behavior, or live data flow.

---

## Task 1: Establish protocol, relationship, projection, and Hive-boundary contracts

**Completion:** Source implementation and source-local verification completed in the Slice 0 PR. No schema, endpoint, runtime, or UX surface changed.

**Files:**
- Modify: `packages/db/src/federation-link-types.ts`
- Modify: `packages/db/src/federation-link-types.test.ts`
- Create: `packages/db/src/federated-demand-contract.ts`
- Create: `packages/db/src/federated-demand-contract.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/web/lib/integrate/contribution-egress.ts`
- Modify: `apps/web/lib/integrate/contribution-egress.test.ts`

- [x] Add failing tests for the closed relationship presets and six directional roles, including symmetric and inverse-role behavior.
- [x] Add failing protocol tests for the `dpf.demand/1` schema, closed activity/audience/attribution registries, envelope limits, route-loop rejection, and strictly increasing origin versions.
- [x] Add failing negative-egress fixtures proving every relationship projection omits local backlog state, priority, estimate, discussion, attachments, customer-private context, and source database identifiers.
- [x] Add failing Hive result-bundle tests proving only result, evidence, provenance, attribution, review, disposition, and opaque receipt fields survive; nested backlog/work-capsule/private planning fields must be reported and removed.
- [x] Implement the smallest pure contracts that make the tests pass and export the shared DB package surface.
- [x] Run focused package and web tests, DB/web typechecks, `git diff --check`, and documentation integrity checks.

**Verification:** `pnpm --filter @dpf/db exec vitest run src/federation-link-types.test.ts src/federated-demand-contract.test.ts`; `pnpm --filter web exec vitest run lib/integrate/contribution-egress.test.ts`; package/web typechecks. No UX or migration gate applies because this slice introduces pure contracts only.

## Task 2: Add safe LAN discovery and invitation pairing

**Expected files:**
- Extend the host-capability owner selected under deployment Contract 5; portal modules consume candidates and pairing actions rather than owning multicast by default
- Add nearby-candidate API/actions and extend `apps/web/lib/federation/enrollment.ts`
- Extend the existing Connections surface under `apps/web/app/platform/federation-links/`
- Add installer/host allocation in the deployment-contract owner selected after the cross-platform spike

- [x] Allocate advertisement and browse to the native Go Edge Node under
  deployment Contract 5. Docker Desktop cannot provide host-LAN fidelity;
  use a pure-Go, CGO-free RFC 6762/6763 adapter and record the firewall/service
  implications in `docs/install/platform-support-watchlist.md`.
- [x] Advertise `_dpf-federation._tcp.local.` over HTTP or HTTPS with rotating service/host aliases, privacy-safe TXT data, and no stable organization/customer identity. Treat the advertised scheme as routing metadata only.
- [x] Deduplicate and expire candidates; discovery creates candidates only and never creates trust.
- [ ] Reuse `FederationBootstrapToken`, high-entropy invitations, matching human-readable codes, dual approval, and rotating link credentials for nearby and QR/deep-link pairing. Automatic nearby pairing must require a certificate-valid HTTPS endpoint; never send the invitation over HTTP or after a certificate failure. Keep manual out-of-band invitation as the fallback.
- [x] Add the `same-organization` preset summary and independent outbound contract review on both nodes.
- [x] Add feature-flag/kill-switch behavior and visible health without making portal startup depend on discovery.

**Verification:** privacy fixture inspection; spoofed/expired candidate tests; invitation replay rejection; dual-approval transition tests; Windows/macOS two-node pairing evidence; Connections UX verification; production build.

### Task 2 UX fit review — nearby Connections

- **Decision:** fits-with-guardrails
- **Owning area:** Platform
- **Route family:** canonical `/platform/federation-links` route, presented to
  operators as **Connections**; no new dashboard, global navigation item, or
  duplicate setup route
- **Primary persona:** founder/platform operator connecting two installations
  without remembering IP addresses, federation vocabulary, or trust internals
- **Navigation layer:** contextual setup actions inside the existing page
- **Reuse/convergence:** existing federation lifecycle actions and report-kit
  `StatusBadge`; the nearby list is setup workflow content, not a new reporting
  component family
- **Source truth:** expiring in-process candidate cache populated only by the
  authenticated Edge route; `EdgeNodeCapability` owns enabled/health state;
  `FederationLink` remains the only durable trust record
- **Empty/failure behavior:** no candidates keeps the invitation path visible;
  missing capability links to Edge Nodes; HTTP, certificate, multicast, and
  firewall failures explain why automatic setup is unavailable
- **AI boundary:** no coworker prompt or autonomous action
- **Guardrails folded into implementation:** candidate always reads “not
  connected”; first viewport distinguishes discovery from trust; theme tokens
  only; enable/pause is an Authority-owned capability decision; TLS validation
  precedes any bearer invitation
- **Evidence before merge:** route and privacy tests, light/dark theme scan,
  desktop/narrow browser exercise, no-candidate and insecure-candidate states,
  macOS/Windows add/remove evidence, and the production build

The DPF design-intelligence search returned no indexed recommendation for this
specialized pairing flow, so the review is grounded in the ratified feature
design, platform usability standards, the portal simplification spine, and the
existing federation/Edge runtime rather than an invented external pattern.

### Task 2 architecture review — advisory outcome

- **Alignment:** aligned with concerns. The implementation extends the existing
  native Edge capability, `FederationBootstrapToken`, `FederationLink`,
  principal, and projection-template substrate; it adds no competing trust
  model, table, or migration.
- **Allocation:** DNS-SD stays in the native Go Edge Node because Docker Desktop
  does not expose the Windows/macOS host multicast interfaces faithfully. The
  portal receives only authenticated, bounded candidate snapshots.
- **Trust boundary:** discovery works for both HTTP and HTTPS installations and
  never transports a bearer secret. Automatic invitation exchange remains
  blocked until the resolved peer uses certificate-valid HTTPS, per governed
  decision `DI-E72BC42D5FFB`.
- **Privacy boundary:** both DNS-SD service instance and mDNS hostname use the
  rotating discovery alias. The closed TXT allow-list contains only protocol,
  ephemeral install alias, capability digest, pair path, and routing scheme.
- **Ingress boundary:** candidate endpoints must be origin-only HTTP(S) URLs on
  `.local`, RFC 1918, IPv4 link-local, IPv6 link-local, loopback, or IPv6 ULA
  space. Credentials, paths, queries, fragments, public hosts, unknown fields,
  stale snapshots, oversize payloads, and excess candidate counts are rejected.
- **Residual dependency risk:** `github.com/betamos/zeroconf` is pre-v1 and does
  not provide dynamic TXT updates or conflict resolution. DPF pins the version,
  keeps parsing dependency-neutral, uses rotating collision-resistant names,
  and reopens the adapter each rotation window so it can be replaced without
  changing the Authority contract.
- **Evidence boundary:** CGO-disabled cross-compilation is source portability
  evidence, not Windows/macOS two-node functional evidence. V-01 remains open
  until both installed native services are exercised on the real LAN.

## Task 3: Implement reliable demand delivery and reconciliation

**Expected files:**
- Add additive Prisma models/migration only after a `FederatedRecordMirror` query/integrity proof
- Create demand ingress/egress routes under `apps/web/app/api/v1/federation/`
- Create delivery/reconciliation modules under `apps/web/lib/federation/`
- Extend `apps/web/lib/federation/client.ts`

- [ ] Decide storage from measured query and integrity requirements: retain minimized demand payloads in `FederatedRecordMirror(recordType="demand-envelope")`; add narrow receipt/outbox rows only for durable delivery state that the mirror cannot represent.
- [ ] Keep federation receipts distinct from GitHub operations while composing shared retry/idempotency primitives when `BI-C9EF928C` lands.
- [ ] Persist inbound receipt before applying effects; deduplicate by origin, envelope, and version; acknowledge only committed receipt state.
- [ ] Add bounded retry/jitter, dead-letter visibility, withdrawal, digest reconciliation, hop limits, and route-loop/replay protection.
- [ ] Add observe/follow/adopt behavior; adoption creates a new local `BacklogItem` with immutable origin provenance and never permits remote mutation of local status, priority, estimate, or build state.
- [ ] Record governed execution evidence for offline recovery and duplicate-free convergence.

**Verification:** migration validation/deploy; duplicate/reordered/replayed fixture tests; offline sender recovery; withdrawal/retention tests; two-node convergence; local-authority mutation tests; production build and Delivery Flow UX verification.

## Task 4: Add reseller/customer relationships and Founder Hub business management

**Expected files:**
- Extend federation Connections actions/UI
- Extend existing organization/agreement/entitlement substrates after architecture parity review
- Add reseller portfolio projections and help/response actions without a second backlog

- [ ] Add `service-provider` and `channel` invitation presets with customer-controlled outbound projections and independent revocation.
- [ ] Model Founder Hub reseller enrollment, standing, agreements/entitlements, offerings, support routing, and contribution recognition in their existing business owners.
- [ ] Add reseller aggregation, pseudonymous attribution, help offers, and selective forwarding with transitive consent.
- [ ] Prove multiple partners can coexist with non-overlapping projection scopes and no implied exclusivity.
- [ ] Add EA/SysML parity for every schema/API surface in the same slice.

**Verification:** customer negative-egress fixtures; multi-partner authorization tests; revoked-link behavior; reseller/customer/founder happy paths; role-appropriate UX; migration deploy and production build.

## Task 5: Add Founder Hub shared portfolio and independent Hive result intake

**Expected files:**
- Add network-demand read models and Delivery Flow views only after query proof
- Extend `HiveContributionLedger` and forge-neutral contribution adapters
- Wire the Task 1 result-only gate at every public-Hive serialization boundary

- [ ] Add inbox, clustering, distinct-origin reach, founder disposition, canonical local-item mapping, and downstream release applicability.
- [ ] Keep development/test demand visibly segregated from production; require explicit authorized promotion.
- [ ] Accept Hive result bundles independently of demand sharing and reject any source backlog/work-capsule/private planning context before persistence or egress.
- [ ] Map accepted code results to forge-neutral GitHub delivery; GitHub outage must not block local backlog or federation intake.
- [ ] Count direct and reseller-routed copies of one origin once and preserve original route/attestations.

**Verification:** environment-boundary tests; clustering reversal and distinct-origin reach tests; full Hive payload inspection; GitHub-outage recovery; founder shared-portfolio and contribution-governance UX; production build.

## Task 6: Add optional relay and routed-network reachability

**Expected files:** selected only after direct-link operational evidence and a standards spike.

- [ ] Add store-and-forward relay without scope expansion, origin rewriting, or backlog authority.
- [ ] Evaluate DNS-SD Discovery Proxy/SRP for managed routed networks; retain invitation fallback.
- [ ] Add distributor/community policy packs only from observed operational demand.

**Verification:** relay compromise/least-authority tests; multi-hop loop and duplicate tests; routed-network interoperability evidence; direct-link operation with relay disabled.

---

## Risks and controls

- **Privacy leakage:** use schema plus projection plus relationship policy plus caller authority as an intersection; keep negative-egress fixtures mandatory for every preset revision.
- **Trust-by-discovery:** discovery emits candidates only; all credentials and data exchange remain behind authenticated dual approval.
- **Multi-writer backlog conflict:** remote demand is a mirror/observation; adoption creates a new locally owned item.
- **Replay, duplication, and loops:** stable origin identity, monotonic versions, durable receipts, payload digests, bounded routes, and seen-event caches.
- **Container/host multicast differences:** run a host-allocation spike and cross-platform proof before choosing a dependency or installer contract.
- **Outbox duplication:** do not reuse the GitHub queue as federation transport; compose shared retry primitives while retaining protocol-specific state.
- **Public/private channel confusion:** expose and enforce business, demand, and contribution consent independently.

## Rollback

- Task 1 is pure and can be reverted without data migration.
- Later schema changes must be additive and nullable; old readers ignore new metadata and protocol versions they do not support.
- Discovery, automatic demand exchange, forwarding, relay, and Founder Hub intake each require independent kill switches.
- Revocation stops new sends, invalidates credentials, preserves auditable receipts under retention policy, and leaves local backlog operation available.
- A failed upgrade rolls back through the governed self-upgrade path; no slice may require destructive database rollback.

## Definition of done

The feature is complete only when verification cases V-01 through V-15 in the design are recorded against canonical runtime evidence, EA/SysML parity is current, migrations deploy cleanly, all affected tests/typechecks/builds pass, and the operator UX works on the supported macOS/Windows topology.
