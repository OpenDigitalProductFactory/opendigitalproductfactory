# External Reviewer Organization Authority Repair

**Backlog item:** BI-F48D7059  
**Epic:** EP-56AE0F69  
**Branch:** `fix/reviewer-org-authority-replay`

## Outcome

An external reviewer bound to an organization-owned initiative must carry that initiative's canonical organization through both the first governed writer request and the exact approved replay. The authority decision must be derived from server-owned task binding, not model-supplied arguments or caller-supplied organization text.

This repairs the readiness path blocking BI-MCP-EFF-0285909C without weakening the receipt repository's organization-mismatch rejection.

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

## Test-first implementation

1. Add failing authority-resolver tests proving that a validated external task binding resolves an organization-owned initiative before handler execution.
2. Add negative tests for writer-tool mismatch, missing exact authority scope, and authenticated-organization mismatch.
3. Add platform-neutral coverage to prove null organization continues to map to platform authority.
4. Implement the smallest resolver change that makes those tests pass.
5. Exercise the approval/replay integration path and assert the initial `require_approval` and resumed `allow` decisions use the same organization and execute the writer once.
6. Run focused tests, typecheck, policy guards, blast-radius verification, independent semantic review, and the exact-tree local merge gate before publication.

## Expected code surface

- `apps/web/lib/govern/authority/resolve-coworker-tool-authority.ts`
- `apps/web/lib/govern/authority/resolve-coworker-tool-authority.test.ts`
- Approval/replay integration tests only if the resolver fixture does not already cover the full execution boundary

No schema, migration, public route, or customer-facing documentation change is expected. The operational documentation impact is this plan plus the existing resilient gate-flow documentation that this repair unblocks.
