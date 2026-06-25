# Implementation Plan — Managed-Services Delivery & Cross-Org Federation

**Date:** 2026-06-24
**Spec:** `docs/superpowers/specs/2026-06-24-managed-services-delivery-and-cross-org-federation-design.md`
**Epic:** `EP-MSP-FEDERATION` (10 BIs)
**Mode:** Direct in-worktree implementation (founder-directed 2026-06-25; Build-Studio-for-all-dev rule consciously set aside for this epic). Founder tests on completion.

## Sequencing principle

One projection, two boundaries (spec §5). Build Topology A's shared seams first so Topology B reuses them with no second code path. Pure, testable libraries before DB/route wiring. Commit per coherent slice; each slice typechecks + has vitest coverage where the logic is pure.

## Verified substrate (compose, do not duplicate)

- `packages/db/src/discovery-scope.ts` — scope-key grammar (`customer:<id>:site:<id>` / `organization:internal`), three-mode context, `resolveDiscoveryScopeFromIds`. The estate-scope resolver composes this.
- `EdgeNode` (schema.prisma:10103) already carries `customerAccountId`/`customerSiteId`/`scopePolicy` — the canonical routing source.
- `EdgeEvent` (10300) + `ChangeEvent` (10372) — dedup + `(edgeNodeId, occurredAt)` indexes purpose-built for A2 correlation (schema comments name the missing slice).
- `PortfolioQualityIssue` (3777) — health-alert inbox; needs scope columns (A1).
- `Principal`/`PrincipalAlias` (228/257) — identity spine; free-string `kind`/`aliasType`. Federation peers/operators are aliases here (no new identity table).
- `AuthorityBinding` (2179) — `scopeType`/`policyJson`/`authorityScope`/`approvalMode`/`sensitivityCeiling` + subjects/grants/decision-logs. Authority bands (B1/B4) resolve here.
- `AgentActionProposal` (3925) — `actionType`/`parameters`/`status: proposed→decided→executed`. The remediation proposal (B4) specializes this; no second approval engine.
- `health-alert-issue.ts`, `alert-delivery-bridge.ts`, `alert-sources.ts` — the alert→issue path (A1 extends).
- `MasterDataSourceRef` (CustomerAccount.masterDataSourceRefs) — candidate substrate for the B3 record mirror; evaluate before adding `FederatedRecordMirror`.
- `services/edge-node/src/enroll.ts` + `apps/web/app/api/v1/edge/enroll/route.ts` + `apps/web/lib/auth/edge-node-token.ts` — the enrollment trust model B1 generalizes.

## Phase 1 — Topology A delivery loop

- **Slice 1 (A1 + WS-0a):** `packages/db/src/estate-scope.ts` (resolver composing discovery-scope) + tests. Add `customerAccountId`/`customerSiteId`/`scopeKey` to `PortfolioQualityIssue` + indexes + relations; hand-authored migration. Extend `health-alert-issue.ts` to optionally carry scope. Export through index + subpath.
- **Slice 2 (A2):** `packages/db/src/edge-event-correlation.ts` — pure correlation (join `ChangeEvent`→`EdgeEvent` within window N, change-before-spike), + persistence helper + tests. Wire into the edge events route / a correlation cron. Produces a correlated incident record.
- **Slice 3 (A3):** `ServiceTicket` model (single, `ticketKind` ∈ incident|request|change|scheduled-review) tied to customer/site/CI + agreement; `service-ticket.ts` writer fed by A2 incidents; distinct from `PlatformIssueReport`; migration; tests.
- **Slice 4 (A4):** Grant `telemetry_read`/`incident_read` in `agent-grants.ts`; wire the managed-services loop (detect→correlate→diagnose→propose→approve→execute→record) reusing `AgentActionProposal` + `AuthorityBinding` + the `EP-CTRL-5E21A4` runner; tests.

## Phase 2 — Federation foundation

- **Slice 5 (WS-0b + B1):** `packages/db/src/trust-link-lifecycle.ts` — pure lifecycle (token-prefix validation, pending/trusted/quarantined/revoked transitions, single-use bootstrap, rotation) extracted so `EdgeNode` and `FederationLink` share it; tests. `FederationLink` model (mirrors EdgeNode+BootstrapToken) + `dpflink_` tokens + `/api/v1/federation/enroll` + dual approval + `Principal(kind="federated-peer"/"federated-operator")` alias; auth resolves on Principal+AuthorityBinding; migration.
- **Slice 6 (WS-0c + B2):** `packages/db/src/projection-contract.ts` — pure projection serialization (allow-list, deny-list, redaction, CADA score, retention class, CloudEvents outer metadata, excluded-field PROOF / negative-egress assertions); tests. `ProjectionContract` model (dedicated table — chosen over JSON-on-link for indexable per-field egress checks + CADA per-field posture; spec §15.1); CADA egress gate at `/api/v1/federation/projection`.

## Phase 3 — Federation delivery

- **Slice 7 (B3):** Evaluate `MasterDataSourceRef` first; add generic `FederatedRecordMirror` only if it cannot carry link-scoped sync (spec §15.2). Incident→ServiceTicket mirror over the link; resolution sync-back; revocation stops sync, keeps audit.
- **Slice 8 (B4):** Cross-org `RemediationProposal` as a specialized projection/side table over `AgentActionProposal` (audit first) + `AuthorityBinding` band evaluation; proposal lands on the customer's Attention Surface; approved actions execute via the customer's own runner; dual audit; no MSP standing execute rights.
- **Slice 9 (B5):** `CustomerAccount` ↔ `Organization` crosswalk (explicit, not email/name merge — reuse MDM); federated operator presence (scoped, visible, audited); governed artifact publish (versioned, opt-in, customer-accepted).

## Cross-cutting (WS-0, every slice)

- Service-work status strings → one closed union (hyphens, not underscores); update MCP tool schemas + TS unions in the same commit.
- Invariant tests: `PrincipalAlias` is the only identity extension for peers/operators; no federation code authorizes from free-text peer IDs.
- New routes → regenerate `apps/web/lib/ea/route-manifest.json` (source-only worktree: hand-edit).
- UX surfaces (spec §8) per phase: contextual entry points first, report-kit primitives, theme tokens, in-app dialogs, Attention Surface for approvals. No new global nav in v1.

## Open-question dispositions (spec §15)

1. **ProjectionContract storage:** dedicated table (per-field allow/deny + CADA posture must be queryable at egress; JSON-on-link loses indexable egress proof).
2. **Record mirror:** evaluate `MasterDataSourceRef`/MDM in Slice 7; prefer extension over a new table.
3. **Service-ticket route family:** under customer context; UX-fit review in Slice 3.
4. **Authority bands for regulated pilots:** founder/operator business decision — BLOCKED on Mark. Default until set: read-only projection + proposal-only remediation, every action above a conservative floor requires human approval at the customer.
5. **Monthly evidence pack:** deferred to Phase 4.

## Progress log

- **Phase 1 — Topology A (committed `6328d8648`).** WS-0a estate-scope resolver, A1 quality-issue estate scope + migration, A2 edge-event correlation engine, A3 ServiceTicket model + migration + unions/mapper, A4 remediation authority bands. 40 unit tests; packages/db + apps/web typecheck clean.
- **Phase 2 — federation foundation.** WS-0b trust-link-lifecycle (dual approval), B1 FederationLink + FederationBootstrapToken models + migration + `/api/v1/federation/enroll` route + enroll/approve/revoke lib + tokens, federation-link-types, WS-0c + B2 projection-serialization library (minimum-necessary allow-list + forbidden-field egress guard + CloudEvents envelope) + ProjectionContract model + migration. 24 unit tests; route manifest regenerated; typecheck clean.
- **Phase 3 — federation delivery (decision cores).** B3+B5 FederatedRecordMirror model + migration + pure `reconcileMirror` (canonical-side + optimistic-concurrency conflict detection) and `buildOrganizationCrosswalk` (explicit ref, no email/name merge). B4 FederatedRemediationProposal model + migration + pure `routeRemediationProposal` consent gate (untrusted→refused, band-refuse→refused, auto-execute only with the CUSTOMER's own consent, else customer Attention Surface) reusing remediation-authority. 13 unit tests; typecheck clean.
- **Phase R (runtime wiring — making the substrate live; epic merged to main `e9aef5227`).** R1: `edge-incident-correlation` scheduled job (Topology A delivery loop LIVE) — loads recent active EdgeEvents + ChangeEvents, runs the A2 correlation engine, persists each incident as a customer-scoped quality issue AND upserts an A3 ServiceTicket (scope derived from the EdgeNode). Pure DB-injected orchestration + thin Inngest wrapper + quiescence gate; registered in the scheduled-job catalog (parity test green); dark-launched behind `DPF_EDGE_INCIDENT_CORRELATION_ENABLED`. 4 unit tests + catalog parity. R2: operator surfaces (mirroring the Edge Nodes admin) — `/platform/federation-links` (B1: issue invitation + approve/quarantine/revoke links over the merged enrollment lib, dual-approval state visible) and `/platform/service-desk` (A3: report-kit DataTable of customer ServiceTickets). New StatusBadge domains (federationLinkState / serviceTicketStatus / serviceTicketPriority); manage_platform-gated server actions with revalidate; theme-token-compliant; route manifest regenerated. URL-reachable like edge-nodes; nav placement is a follow-up. UX-Fit: fits-with-guardrails — reuses the reviewed edge-nodes pattern + report-kit + theme tokens, contextual under `/platform`, no new global nav.
- **Phase R3 — loop closure (the AI-MSP diagnose→propose→decide loop end-to-end).** Closes the gap between "substrate exists" and "the loop runs":
  - **A4 deterministic diagnosis** (`lib/service-desk/remediation-suggestions.ts`): pure `suggestRemediationActions` maps an incident (summary/eventClass/severity) to candidate actions, each tagged with its authority band via the A4 remediation-authority library; `diagnoseAndPropose` wraps it into a wire proposal with an `overallDecision` (auto vs needs-human) — no action above the conservative floor is ever marked auto. Deterministic (no LLM dependency) so it runs unattended and is test-pinned; an LLM agent is a later enhancement, not a prerequisite.
  - **AI-MSP auto-propose** (`lib/federation/auto-propose.ts`, wired into `/api/v1/federation/incident`): when the MSP side (`role==="manages"`) receives a federated incident, it diagnoses and sends a remediation PROPOSAL back to the sovereign customer over the same link (B4 outbound). Best-effort; only the managing side proposes; the customer re-evaluates through its own consent gate.
  - **Dual-approval relay** (`/api/v1/federation/approval-relay` + `relayApprovalToPeer`): the genuine unblocker for a link reaching `trusted`. When an operator approves locally, we relay that approval to the peer so it flips `approvedAtPeer`; the relay route authenticates the link token directly (a *pending* link is exactly the state that needs to become trusted, so it does not require `trusted`). Flag-gated, best-effort — a relay failure never fails the local approval.
  - **Connect-to-a-peer** (`enrollWithPeerAction` + admin form): the outbound side of enrollment — redeem a peer's invitation token, store the peer link token encrypted, establish our half of the link. Completes the round-trip with the existing inbound `/api/v1/federation/enroll`.
  - **Proposal decision surface** (`/platform/federation-proposals` + `decideFederatedProposalAction`): the customer-side Attention surface for federated proposals — manage_platform-gated list with approve/reject; approve stamps `executionEvidenceRef="pending-control-runner"` (honest stub: execution lands when EP-CTRL-5E21A4's runner exists). New `federatedProposalStatus` StatusBadge domain. Standalone page rather than coupling to the unbuilt EP-ATTENTION-SURFACE.
  - **SSRF guard on every peer egress** (`lib/federation/client` `postToPeer` chokepoint): the operator-supplied `peerAuthorityUrl` is a CWE-918 sink, so all outbound calls (incident/proposal/enroll/approval-relay) now pass through `assertSafeOutboundUrl` (`lib/security/safe-fetch`). Safe-by-default: **https + public hosts only**; a blocked URL is a soft failure, never dialed. Local/LAN federation (two on-prem instances, dev) opts in explicitly via **`DPF_FEDERATION_ALLOW_INSECURE_PEERS`** (permits http + private/loopback) — **set this for the two-instance local test** if the peers are on localhost or a private LAN. (Fixes the CodeQL critical the connect-to-peer dataflow surfaced.)
  - 39 federation/service-desk + 2 SSRF-guard unit tests; apps/web typecheck clean; route manifest regenerated (approval-relay + federation-proposals present). UX-Fit: fits-with-guardrails — reuses report-kit + theme tokens + the reviewed admin pattern; contextual under `/platform`; in-app dialogs only; no new global nav.
- **Remaining (genuine cross-epic boundaries — not gaps in this epic):** (1) **execution** of an approved proposal runs through the EP-CTRL-5E21A4 control-runner, which is unbuilt — approval honestly stamps `pending-control-runner` until it exists; (2) **LLM-agent diagnosis** is a future enhancement over the deterministic A4 mapper (the loop runs without it); (3) **founder authority-band decision** (§15.4) is required before any federation *auto*-approve above the conservative read-only/propose-only floor — a business decision BLOCKED on Mark; (4) **two-instance live verification** (two DPF deployments, dual-approved link, incident→proposal→decision round-trip) — founder end-to-end testing, both flags (`DPF_EDGE_INCIDENT_CORRELATION_ENABLED`, `DPF_FEDERATION_EXCHANGE_ENABLED`) default-off until verified.

## Verification

- Pure libraries: vitest (no DB).
- Schema: `prisma validate` + hand-authored migration; applied on the canonical install (source-only worktree cannot run `migrate dev`).
- Routes/writers: `tsc --noEmit`.
- Founder does end-to-end runtime testing on completion.
- **R5 — projection-contract egress enforcement (runtime arm of B2 / spec §15.1).** The B2 projection-serialization library was the capability; R5 applies it at the one payload that crosses a link today — the outbound incident push. New pure `packages/db/projection-egress` (`resolveIncidentProjectionSpec`: coerce the link's `proposedProjection`, else minimum-necessary default — "no contract" means minimum-necessary, never "send everything"; `projectIncidentForEgress`: allow-list + forbidden-field strip + negative-egress proof). Wired into `lib/federation/push`: every field is minimized through the link's contract before egress, and an incident whose projection still proves a violation is withheld, never sent. 7 db + 9 web unit tests (off-list + forbidden fields proven never to cross the wire); `@dpf/db` + `apps/web` typecheck clean. Migration-free (both models already exist). Makes the "minimum-necessary, client data never crosses the link" sovereignty claim true on the wire, not just in the library.
