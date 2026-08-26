# External Reviewer Organization Authority

**Backlog item:** BI-F48D7059  
**Epic:** EP-56AE0F69  
**Status:** Approved direction pending governed research evidence

## Problem

An external initiative reviewer can receive an immutable, server-owned
`initiativeReviewBinding` whose model-visible writer schema intentionally omits
`itemId` and `organizationId`. Coworker authority is currently resolved from
those raw writer arguments before the initiative evidence handler restores the
binding from `TaskRun.a2aMetadata`.

For an organization-owned initiative, the initial approval request and its exact
approved replay therefore resolve platform authority. The evidence repository
later loads the canonical initiative organization and correctly rejects the
receipt. The immutable review ran, but the authorization context was lost before
the writer executed.

## Outcome

Both the first governed writer request and the exact approved replay derive the
initiative subject and organization from the same validated, server-owned task
binding. Direct calls remain unable to assert organization authority through
tool arguments, and the receipt repository keeps rejecting mismatches.

## Authority boundary

The resolver may use a TaskRun binding only when all of these conditions hold:

1. The run is an external MCP task with persisted `a2aMetadata`.
2. `initiativeReviewBinding.writerToolName` matches the executing tool exactly.
3. `TaskRun.authorityScope` contains the exact writer tool and the exact bound
   backlog item.
4. The bound backlog item exists, and its organization is loaded from the
   canonical database record.
5. An authenticated organization, when present, matches the canonical
   organization.

If any condition fails, the resolver must fail closed or use the existing direct
call path; it must never accept model-supplied organization text as authority.

## Design

Extend the existing TaskRun lookup in
`resolve-coworker-tool-authority.ts` to select `a2aMetadata` and
`authorityScope`. Parse the immutable initiative binding with the same contract
used by external task submission, validate it against the executing tool and
persisted scope, then pass its canonical backlog item into the existing
initiative authority resolver before the approval decision is built.

The first call and replay already share the TaskRun identity and request digest.
No replay-only branch is needed: resolving the bound initiative at the common
authority boundary makes both decisions identical.

To avoid coupling the authority resolver to task-submission orchestration, move
the binding parser and exact-scope validation into a small server-neutral module
if the current dependency direction would otherwise create a cycle. This is a
refactor of an existing contract, not a second binding representation.

## Invariants

- The model-visible writer remains narrowed to its decision payload.
- The TaskRun is the only new input to authority derivation.
- Writer-tool and backlog-item scope must match exactly.
- Organization-owned initiatives cannot execute under platform authority.
- Organization-neutral initiatives continue to map to the platform subject.
- Initial approval and replay produce the same subject and organization.
- Approval requirements and request-digest replay protection are unchanged.
- No schema, migration, new receipt type, or new reviewer role is introduced.

## Verification

Tests must prove:

- a valid external TaskRun binding resolves the canonical organization;
- the initial approval-required decision and approved replay share that
  organization and execute the writer once;
- writer mismatch, missing exact tool scope, missing exact backlog scope, and
  authenticated-organization mismatch fail closed;
- caller/model organization fields cannot widen authority; and
- a platform-neutral initiative retains platform authority.

The implementation plan is
`docs/superpowers/plans/2026-08-26-external-reviewer-organization-authority.md`.
