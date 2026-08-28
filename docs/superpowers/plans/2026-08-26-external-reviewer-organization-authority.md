---
status: active
---

# External Reviewer Organization Authority Repair

**Backlog item:** BI-F48D7059
**Epic:** EP-56AE0F69
**Branch:** `fix/reviewer-org-authority-replay`

## Outcome

An external reviewer bound to an organization-owned initiative must carry that initiative's canonical organization through both the first governed writer request and the exact approved replay. The authority decision must be derived from server-owned task binding, not model-supplied arguments or caller-supplied organization text.

This repairs the readiness path blocking BI-MCP-EFF-0285909C without weakening the receipt repository's organization-mismatch rejection.

It also repairs the concrete BI-47 replay fixture without minting a sibling
TaskRun: exact TaskRun `...96433C11CA61`, matching request digest, five successful
immutable reads, expired approved envelope `cmtcyo4h900m001pa2ma0itjn`, and no
writer execution or receipt after the canonical stale-row reaper projected the
run to `stalled`.

## Reproduced evidence

The BI-MCP research reviewer was created with an immutable `initiativeReviewBinding` for the initiative, gate, artifact, writer tool, reviewer, and input. Its narrow writer schema correctly exposed only `{ decision: "pass" }` to the model.

The first writer request produced an approval envelope. After owner approval, the exact request-key replay reached the writer but failed with `Reviewer authority does not match the initiative organization.` The corresponding authorization logs recorded a null organization for both the approval-required and allow decisions, while the bound initiative belongs to the `rescue` organization.

The ordering explains the failure:

1. `governedExecuteTool` resolves authority from raw tool arguments.
2. The narrow bound writer arguments contain no `itemId`.
3. The initiative-readiness handler later restores the immutable binding from `TaskRun.a2aMetadata`.
4. The receipt repository sees the organization-owned initiative and correctly rejects the earlier platform-scoped authority decision.

## Design

Extend coworker tool-authority resolution with a trusted bound-initiative context derived from the server-owned `TaskRun`:

1. Select `a2aMetadata` and `authorityScope` with the existing task lookup.
2. Accept a bound initiative only when the task is an external MCP task, the binding's writer tool matches the tool being executed, and the task authority scope contains the exact writer tool and backlog item.
3. Resolve the canonical backlog item and its organization from the database.
4. If an authenticated organization is present, continue to reject a mismatch.
5. If no authenticated organization is present, allow organization derivation only for the validated server-bound task context. Direct calls remain unable to self-assert an organization through parameters.
6. Preserve the existing platform mapping for organization-neutral initiatives.

The exact replay already validates the stored request digest and immutable reviewer binding. This change supplies the missing authority subject before the approval decision; it does not broaden the writer payload or bypass approval.

## Rejected alternatives

- **Add organization or item fields to the model-visible writer schema.** This would let untrusted tool arguments influence authority and duplicate immutable binding data.
- **Trust a caller-provided organization on the runtime context.** External task entry points do not consistently have one, and the canonical initiative is the stronger source.
- **Relax the receipt repository mismatch check.** That would hide the authorization defect and permit cross-organization evidence.
- **Patch only approval replay.** The initial approval decision would still be logged under the wrong authority; first call and replay must resolve identically.
- **Use generic `taskrunRetry`.** It creates a sibling TaskRun and loses the immutable reviewer identity required by the acceptance contract.
- **Execute or extend the expired approval.** The schema has no durable `approvedAt`; expiry therefore remains a hard authority boundary.
- **Rerun model inference.** The original reader work and writer choice are already persisted. Re-inference would spend a second reviewer identity and could change the decision.

## Same-TaskRun recovery design

Add a small transaction-focused recovery module at the external task submission
boundary. On identical replay, it re-reads and validates the persisted digest,
stale heartbeat, exact approved envelope binding, original writer proposal, and
absence of a successful writer or receipt.

For an unexpired envelope, compare-and-swap the same `working` or `stalled` row
to `input-required` and continue through the existing approved-writer resume.
An `input-required` row remains on that normal resume path and recovery never
replaces its unexpired approval. For an expired envelope, atomically cancel it,
create a new proposed envelope with the same server-stored binding, clone the
failed proposal with its original writer parameters and the replacement envelope
id, and park the same stale `working`, `stalled`, or `input-required` TaskRun for
fresh exact approval. Preserve the recovery audit through final execution.

## Test-first implementation

1. Add failing authority-resolver tests proving that a validated external task binding resolves an organization-owned initiative before handler execution.
2. Add negative tests for writer-tool mismatch, missing exact authority scope, and authenticated-organization mismatch.
3. Add platform-neutral coverage to prove null organization continues to map to platform authority.
4. Implement the smallest resolver change that makes those tests pass.
5. Exercise the approval/replay integration path and assert the initial `require_approval` and resumed `allow` decisions use the same organization and execute the writer once.
6. Run focused tests, typecheck, policy guards, blast-radius verification, independent semantic review, and the exact-tree local merge gate before publication.
7. Add failing recovery tests for the exact stalled/expired BI-47 fixture, the
   input-required/expired BI-F48 fixture, the unexpired CAS path, unexpired
   input-required refusal, fresh-heartbeat refusal, changed-digest refusal, and
   existing writer/receipt refusal.
8. Integrate the recovery transaction into identical external task replay and
   prove no agentic inference, TaskRun creation, or direct writer execution occurs
   while fresh approval is required.
9. Preserve the recovery audit when the approved writer completes.

The semantic-review evidence packet must embed the exact committed patch. Commit,
tree, and digest identities alone are insufficient when the reviewer cannot read
the contributor worktree; a cached evidence-insufficient receipt must never be
treated as review completion.

## Expected code surface

- `apps/web/lib/govern/authority/resolve-coworker-tool-authority.ts`
- `apps/web/lib/govern/authority/resolve-coworker-tool-authority.test.ts`
- `apps/web/lib/mcp-task-approval-recovery-contract.ts`
- `apps/web/lib/mcp-task-approval-recovery.ts`
- `apps/web/lib/mcp-task-approval-recovery.test.ts`
- `apps/web/lib/mcp-task-submit.ts`
- `apps/web/lib/mcp-task-submit-approval-recovery.ts`
- `apps/web/lib/mcp-task-submit-approval-recovery.test.ts`
- `apps/web/lib/mcp-task-submit.test.ts`

No schema, migration, public route, or customer-facing documentation change is expected. The operational documentation impact is this plan plus the existing resilient gate-flow documentation that this repair unblocks.

## Risks and rollback

The main risk is recovering a run whose authority or writer state has changed.
The transaction therefore checks the immutable request digest, approval binding,
stale heartbeat, compare-and-swap version, and absence of writer evidence before
any mutation. A mismatch returns without changing the TaskRun. Rollback is the
normal protected revert of this source change; already-cancelled expired
envelopes remain immutable audit history and are not resurrected.

## Backlog coverage

- Decision: atomic
- Parent: BI-F48D7059
- Receipt: blocked - no initiative scope baseline exists for BI-F48D7059, so record_plan_backlog_coverage returns traceability-incomplete and mints no receipt
- Rationale: The nine test-first steps are one chain over a single authority-and-recovery contract, so no phase is independently shippable. Steps 1-3 are failing tests that only pass with the step-4 resolver change; steps 7-9 add the same-TaskRun recovery transaction that no caller can reach without that resolver and the step 5-6 approval/replay path. Shipping any subset lands either failing tests or an unreachable recovery path, and the organization-authority propagation and the expired-envelope supersession must change together or the receipt repository still rejects the writer.
- Dependencies: none

A baseline is written only when the spec-approval gate passes, and that gate
requires a reviewer independent of the artifact's author. This plan's item is
itself the repair for the defect that breaks independent reviewer approval
replay: the approved replay writes `AuthorizationDecisionLog.organizationId =
null`, so the receipt repository rejects the reviewer's write. The baseline for
BI-F48D7059 therefore cannot be recorded until this change is merged and
deployed. Per the coverage tool's own guidance, the coverage table above is
recorded in the plan and names the blocking CONDITION rather than a backlog id
that would go stale.

Once this repair is deployed, acceptance for BI-F48D7059 is one independent
spec-approval review against the canonical design blob
`6b3629f9d31980326d228628e1ffa227ba747e93`, followed by
`record_plan_backlog_coverage` for this plan to replace the blocked receipt above.
