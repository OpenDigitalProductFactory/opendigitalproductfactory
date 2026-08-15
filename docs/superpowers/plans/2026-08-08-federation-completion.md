# Federation Completion — Integrated Delivery Plan

| Field | Value |
| --- | --- |
| Status | Implementation complete; post-merge physical acceptance pending |
| Date | 2026-08-08 |
| Epic | EP-DELIVERY-FLOW |
| Backlog items | BI-6EF4288A, BI-42617832, BI-51F5229B, BI-05EB708F |
| Work capsule | WC-3D952F67 |
| Branch | `feat/federation-completion` |

## Delivery shape

The founder explicitly directed these four remaining BIs to ship in one PR. They form
one end-to-end concern: a peer must be discoverable (locally or through a trusted
introducer), paired through the SAS-first Connections experience, and then able to
exchange demand through the reliable queue-backed inbox before the physical Mac ↔
Windows acceptance can pass. Splitting that path would leave the physical acceptance
BI unverifiable and would repeat the partial-delivery failure this plan closes.

## Existing substrate extended

- `FederationLink` remains the sole durable trust/relationship authority.
- `FederationPairingSession` remains the transient SAS pairing authority.
- `FederatedRecordMirror` remains mirror/version-vector state; transport scheduling
  moves to `WorkItem` in a canonical `WorkQueue` and emits `QueueTelemetryEvent`.
- `nearby-candidates` remains the candidate presentation contract. Introduced peers
  enter that same operator review shape and never grant trust or carry backlog data.
- `/api/v1/federation/demand` remains a compatibility endpoint while the standard
  peer delivery target becomes an ActivityPub-style `/api/v1/federation/inbox`.

## Standards and precedents

- RFC 6763 DNS-SD: discovery yields named service instances; it is not trust.
- Syncthing introducers: a trusted peer can share eligible peer coordinates, with
  provenance and de-introduction/loop handling.
- W3C ActivityPub server-to-server delivery: post asynchronously to a peer inbox,
  retry transient failures, and make receipt idempotent.

DPF deliberately differs from Syncthing by requiring explicit operator review and SAS
pairing for every introduced candidate. Introducer transitivity never transfers trust.

## Implementation phases

### 1. Introducer topology — BI-6EF4288A

- Add typed introducer policy and introduction provenance/state.
- Exchange only minimum candidate identity, display name, authority endpoint, and
  relationship hint over already-trusted links.
- Enforce allowed relationship paths, reject self/seen installation IDs, bound hops,
  expire withdrawn candidates, and surface candidates for explicit review.
- Add protocol, policy, persistence, route, action, and UI tests.

### 2. Queue-backed inbox — BI-42617832

- Add generic retry scheduling fields and an idempotent source key to `WorkItem`.
- Lazily create/backfill a singleton federation-delivery `WorkQueue` and one delivery
  job per local mirror; new/updated projections requeue that job.
- Drain due jobs with bounded exponential backoff and shared queue telemetry. Mirror
  delivery fields remain compatibility-only during rolling upgrade and stop governing
  scheduling.
- Deliver to `/api/v1/federation/inbox`; fall back to the legacy route only for an
  older peer. Keep existing event and mirror idempotency checks at receipt.

### 3. SAS-first Connections UX — BI-51F5229B

- Present named nearby/introduced candidates, security state, source, expiry, and
  selectability before pairing; never ask for their URL in the primary path.
- Collapse invitation/manual URL controls into an explicit recovery disclosure.
- Normalize host/IP/origin recovery input safely, preserve input on errors, and return
  field-specific guidance.
- Show introducer policy on trusted relationships without implying trust transfer.
- Verify desktop and mobile viewports with theme-aware shared primitives.

### 4. Physical Mac ↔ Windows acceptance — BI-05EB708F

- Merge and install the exact PR bytes through the governed release path.
- Exercise discovery/expiry, certificate-valid SAS pairing, restart persistence,
  bidirectional create/update/withdraw, offline catch-up/dedup, source-authority
  preservation, revoke, and rejoin on the two founder-operated installs.
- Capture versions, certificate fingerprints/chains, screenshots, V-01/V-03 results,
  and canonical-runtime evidence without secrets.

## Verification

1. Focused unit/route/component tests for all affected modules.
2. Prisma generation and migration against clean and representative existing state.
3. Full production web build.
4. Exact-SHA local merged-code gate under the shared nonprod lease.
5. Desktop/mobile Connections UX verification.
6. Physical Mac/Windows acceptance after merge and canonical install upgrade.

## UX fit review — federation Connections completion

- Decision: fits-with-guardrails
- Owning area: Platform
- Route family: `/platform/federation-links` (the existing canonical Connections home)
- Primary persona: founder/operator, reseller operator, or customer administrator who
  needs to connect installations without remembering IP, token, certificate, or shell
  mechanics
- Navigation layer touched: local page content and contextual actions only
- Reuse/convergence: existing Connections candidate cards, `StatusBadge`, `InlineBusy`,
  native short-detail disclosure, and the existing FederationLink table; no new route
  family or visual component dialect
- Source truth: Edge discovery candidate cache for LAN sightings,
  `FederationIntroductionCandidate` for introduced review candidates,
  `FederationPairingSession` for transient SAS state, and `FederationLink` for trust and
  introduction policy
- Empty/failure behavior: discovery health and candidate selectability remain visible;
  a no-candidate state explains automatic refresh; raw invite/address fields are kept in
  a clearly labelled recovery disclosure; normalization errors preserve the entered value
- AI boundary: no prompt send; all pairing and trust changes remain explicit operator
  actions with SAS confirmation
- Required guardrails: the discovered/introduced choice and SAS action stay visible on
  arrival; recovery cannot become the primary action; introduced candidates state their
  provenance and that trust is not transferred; all colors remain DPF tokens
- Evidence before merge: component/route tests, hardcoded-color scan, measured route UX
  manifest, desktop and mobile browser exercise, empty/degraded/introduced fixtures
- Captured in: this plan and the PR verification body

## Design grounding

- Existing specs/plans reviewed: the zero-shell federation autodiscovery design,
  federation pairing/SAS plans, unified delivery-surfaces design, and this integrated
  completion plan.
- Current code substrate reviewed: `FederationLink`, `FederationPairingSession`,
  `FederatedRecordMirror`, `WorkQueue`/`WorkItem`, queue telemetry, nearby candidate
  discovery, enrollment, reconciliation, and the existing Connections route.
- Source of truth: trust and relationship remain in `FederationLink`; pairing authority
  remains in `FederationPairingSession`; delivery execution is a canonical `WorkItem`;
  introduced peers are expiring review projections only.
- Decision: extend those substrates with SAS-first progressive disclosure, bounded
  trusted introductions, and an ActivityPub-style asynchronous inbox. Do not add a
  second trust graph, backlog authority, or bespoke retry scheduler.

## Rollback and compatibility

- Schema additions are nullable/defaulted and forward-only.
- The existing demand endpoint remains accepted during version skew.
- Legacy mirror scheduling columns remain readable for lazy job backfill and can be
  removed only in a later, separately proven cleanup.
- Disabling introducer policy stops new introductions; revocation immediately excludes
  that link from introduction and delivery processing.
