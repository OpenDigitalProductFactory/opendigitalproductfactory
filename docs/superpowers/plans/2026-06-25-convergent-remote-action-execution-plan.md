# Implementation Plan — Convergent Governed RemoteAction Execution

**Date:** 2026-06-25
**Spec:** `docs/superpowers/specs/2026-06-25-convergent-remote-action-execution-design.md`
**Proposed epic:** `EP-REMOTE-ACTION`
**Converges:** `EP-MSP-FEDERATION` · `EP-PATCH-MANAGEMENT` (§7.3 RemoteAction) · clarifies vs `EP-CTRL-5E21A4`
**Mode:** Direct in-worktree (founder-directed 2026-06-25, continuing the federation work). Founder reviews each PR; remote-mutation phases (P2/P3) are GATED on founder sign-off + a threat model.

## Sequencing principle

One primitive, two consumers. Build the **governance + record + seam** before any executor, so the dangerous capability (remote mutation on a customer estate) is the *last* thing added, behind hard gates — not the first. P1 is valuable and honest on its own: the proposal→execution lifecycle becomes real and auditable while nothing actually runs.

## Verified substrate (compose, do not duplicate)

- **Band kernel — shared, pure, done.** `apps/web/lib/service-desk/remediation-authority.ts` (`evaluateRemediationAuthority`, `buildRemediationProposal`, `authorityBandFromBinding`, `CONSERVATIVE_AUTHORITY_BAND`). No second approval engine.
- **`RemoteAction` shape — specced in EP-PATCH-MANAGEMENT §7.3** (generic on purpose; "patching is the first consumer… service restart… can reuse it"). Adopted, not reinvented.
- **`FederatedRemediationProposal`** (schema.prisma:10652) — the cross-org proposal whose `executionEvidenceRef` was the dead `"pending-control-runner"` stub.
- **`AuthorityBinding`** (2183) / **`ChangeRequest`** (755) — authority source + change audit anchor.
- **Edge dispatch channel: ZERO today** (verified) — the Edge is push/pull-only; no `action:dispatch`/`action:report` scope, no downward route. This is *why* P2 is a hard gate, not an oversight.

## Phasing

- **P1 — governance + record + seam (this PR; safe, no remote mutation).**
  - `RemoteAction` model (patch §7.3 shape + `originProposalRef` / `originLinkId` convergence fields) + additive migration.
  - Pure planner `remote-action-planning.ts`: A4-verb→`actionType` map; **consent re-check** against the current band (never the frozen decision); read-only→`approved`, mutating→`proposed`, refuse→withheld; unknown riskClass→`high` (fail-safe).
  - DB orchestrator `remote-action-execution.ts`: materialize the rows on the customer's side; MSP recorded as `requestedByPrincipalId`, link as `originLinkId`; `status="queued"` (nothing dispatches — no P2 channel).
  - Wire into `decideFederatedProposalAction`: approve materializes + stamps a real `executionEvidenceRef`; reject unchanged.
- **P2 — Edge dispatch channel (GATED on founder sign-off + threat model).** `action:dispatch`/`action:report` token scopes, machine-bound Edge trust (mTLS/DPoP/attested key), the downward dispatch + result-ingest routes, the focused threat model (command injection, package-manager abuse, token theft/replay, confused deputy, downgrade, rollback failure, compromised Edge). This is where execution becomes real.
- **P3 — mutating backends.** Native package managers (patch), `service.restart` (federation), reboot policy — each behind P2 + per-node action-type allow-list + `ChangeRequest` + maintenance window.

## Cross-cutting

- Conservative band default until the founder sets §15.4 pilot bands — only read-only auto-approves; everything mutating waits for a human.
- The §6 sovereignty rule (`originLinkId != null` ⇒ no autonomous transition past `proposed`) is enforced structurally at materialization and (in P2) at dispatch.
- Additive migration only; applied on the canonical install (source-only worktree cannot `migrate dev`).

## Verification

- Pure libs: vitest (planner, no DB).
- Orchestrator: vitest with an injected `RemoteAction` create mock (provenance, sovereignty, approval partitioning, evidence ref).
- Action wiring: `tsc --noEmit`; `prisma validate`.
- Founder reviews the PR; no remote execution ships in P1.
- **Two event-management scenarios (founder-stated 2026-06-25) — both functionally verified on the live install once P2 lands:** (1) **INTERNAL** — the org's own estate (Edge watches own infra; RemoteAction acts on own hosts; `customerAccountId` null). (2) **IT-MSP CUSTOMERS** — the MSP archetype managing customer estates: Topology A (scoped `customerAccountId`/`customerSiteId`) and Topology B (sovereign-peer federation / proposal-not-action). The dispatch-eligibility unit tests cover both scope shapes; live two-instance verification covers the channel.

## Progress log

- **P1 — RemoteAction model + proposal→RemoteAction seam.** `RemoteAction` model + `20260625130000_add_remote_action` migration; pure `remote-action-planning` (map + consent re-check + partition) and DB-injected `remote-action-execution` (materialize); `decideFederatedProposalAction` now replaces `"pending-control-runner"` with real, governed RemoteAction rows (read-only `approved`, mutating `proposed`, all `queued` — nothing dispatches). 9 unit tests; `@dpf/db` + `apps/web` typecheck; `prisma validate` clean.
- **P2 DESIGN REFINEMENT — the dispatch channel is PULL, not a downward push.** The Edge is outbound/pull-only today (pulls adapter config + heartbeat, pushes discovery/events/metrics). P2 keeps that shape: the node POLLS for the queued actions it may claim — no new inbound-to-Edge port, strictly improving the SSRF/firewall posture over the threat model's original "downward dispatch" framing (which updates to "edge-pull + signed action envelope"). The threat-model requirements (mTLS, scopes, single-use signed envelope, scope enforcement, evidence) are unchanged; only the direction is.
- **P2 slice 1 (read-only pilot, this branch) — pure dispatch eligibility + lifecycle.** `packages/db/remote-action-dispatch`: `isClaimableByNode` / `claimableActionsForNode` enforce the read-only gate (riskClass + actionType allow-list, defense-in-depth), tenant scope (`nodeScopeMatchesAction` — internal null-scope vs customer-scoped), node trust + the `action.execute` capability; plus `canTransitionDispatch` for the queued→claimed→running→terminal state machine. 17 unit tests covering BOTH event-mgmt scenarios (internal + IT-MSP-customer + federation-origin) and every gate. Pure (no DB), no live channel wired — slice 1 is the security core. Later slices: the pull/result routes (thin), mTLS machine-bound trust + token scopes (deployment), and the Edge-agent side (live verification). `@dpf/db` typecheck clean.
- **P2 slice 2 (this branch) — the pull-channel substrate + routes (flag-gated OFF).** `action.execute` reserved capability (default off — not in PHASE_0, never auto-accepted; threat model §5 R3) + `edge:actions:claim` / `edge:actions:report` token scopes (both require `trusted`; §5 R2). DB-injected `lib/remote-action/dispatch-orchestrator`: `claimActionsForNode` (coarse account-scoped query → precise `claimableActionsForNode` gate → guarded `queued→claimed` single-claim with `edgeNodeId` binding) and `recordActionResult` (claim-ownership check + legal transition + terminal evidence). Two thin routes `POST /api/v1/edge/actions/{claim,result}` gated behind **`DPF_REMOTE_ACTION_DISPATCH_ENABLED`** (404 when off) — the node only claims if its `action.execute` capability is `enabled`. 25 web + (carried) db unit tests; `apps/web` typecheck clean; route manifest regenerated (521). No mutation, no live channel, no migration. **Remaining for a live read-only channel: mTLS machine-bound trust + the signed action envelope (R1/R4 — slice 3, deployment), and the Edge-agent side that runs the collector + posts results (slice 4) — both land in the founder's two-instance verification.**
