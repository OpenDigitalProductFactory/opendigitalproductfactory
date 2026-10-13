---
status: proposed
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

The 53 existing approval-location/isolation/settlement/recovery tests passed on
f881fcb84de1bb07748f017ce07ecb85042507ac; their target sources match the base
above. Live preflight confirmed served e4edd79cd6cf includes PR #4908. Existing
functional takeover evidence is recorded separately on BI-06AE037F. New pending
discovery requires its own post-deployment check. Independent review execution
recovery and conformance implementation remain in their existing workrooms.
