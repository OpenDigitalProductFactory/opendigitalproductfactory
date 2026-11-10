---
status: active
---

# Discover pending external approvals through the existing status reader

Backlog: BI-06AE037F. Workroom: WC-4E4D649E.

## Problem and evidence

PR #4908 supplies owner and approval-location metadata on TaskRun results. The
October 11 takeover request was subsequently visible, authorized, executed and
continued in its original Codex chat. Those facts resolve that reproduction,
but do not satisfy caller-side discovery when an assistant has lost the envelope
ID. On e4edd79cd6cfa83ac00df4dd64494090573b3e23,
`get_my_approval_status` requires an exact ID; the pending-list helper has only
test callers. The existing exact reader isolates by authenticated user and
assistant. Its result intentionally excludes raw task/action arguments.

The platform decision DI-69F9EDA7CDC5 recommends extending the existing reader
over adding a parallel MCP tool. This change adds no authority or storage.

## Scope and ordered repair

1. Add a failing handler test for an explicit `mode: pending` request without an
   envelope ID, plus store tests for user/assistant isolation, expiry, bounded
   results and metadata whitelisting.
2. Extend `get_my_approval_status` with an explicit pending mode. Preserve the
   current exact-ID mode and its response. Reject contradictory mode/ID input.
3. Query at most 21 proposed, unexpired envelopes under the same authenticated
   user and assistant predicates. Return 20, `hasMore`, and an Inbox link for the
   remaining requests. Never report a bounded page as a complete inventory.
4. For pending rows, return the shared outcome projection, delegating user ID,
   assistant ID, expiry, TaskRun ID, and a parsed immutable initiative-review
   binding from TaskRun metadata. Exclude raw metadata, action arguments,
   rationale, secrets, and execution results. The locator describes evidence;
   it grants no access to that evidence and is not a review receipt.
5. Document discovery and the unchanged owner-only approval boundary in the
   existing Inbox guide. Run affected tests, package typecheck and governed
   shared-CI/publication gates. After merge and canonical deployment, exercise
   pending discovery and exact status using the authenticated MCP reader.

This is one atomic read-interface repair; its tests and documentation have no
independent delivery value. It uses the existing schema, store, projection,
review-binding parser and tool grants. No migration is needed. No transfer,
impersonation, approval, retry or historical task mutation is added.

## Acceptance

The owning item's acceptance statements at planning time are quoted here for
medium-shape coverage; BI-06AE037F remains their canonical home:

- Every `requiresApproval` external TaskRun returns an actionable approval location or a governed caller-visible approval operation.
- The authorized delegating principal can list the pending envelope and its immutable review binding.
- A different signed-in user is never allowed to approve merely because they are an administrator; transfer/impersonation, if supported, is explicit and audited.
- The attention surface and external result agree on owner, status, expiry, and next action.
- Tests cover token-owner/browser-user mismatch, correct-owner visibility, unauthorized settlement refusal, and same-TaskRun continuation after approval.

The bounded repair's verification requirements are:

- AC-1: An authenticated assistant can discover its user's pending requests
  without knowing their IDs, with an exact Inbox link for each.
- AC-2: A mismatched user or assistant receives no other identity's requests;
  caller-supplied identities never replace authenticated context.
- AC-3: Pending results name owner, assistant, expiry and TaskRun; valid immutable
  review bindings are projected without raw arguments or metadata.
- AC-4: Exact-ID calls retain their current response; invalid combinations fail
  closed. Pending results exclude expired and settled requests.
- AC-5: A page is bounded and reports additional rows honestly. The existing
  approval controls, authority checks and same-TaskRun continuation remain the
  only settlement path.

## Verification and limits

FLOW-DISCOVERY: authenticated assistant reads its own pending envelopes, follows
the exact Inbox link and continues through the existing owner decision path.
The contract remains `get_my_approval_status`, `readApprovalOutcome` and
`parseInitiativeReviewBinding`. Source-local verification lives in
`apps/web/lib/mcp/packs/coworker-pack.test.ts` and
`apps/web/lib/coworker/approval-outcome-store.test.ts`. LIVE-DISCOVERY denotes
canonical MCP pending-mode verification after deployment.

**Pending discovery scope clarification — BI-83638ACC**

The canonical `ec7d2fe41d9393180f6003b946291b83cd464fa1` install reproduced a
scope error after the operator's October 25 update. The same signed-in Inbox
showed ten routine envelopes, while the COO called pending discovery and
received zero requests for its own user/assistant pair. It then incorrectly
reported that the owner's whole Inbox was empty. The store's isolation worked;
the result contract did not make its inventory limit sufficiently explicit.
This is separate from BI-372D6E2E's displayed overflow count, BI-61DE8177's
orphaned owner warning, and BI-0012E6CA's expiry behavior; all three delivered
items were read before this repair was scoped.

The objective is truthful scope, without an additional reader or broader
authority. Extend the existing pending-mode handler result with a scope naming
the authenticated delegating user and current coworker, an explicit
`coversOwnerInbox: false`, and `ownerInboxTotal: null`. Null means unmeasured,
not zero. The handler derives identity from execution context; supplied identity
fields cannot influence the query or scope. Existing approvals, `hasMore` and
Inbox location retain their meaning. Exact-ID results remain byte-for-byte
unchanged. No other coworker's rows, raw arguments, new grants, approval,
retry, ownership transfer, schema or migration belongs to this repair.

Ordered implementation and verification:

1. `SCOPE-RED`: fail handler regressions for empty, nonempty and bounded pages,
   including caller-supplied identity and unchanged exact mode. Reuse the store's
   existing user/assistant isolation tests; never add an all-owner query.
2. `SCOPE-CONTRACT`: add the scoped metadata at the existing handler boundary.
   Empty-result copy must explicitly say that the owner's Inbox may still have
   requests from other coworkers. Nonempty and bounded results carry the same
   coverage limit, without implying a complete owner inventory.
3. `SCOPE-GREEN`: run graph-related and colocated pack/store tests, both web
   typechecks and applicable guards. Update the existing Inbox guide. Record
   this item's evidence separately from the related human-presentation work
   BI-038AA4BC, even if they publish in the same approval-contract change set.
4. `SCOPE-LIVE`: after ordinary gate, independent review, protected publication
   and canonical deployment, repeat the read-only user request and compare the
   response with the owner's actual Inbox. Tests of transport metadata cannot
   establish that a model obeyed it; retain a failed or unrun live result as such.

Acceptance is explicit scope and unknown owner total on every pending page,
correct empty-page guidance, unchanged authenticated intersection, unchanged
exact results and no new action. There is no data migration or compatibility
removal; existing callers may ignore the additive fields. Broader owner-inbox
reading and deterministic response validation remain outside this bounded fix.

The 53 existing approval-location/isolation/settlement/recovery tests passed on
f881fcb84de1bb07748f017ce07ecb85042507ac; their target sources match the base
above. Live preflight confirmed served e4edd79cd6cf includes PR #4908. Existing
functional takeover evidence is recorded separately on BI-06AE037F. New pending
discovery requires its own post-deployment check. Independent review execution
recovery and conformance implementation remain in their existing workrooms.
