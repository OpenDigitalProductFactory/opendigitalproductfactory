---
status: active
backlogItem: BI-25CB699C
workroom: WC-E5A3C871
---

# Settle terminal lease waits without inventing admission

## Design grounding

Extend the existing [bounded lease retry contract](../specs/2026-08-31-lease-retry-storm-control.md)
and [validation evidence reuse plan](2026-10-12-validation-evidence-reuse.md).
Source inspection of `apps/web/lib/nonprod/environment-lease.ts` found that
terminal releases return before assigning `priorStatus`. The existing
`afterNonprodLeaseRelease` in `apps/web/lib/nonprod/durable-wait.ts` maps the
empty string to admitted, so settling an expired wait can invent admission.
This is a source finding, not a mutation or reproduction on the live old task.

Reuse the canonical release lifecycle, durable TaskRun wait projection and
capacity publisher. No new tool, table, queue, grant, receipt or retry identity.
The coordinator assigned this separate atomic unit under existing DEV recovery
authorization; prior merged rooms and parent acceptance status remain intact.

## Acceptance criteria from the live item

- AC-1: After a PASS at commit A, a signed merge of origin/main with no change to the branch's own diff can be pushed after the refresh tier passes, without waiting for a full local-CI slot.
- AC-2: A merge that changes the branch's own diff, such as hand-resolved conflicts in the branch's files, runs the affected tests. A merge that alters branch-authored logic still requires the full gate.
- AC-3: The merge queue remains the authoritative main+PR build. Nothing merges without it.
- AC-4: A re-claimed waiting gate keeps its queue position.

The October 12 founder clarification supersedes AC-2's unconditional local
full-gate replay. This unit repairs truthful settlement at AC-4's terminal
boundary; it does not declare the entire parent complete.

## Atomic implementation and verification

CT-TERMINAL-WAIT / FLOW-LEASE-RELEASE / VC-TERMINAL-WAIT:

1. Add focused failing tests through the real release and durable-wait helpers:
   expired/cancelled waits settle terminal, existing lease and TaskRun identity
   remain unchanged, and no execution verdict, sibling task or receipt is minted.
2. Carry the actual prior status out of the release transaction rather than
   relying on a mutable empty sentinel. Only active or previously released
   admission is admission evidence; queued, cancelled and expired are terminal.
   Preserve already-settled wait history and repeated-release idempotency.
3. Verify normal active release, queued cancellation, previously released leases,
   binding mismatch and immutable-owner refusal. Run graph-linked durable-wait,
   environment-lease, host-resource, liveness and self-admission suites, plus
   adjacent admission/MCP tests; both web TypeScript programs and diff guards.
4. Native impact contract is resolved. Its testImpact entries resolve to the
   five suites above; its style-drift guard and doc-index check are mandatory.
   Freeze signed source for independent coordinator review and publication.
   Full integration and live acceptance remain unrun/delegated, not passed.

One atomic deliverable: release status transport, settlement mapping and tests
must ship together. No live old-task mutation or fabricated original pin.
No UI, schema or external API change. Refactoring removes the ambiguous status
sentinel at the lifecycle boundary. No operator-documentation change is needed:
the supported release action is unchanged; this plan records its corrected
terminal semantics and the source tests guard them.

## Risks and rollback

Do not rewrite historical admission as command success, or turn a terminal
attempt into admission. Existing completed waits retain their actual history.
Preserve capacity wake publication, transaction locking and owner checks.
Rollback is a signed revert PR; no persisted state migration or bulk cleanup.

## Backlog coverage

Atomic mapping: terminal-lease-wait -> BI-25CB699C, no dependencies.
Requirement refs: AC-1, AC-2, AC-3, AC-4.
Contract ref: CT-TERMINAL-WAIT. Flow ref: FLOW-LEASE-RELEASE.
Verification ref: VC-TERMINAL-WAIT.
Record native coverage against the immutable plan before source implementation.
