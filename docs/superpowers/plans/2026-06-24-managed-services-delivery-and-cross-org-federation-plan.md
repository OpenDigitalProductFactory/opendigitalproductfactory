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
- **Remaining (runtime wiring, needs the live portal — founder testing):** A4 grant-registry unblock + operate-orchestrator loop wiring; B3/B4/B5 persistence wiring (create mirrors on incident sync, post proposals to the Attention Surface, execute via the EP-CTRL-5E21A4 runner, publish governed artifacts); the federation peer-side outbound client + approval/projection routes + admin UX surfaces (spec §8); founder authority-band decision (§15.4) before any federation auto-approve.

## Verification

- Pure libraries: vitest (no DB).
- Schema: `prisma validate` + hand-authored migration; applied on the canonical install (source-only worktree cannot run `migrate dev`).
- Routes/writers: `tsc --noEmit`.
- Founder does end-to-end runtime testing on completion.
