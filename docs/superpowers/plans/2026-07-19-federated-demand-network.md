# Federated Demand Network Implementation Plan

> **For agentic workers:** Follow the repository `AGENTS.md` contract: one worktree and PR per independently shippable slice, tests before implementation, DCO-signed commits, governed runtime verification, and ready-only pull requests.

**Backlog item:** `BI-E3A084ED`

**Design authority:** `docs/superpowers/specs/2026-07-19-federated-demand-network-design.md`

**Goal:** Let sovereign DPF installations share explicitly projected demand through approved relationships while keeping each local backlog authoritative, making internal two-node operation low-touch, preserving the reseller channel, and keeping Hive Mind code contributions result-only.

**Architecture:** Extend the existing federation identity, dual-approval, projection, mirror, and contribution substrates. Exchange a versioned `DemandEnvelopeV1` inside the existing CloudEvents-compatible wrapper; never serialize `BacklogItem` over a federation link. Treat business/channel data, demand projections, and Hive contribution results as three independently authorized channels. Ship each slice behind additive contracts and reversible enablement.

**First independently shippable slice:** Task 1. It adds closed relationship/activity/schema registries, safe demand projection templates, runtime conformance helpers, and a Hive result-only negative-egress guard. It changes no schema, route, discovery behavior, or live data flow.

## Backlog coverage

- Decision: decomposed
- Parent: `BI-E3A084ED`
- Receipt: `cmrsw3hdn0000lbpg591ouv5s`
- Rationale: The protocol, same-network fleet, delivery, reseller channel, founder portfolio, and future routed-reach layers are independently deployable business capabilities with explicit sequencing dependencies.
- Dependencies: internal fleet and delivery depend on protocol; channel depends on delivery; founder portfolio depends on channel; routed reach depends on founder portfolio.
- Federated demand protocol -> `BI-E3A084ED`
- Automatic same-network internal fleet sync -> `BI-52D34506`
- Reliable federated delivery -> `BI-44AA45BF`
- Reseller and service-provider demand channels -> `BI-D964E2DA`
- Founder Hub shared portfolio -> `BI-D25A0C31`
- Future routed federation reach -> `BI-D43D3D76`

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

**Implementation status:** Source implementation complete on the Slice 2 branch;
canonical migration/build/UX and two-node convergence evidence remain required
before the backlog item closes.

**Expected files:**
- Add additive Prisma models/migration only after a `FederatedRecordMirror` query/integrity proof
- Create demand ingress/egress routes under `apps/web/app/api/v1/federation/`
- Create delivery/reconciliation modules under `apps/web/lib/federation/`
- Extend `apps/web/lib/federation/client.ts`

- [x] Decide storage from measured query and integrity requirements: retain minimized demand payloads in `FederatedRecordMirror(recordType="demand-envelope")`; use local-canonical mirror rows as the protocol-specific durable outbox and peer-canonical rows as the inbox receipt, adding only narrow delivery columns and the missing peer-reference uniqueness constraint.
- [x] Keep federation receipts distinct from GitHub operations while composing shared retry/idempotency primitives when `BI-C9EF928C` lands.
- [x] Persist inbound receipt before applying effects; deduplicate by origin, envelope, and version; acknowledge only committed receipt state.
- [x] Add bounded retry/jitter, dead-letter visibility, withdrawal, digest reconciliation, hop limits, and route-loop/replay protection.
- [x] Add observe/follow/adopt behavior; adoption creates a new local `BacklogItem` through the canonical ingest front door with immutable federated-demand provenance and never permits remote mutation of local status, priority, estimate, or build state.
- [ ] Record governed execution evidence for offline recovery and duplicate-free convergence.

**Verification:** migration validation/deploy; duplicate/reordered/replayed fixture tests; offline sender recovery; withdrawal/retention tests; two-node convergence; local-authority mutation tests; production build and Delivery Flow UX verification.

### Task 3 implementation allocation

- `FederatedRecordMirror(canonicalSide="peer")` is the durable inbox mirror;
  the inverse `(link, record type, peer reference)` unique key prevents a retry
  race from creating duplicate demand.
- `FederatedRecordMirror(canonicalSide="local")` is the federation outbox. Its
  attempts, next-attempt, error, acknowledgment, and dead-letter fields are
  protocol-specific and do not overload the GitHub/forge operation queue.
- `PlatformConfig(key="federation.identity")` owns the stable pseudonymous
  installation identity and local-only projection secret. HMAC-derived envelope
  references are stable across links without exposing a `BI-*` identifier.
- The five-minute `federation/demand-reconciliation` job projects only
  `dpf-portal` demand over trusted `same-org-peer` links, withdraws records that
  leave scope, exchanges bounded digests, repairs missing/divergent delivery,
  and drains due outbox records. Service-provider/channel/community selection
  stays explicit until Task 4 adds its governed controls.
- The authenticated demand and digest routes validate CloudEvents binding,
  replay window, envelope schema, route loop/hop limit, source version, and
  payload digest before acknowledgment.

### Task 3 UX fit review — network demand in Delivery Flow

- **Decision:** fits-with-guardrails.
- **Owning area:** Products / Delivery Flow at the existing `/ops/demand`
  route; no new global navigation or dashboard.
- **Primary persona:** founder/operator reviewing demand another approved DPF
  installation elected to share.
- **Reuse:** existing report-kit `CollapsibleList`, `EmptyState`, and
  `StatusBadge`; adoption uses the canonical backlog ingest front door.
- **Source truth:** peer-canonical minimized `FederatedRecordMirror` rows only;
  local-canonical outbox rows never appear as inbound network demand.
- **Empty/failure behavior:** an honest no-shared-demand state preserves local
  Delivery Flow and links to Connections; malformed mirror payloads fail soft.
- **Authority guardrails:** origin installation IDs, routes, and source backlog
  references are never rendered; follow is local interest; adopt explicitly
  creates a new locally owned item; withdrawn demand cannot be adopted.
- **AI boundary:** no prompt, coworker launch, or autonomous local adoption.

### Task 3 SysML architecture note

- **Scope:** DPF Federated Demand Network delivery/reconciliation subsystem and
  its Delivery Flow adapter.
- **Changed requirements/constraints:** R-FDN-01 local authority, R-FDN-03
  automatic reconciliation, R-FDN-05 allow-listed projection, bounded replay,
  no raw backlog identifiers, and no GitHub-queue coupling.
- **Changed interfaces/ports:** authenticated CloudEvent demand inbox
  `/api/v1/federation/demand`, digest control port
  `/api/v1/federation/demand/reconcile`, and the five-minute scheduled worker.
- **Allocations:** `FederationLink` owns trust/routing; `ProjectionContract`
  templates own allowed fields; `FederatedRecordMirror` owns inbox/outbox state;
  `PlatformConfig` owns installation identity material; Delivery Flow owns
  observe/follow/adopt; `BacklogItem` remains the sole local work authority.
- **Verification cases:** protocol/negative-egress tests, duplicate/version/
  replay/loop tests, retry/dead-letter/withdrawal/digest tests, migration apply,
  production build, Delivery Flow browser exercise, and two-node outage recovery.
- **Data authority impact:** source installation owns the envelope and version;
  receiver owns only its mirror/disposition and any explicitly adopted local
  item. Remote traffic never mutates local priority, estimate, status, or build.
- **EA/current-state catch-up:** Prisma→EA mirror derives the added delivery
  fields; the route-family extractor derives both ports; authority semantics
  are pinned here and in schema/module comments rather than hand-maintained
  `.sysml` data.
- **Parity/extractor impact:** no new extractor is required; run
  `check:architecture-parity` and route-manifest checks before publication.
- **Open architecture risks:** Task 4 must supply explicit partner/channel item
  selection and transitive-consent controls; real Mac↔Windows evidence remains
  a cross-slice system verification dependency.

## Task 4: Add reseller/customer relationships and Founder Hub business management

**Expected files:**
- Extend federation Connections actions/UI
- Extend existing organization/agreement/entitlement substrates after architecture parity review
- Add reseller portfolio projections and help/response actions without a second backlog

- [x] Add `service-provider` and `channel` invitation presets with customer-controlled outbound projections and independent revocation.
- [x] Model Founder Hub reseller enrollment, standing, agreements/entitlements, offerings, support routing, and contribution recognition in their existing business owners.
- [x] Add reseller aggregation, pseudonymous attribution, help offers, and selective forwarding with transitive consent.
- [x] Prove multiple partners can coexist with non-overlapping projection scopes and no implied exclusivity.
- [x] Add EA/SysML parity for every schema/API surface in the same slice.

**Slice 3 implementation receipt (2026-07-20, BI-D964E2DA):**

- **Architecture:** `PartnerAccount` is a thin Founder-owned commercial account,
  not a login identity, customer account, or remote backlog. Agreements,
  entitlements, support routes, and contribution recognition reference their
  existing owners (`ServiceOffering`, `HiveContributionLedger`, and
  `FederationLink`) rather than copying catalog, contribution, or trust state.
- **Federation:** customer/reseller selection is explicit per link; `channel`
  links are directional and non-exclusive. Forwarding is denied unless the
  source envelope grants the `founder` audience, and the reseller preserves the
  original opaque origin and pseudonymous attribution while appending a signed
  route attestation.
- **Collaboration:** interest and help offers use bounded
  `dpf.demand-response/1` envelopes. Responses can refer only to an envelope
  previously shared over the same link and cannot contain backlog, capsule, or
  planning identifiers.
- **UX:** Connections exposes customer/reseller/channel roles and a Founder Hub
  reseller panel. Delivery Flow exposes explicit per-link sharing, withdrawal,
  forwarding, interest/help actions, and received response receipts.
- **Data authority:** the local installation remains authoritative for its
  backlog and outbound consent; the receiver owns only its mirror and response.
  Founder Hub owns partner-business records. Hive remains the contribution-result
  authority. The accompanying DataImpactManifest records model lifecycle and
  projection cleanup/reconciliation coverage.
- **EA/current-state parity:** Prisma-to-EA data mirror derives the new partner
  models and relationship edges; the route-family extractor derives the demand
  response port. No hand-maintained duplicate model was introduced. Publication
  is gated by `check:architecture-parity`, route-manifest, migration, build, and
  browser verification.

**Verification:** customer negative-egress fixtures; multi-partner authorization tests; revoked-link behavior; reseller/customer/founder happy paths; role-appropriate UX; migration deploy and production build.

### Design grounding — Task 4 reseller channels

- **Existing specs/plans reviewed:** the federated-demand network design and
  this implementation plan, including the local-authority, projection,
  reseller-channel, and Hive result-only boundaries.
- **Current code substrate reviewed:** `packages/db/src/federated-demand-contract.ts`,
  `apps/web/lib/federation/`, the existing Connections route under
  `apps/web/app/platform/federation-links/`, and Delivery Flow under
  `apps/web/app/ops/demand/`.
- **Source of truth:** `FederationLink` owns trust and directional relationship;
  projection contracts own shareable fields; local `BacklogItem` rows remain
  authoritative; Founder Hub partner records own commercial standing.
- **Decision:** extend those owners with explicit, independently revocable
  channel permissions and bounded response envelopes. Do not create a global
  backlog, a second partner identity, or a parallel navigation surface.

### Task 4 UX fit review — reseller channels

- **Decision:** progressive disclosure in the existing Connections and Delivery
  Flow routes. Relationship setup stays in Connections; item-level share,
  withdraw, forwarding, interest, and help actions appear only in the relevant
  demand card or partner panel.
- **Cognitive load:** use business-language role labels and contextual actions;
  keep protocol versions, pseudonymous origin keys, route attestations, and
  projection internals out of the operator workflow.
- **Navigation:** no new global navigation, dashboard, or duplicate backlog.
- **Authority cues:** sharing and forwarding are explicit; the customer controls
  outbound scope; withdrawal and revocation remain visible; received demand is
  never presented as locally owned work until adoption.
- **Failure/empty states:** no eligible link, revoked consent, withdrawn demand,
  and response-delivery failures explain the unavailable action without hiding
  the local backlog or other partners.

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
