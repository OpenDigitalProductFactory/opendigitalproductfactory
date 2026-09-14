---
status: proposed
---

# Restore the alternate initiative research reviewer

Backlog: BI-ECFE0AC2. Workroom: WC-F836CFFC. Delivery beneficiary: BI-B19AF1F3 / WC-60566397.

## Verified problem

On canonical runtime `18a6520aba5aa2005d2d4d70501b69f2bc8b4c7a`, the original Build Lead research TaskRun for BI-B19AF1F3 is permanently exhausted. Replaying the server-issued packet returns the existing task without a new attempt and instructs the caller to select a different eligible reviewer/provider. Evidence: `cmu0srvgy7gyx01ml2vtq1ekd`.

The live AgentToolGrant rows contain exactly two initiative_evidence_write holders: Build Lead and Portfolio Advisor. Only Build Lead has file_read. The canonical registry at the same commit likewise omits file_read from AGT-WS-PORTFOLIO. The source reader requires file_read, and the recovery selector correctly excludes writers that cannot read the immutable artifact. Consequently the only alternate research writer cannot perform its assigned review.

PR #5246 is deployed and addresses CLI dispatch, but it does not change previously exhausted tasks or supply missing reviewer grants. Repeating the exhausted request, changing its idempotency key to disguise a retry, or treating a merged PR as a receipt does not resolve this defect.

## Options and choice

1. Extend Portfolio Advisor's canonical role grants with file_read, retaining the existing immutable binding and reader/writer checks. Chosen: this equips an existing receipt writer to inspect its evidence through the existing read-only tool contract.
2. Reset exhausted TaskRun counters after a runtime change. Rejected: a deployment alone does not prove provider recovery, and a reset would undermine bounded retries.
3. Add a new reviewer or let the author write the missing receipt. Rejected: duplicates existing roles or changes the separation of authority.

This is a role provisioning repair, not a change to receipt authority. Existing revocation tombstones remain authoritative; a deliberate operator revocation must not be resurrected by seeding. No runtime grant is changed by this design.

## Existing architecture

`packages/db/data/agent_registry.json` owns canonical role grants. The seed consumes those grants with revocation handling. `apps/web/lib/tak/initiative-readiness-tool-grants.ts` owns eligible reviewer selection and requires the writer and reader grants together. `request_coworker` validates the immutable artifact and Workroom binding, and the terminal writer contract requires a persisted receipt before completion.

## Ordered implementation and proof

1. Add a regression assertion against the canonical Portfolio Advisor registry entry that it has the reader grant required by its research writer. Demonstrate failure on the named baseline.
2. Add file_read to that role's canonical grant list. Keep the same regression green and run the existing grant-consistency and initiative-review routing tests.
3. Document that Portfolio Advisor can read immutable source artifacts when reviewing initiative evidence. Record source-local checks and complete the required review and merge gates.
4. Deploy through the canonical self-upgrade path. Read back live grants and the served commit before exercising the alternate reviewer route for the unchanged BI-B19AF1F3 artifact. Preserve the exhausted original task.
5. Verify the alternate task records its research receipt, then complete plan coverage, delivery evidence, independent acceptance, and objective reconciliation through the existing governed tools. If the writer fails again, record the observed failure; do not infer acceptance.

## Acceptance criteria

- The canonical Portfolio Advisor role includes both initiative_evidence_write and the source reader's file_read grant.
- Seed convergence supplies this role contract without overriding explicit revocations.
- Existing routing tests still exclude incomplete reader/writer pairs and enforce immutable artifact identity.
- On the upgraded runtime an eligible alternate reviewer can read the exact artifact and persist a research receipt; the exhausted original TaskRun remains unchanged.

## Documentation and migration impact

The role's source-reading capability needs a short contributor-facing explanation. No schema migration is required; the existing additive registry seed owns role grant convergence. The role gains read-only source access, so security review must consider all tools exposed by file_read, not only the immutable reader.
