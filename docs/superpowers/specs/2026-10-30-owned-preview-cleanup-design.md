---
status: draft
date: 2026-10-31
backlog: BI-31AC1F90
---

# Owned DEV preview reservation cleanup

Workroom WC-B0685306. Research source: ea62f5fb890390bde854b618834f5e77fd3865ea.

## Problem and evidence

This repairs the browser-preview reservation path, not host process cleanup.
On canonical DEV dc1e4b5f66fae06c5c1cfcb8f82ec79b971e5cc7, fresh governed
sign-in, read-only installation verification, sign-out and tab closure succeeded.
The exact owner release of NPEL-780026FEDA instead required approval envelope
cmvuej1sp5o0i01meqybb00e4. No retry or self-approval occurred. A later exact
native read proved persisted expiry, activeKey null and releasedAt04:00Z on
October 30. That expiry did not execute the pending envelope.

An executed comparison is local-CI NPEL-D896B2422D: the same chat's normal
gate completed and the reservation persisted released at04:58:58Z, with a
deterministic TaskRun, manifest1 and EER cmvui5l3r6bog01me7ia0pqkh. This is
ownership-path evidence, not proof that the preview repair already works.

Current source explains the distinction. environment-lease-provenance.ts only
creates immediate provenance for local-integration-ci. The cleanup refiner
requires that environment, manifest and Task. MCP claim forwards the
authenticated user, but release discards authenticated user/context. The
locked release core only owner-fences immutable gate claims. Removing one
environment condition would therefore be insufficient.

## Design grounding

Reuse environment-lease.ts, environment-lease-provenance.ts, durable-wait.ts
and lease-cleanup-consequence.ts as the single lease/ownership substrate.
The prior [host reservation design](2026-10-26-owned-host-cleanup-design.md)
keeps process-owned cleanup controlled and uses expiry observation. Its
approved scope is not amended or inherited here. The
[maintenance classification design](2026-10-11-routine-maintenance-request-design.md)
already requires trusted creation attribution and a locked unused-only check.

## Contract

**OBJ-PC-1:** A qualifying owner can release a process-free DEV preview without
another employee approval.
**OBJ-PC-2:** Consent classification and execution use the same stored owner
proof and current-state predicates.
**OBJ-PC-3:** Foreign identities, uncertain ownership and controlled operations
retain their existing protection and history.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-PC-1 | OBJ-PC-1, OBJ-PC-2 | New immediate and queued preview admission atomically records the authenticated original human/assistant plus exact lease and wait identity. |
| AC-PC-2 | OBJ-PC-1, OBJ-PC-2 | Only a currently authorized matching owner can close an unused or terminal process-free reservation, with proof rechecked under the release lock. |
| AC-PC-3 | OBJ-PC-3 | Foreign, process-owned, production/unknown and stale or malformed bindings never obtain routine cleanup; explicit always-human policy and old envelopes remain binding. |
| AC-PC-4 | OBJ-PC-1, OBJ-PC-3 | Source negative/race tests, qualified publication and fresh canonical immediate/queued admission and release prove the contract separately. |

At fresh preview creation, bind the original authenticated user and assistant
from trusted handler context, never from tool parameters. Store immutable
attribution in the existing deterministic TaskRun/wait metadata and link it
inside the lease transaction for both active and queued admission. Failure
rolls back creation. Reuse and queue transitions preserve this attribution;
they never manufacture it for a legacy lease or adopt a caller-provided Task.

The ownership tuple includes lease/claim/environment, provider/session,
worktree/branch and the admitted reservation target. A session string is a
resource identifier, not authentication. Conversations sharing one approved
assistant credential share that assistant principal; this does not invent a
cryptographic per-chat boundary or a new credential.

One shared proof reader serves consent narrowing and locked execution. Require
current effective development/evolve-dpf stance, exact authenticated owner,
matching trusted Task/wait and lease state, and no process/host-resource or
cleanup command. Preserve existing local-CI behavior. Scope ordinary preview
cleanup to the existing closed leaseId/ownerSessionId call form; no arbitrary
override or caller boolean asserts that work finished.

Forward the actual authenticated actor into release. Under its existing
environment lock, read the current lease and proof again before any mutation.
A lost proof, changed actor/target/state or newly attached process fails closed;
it cannot fall through to legacy behavior after ordinary consent was selected.
Repeated own terminal closure is idempotent. Existing trusted internal expiry
and reconciliation remain legitimate; reservation closure proves neither
command success nor descendant termination.

No table, tool, role, grant, credential, public argument or environment override
is added. Legacy and process-owned leases retain controlled release or normal
expiry. Pending and failed envelopes are not rewritten or marked executed.

## Ordered implementation and failure analysis

1. Add failing service, actor-forwarding, durable-wait and refiner regressions
   for fresh immediate/queued proof and locked release races.
2. Refactor existing fresh Task creation and wait preservation; add the shared
   preview proof writer/reader. Keep local-CI public behavior intact.
3. Wire trusted claim/release actor context and locked execution checks.
4. Run linked/colocated tests, DB transaction coverage, both web typechecks,
   impact guards and canonical qualification. Independently assess the frozen
   change, publish through protected CI/merge queue, then verify canonical DEV.

All steps are internal sequencing for one atomic repair. A classifier without
creation proof or execution validation would recreate the defect or a race.
Implementation detail and four-way coverage are in the
[implementation plan](../plans/2026-10-30-owned-preview-cleanup.md).

Missing Task persistence must roll back; corrupted or erased metadata must
refuse ordinary closure. Queue transitions must preserve ownership. Foreign
identity, stale reassignment, process attachment and stance changes are checked
at use, not trusted from a prior classification snapshot. Test each explicitly.
Revert the caller/provenance/refiner integration together if needed; retained
records remain historical and unrecognized proof returns to the controlled
path. No destructive cleanup, TTL adjustment or policy override is rollback.

At first publication (a481a6235d7eb728c2299596ea3efc4b9a8d3c90), this was
design only. Current planning receipts and implementation sequence are in the
plan; current test, publication and runtime outcomes belong in the Workroom.
This design document alone claims no live acceptance.
