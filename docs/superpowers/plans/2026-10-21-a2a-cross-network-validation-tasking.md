# Cross-Network Peer Validation Tasking — Implementation Plan

**Date:** 2026-10-21

**Umbrella:** `BI-AD9ABD38` (xlarge, decomposed) under `EP-E1F1DB58`

**Design:** [Cross-Install A2A Coordination](../specs/2026-08-11-a2a-coordination-layer-design.md), revision 2026-10-21, §18–§24

**Decisions:** `DI-656436759566` (transport), `DI-13CEFD0A8156` (trust), `DI-259D82329EF4` (execution)

**First proof:** `BI-BCF474E7` — a PROD thread asks the DEV install to run the Windows PowerShell twins of #6301, #6308, #6309 and #6530, and receives the results as evidence on that item.

**Status:** Draft. Plan coverage is recorded after the design's independent spec approval mints the scope baseline. No implementation starts before that and before plan review.

## 1. Outcome

A thread on the operator PROD install names a validation recipe and an exact commit. The DEV install runs it under its own gates through its native Windows Edge node, and the signed result returns to the same PROD thread and to the backlog item. This works with both installs behind NAT and either side offline for days. It does not give DEV any way to reach other organizations' data or PROD's records.

## 2. Phases and backlog coverage

Every independently shippable deliverable maps to a live backlog item.

| Key | Deliverable | Backlog item | Depends on | Design | Acceptance |
| --- | --- | --- | --- | --- | --- |
| P1a | Attested peer environment class; the stance reads the peer; undeclared class blocks membership; the paired-installation label names the installation | `BI-0716C8A8` | — | §19.1 F1–F3, F5; §19.2 | AC-XN-09 |
| P1b | Organization boundary on work-sync egress and ingress | `BI-3E31B240` | — | §19.1 F7; §19.6 | AC-XN-10 |
| P1c | First-hop delegation intersection | `BI-FD00E416` | — | §19.1 F8; §19.5 | AC-XN-12 |
| P1d | Offer POST credential: reproduce, then fix | `BI-D00C5FD4` | — | §19.1 F12 | its own AC-1 to AC-3 |
| P2a | Overlay enrolment of both installs (operator-provided) | `BI-CAF86466` (existing) | operator D1–D2 | §18.2, §22 | its own AC-1 to AC-4 |
| P2b | Federation over the overlay: tag ACLs, overlay peer URLs, SSRF allow-list | `BI-80658CD3` | P2a | §18.2 | AC-XN-13; work sync recovers |
| P3 | Peer validation task contract: signed envelope, outbox/inbox, `/api/v1/federation/a2a`, `TaskRun` correlation, `request_peer_validation`, evidence return | `BI-B45BBD8A` | P1a, P1b, P1c | §18.3, §19.4–19.5, §20.4 | AC-XN-01 to 03, 05 to 09, 11 |
| P4a | Windows native Edge convergence | `BI-0C326236` (existing) | — | §13.2 | its own |
| P4b | Recipe catalog and Edge `validation.recipe.run` | `BI-7A836207` | P4a | §20 | AC-XN-01, 03, 04 |
| P5 | First proof on the two physical installs | `BI-BCF474E7` (existing) | P2b, P3, P4b | §20.3 | its own AC-1 to AC-4; AC-XN-02 |

The phases are not one atomic change. P1a–P1d, P2 and P4 can each ship and be verified on their own, and P1b closes a live data-boundary defect regardless of the rest. So the coverage decision is **decomposed**.

**Parallel lanes:** P1a, P1b, P1c, P1d and P4a have no dependencies on each other. P2a waits only on the operator.

**Thinnest path to the proof:**
1. P1a, P1b and P1c.
2. P2a, then P2b.
3. P3.
4. P4a, then P4b.
5. P5.

P1d is a standalone security repair and is not on this path.

## 3. Phase detail

### P1 — trust repairs (prerequisites)

Each starts with a failing test that reproduces the cited line on `origin/main`.

- **P1a:**
  - Add `peerEnvironmentClass` and `peerEnvironmentAttestedAt` columns to `FederationLink`. This needs a migration, a data-impact manifest and a classification entry.
  - Attest DID and class in the organization-CA membership statement.
  - `resolvePeerWrite` takes the peer class.
  - Existing links migrate as unattested.
- **P1b:**
  - Add an organization predicate to `OWNED_BACKLOG_WHERE` and to the epic projection.
  - Re-check the organization on ingress in `work-sync.ts`.
  - Retire foreign mirrors on the next complete sync.
- **P1c:**
  - Compute the intersection in `delegation-authority.ts`.
  - Run a blast-radius sweep of the callers.
- **P1d:**
  - Reproduce against a running install first. If `proxy.ts` already blocks the request, record that and close as not reproducible.

### P2 — reachability

- **P2a** is operator setup (design §22 D1–D2). The agent prepares the exact ACL policy and verifies the result. It never handles the operator's overlay credentials.
- **P2b** is the first observable cross-network proof: the existing work sync between PROD and DEV succeeds over the overlay.

### P3 — peer task contract

The contract adds:
- envelope types and validators in `packages/db/src`;
- the outbox record type;
- the ingress route with signature, DID, class and organization checks, before any `TaskRun` is created;
- inbox idempotency;
- `TaskRun` peer fields;
- the `federated-peer` grant `peer_validation_request`;
- the sender tool with dispatch confirmation;
- a result handler that posts to the parent thread and records evidence on a PROD-owned item.

Reconcile with plan slice S4 (task ingress) and plan slice S2 (device pinning / signed events) once they are readable on PROD (design §21.1).

### P4 — DEV execution

- The recipe catalog lives under `config/`, which needs a `Convergence-Impact-Decision:` trailer.
- One Go executor branch handles `validation.recipe.run`.
- Each run uses an ephemeral checkout of the SHA fetched from origin, with redacted, capped output.
- Host-mutating recipes need DEV-local approval.
- A human-attested artifact covers checks that can't run unattended.

### P5 — first proof

From a PROD thread, request `win.mcp-client-env.tests`, `win.mcp-health.tests` and (with DEV approval) `win.bootstrap-toolchain.apply` at the head SHA that contains the four PRs. Expect:
- TAP results recorded on `BI-BCF474E7`, with provenance;
- a human-attested result for the Claude desktop connector;
- every failure filed as its own defect.

Then repeat the offline cases AC-XN-05 to AC-XN-08 with each install switched off in turn.

## 4. Verification

- **Unit and contract tests per phase:** signatures, replay, idempotency, expiry, organization filter and authority intersection. These are prerequisites only.
- **Functional evidence:** recorded on both canonical installations, per design §14 and §24. A worktree-only green run is a source checkpoint, not acceptance.
- **Unverified at plan time:** DEV's declared class, served version, Edge status and PowerShell hosts (design §21.1).

## 5. Rollback

- Each phase is behind `DPF_FEDERATION_A2A_ENABLED` or a recipe-catalog enable switch, and the route refuses when the switch is off.
- P1b's filter is not rolled back. It closes a defect.
- Removing the overlay returns both installs to the held-outbox state, and nothing queued is lost.

## 6. Coverage receipt

Pending. Recorded with `record_plan_backlog_coverage` (decision `decomposed`, the deliverables in §2) after spec approval mints the `BI-AD9ABD38` scope baseline. The receipt id will be copied here when it exists.
