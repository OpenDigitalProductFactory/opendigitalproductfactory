---
status: draft
---

# External contributor readiness bootstrap implementation plan

**Backlog item:** BI-F0715C9C  
**Design:** `docs/superpowers/specs/2026-08-23-external-coworker-context-bootstrap-design.md`  
**Shape:** one atomic corrective deliverable; partial transport or claim behavior is not independently useful

## Traceability contract

The one atomic deliverable covers design requirements `OBJ-CLAIM-SNAPSHOT`, `OBJ-SESSION-BOUNDARY`, `OBJ-REVIEW-BOOTSTRAP`, and `OBJ-FAIL-CLOSED-COMPAT` through canonical contracts `CONTRACT-WORKROOM-CLAIM-SNAPSHOT` and `CONTRACT-MCP-TRANSPORT-SESSION`. Its end-to-end flows are `FLOW-CLAIM-AND-PIN-ARTIFACT` and `FLOW-EXTERNAL-REVIEW-BOOTSTRAP`. Verification covers `AC-CLAIM-ATOMIC`, `AC-CLAIM-READOPT`, `AC-PAT-SESSION`, `AC-COWORKER-CONTEXT`, `AC-SESSION-ISOLATION`, `AC-MULTI-SESSION`, `AC-INTERNAL-COMPAT`, and `AC-REVIEW-BOOTSTRAP`.

## Existing substrate to preserve

- `apps/web/app/api/mcp/v1/route.ts` is the external JSON-RPC transport and sole builder of external `ToolExecutionContext`.
- `apps/web/lib/mcp/session-token.ts` owns internal short-lived authorization JWTs. Transport-session tokens must use a distinct issuer/audience and validator.
- `AgentThread` is unique on `(userId, contextKey)` and `spawnWorkThread` verifies parent ownership, depth, fan-out, cancellation, and quiescence.
- `claimBacklogItemWorkspace` delegates branch identity to `adoptWorktreeCapsule`, which already implements late binding and SHA refresh.
- Repository-artifact resolution already enforces a single live subject Workroom, exact head SHA, provider blob identity, Workroom principal, and one DCO identity.

## Task 1 — Red: atomic SHA claim contract

Modify tests before production code:

- `apps/web/lib/work-capsules/claim-backlog-item-handler.test.ts`: prove `baseSha` and `headSha` from tool params reach the governed claim input; reject no existing valid inputs.
- `apps/web/lib/work-capsules/work-capsule-store.test.ts` (or the existing focused claim-store test): reproduce a new subject-bound claim and assert the created Workroom contains both SHAs; reproduce reuse and assert changed SHAs are returned.
- `apps/web/lib/mcp/packs/work-capsules-pack.test.ts`: assert both optional fields are in the public tool schema.

Run the focused tests and capture the expected failures.

## Task 2 — Green: pass SHAs through the canonical claim path

- Add `baseSha` and `headSha` to the `claim_backlog_item_for_work` schema.
- Parse them once in `claimBacklogItemForWork`.
- Extend `claimBacklogItemWorkspace`'s input and pass both values to `adoptWorktreeCapsule`.
- Keep creation/reuse/sync in the existing transaction and return the exact Workroom readback already used by the governed wrapper.

Run the Task 1 tests. Do not add a parallel Workroom writer.

## Task 3 — Red: external MCP transport-session isolation

Add tests before route implementation:

- New `apps/web/lib/mcp/transport-session.test.ts` for round-trip verification, expiry, malformed input, distinct issuer/audience from internal `X-MCP-Session`, wrong token, and wrong user.
- `apps/web/app/api/mcp/v1/route.test.ts` for:
  - PAT initialize creates a user-owned root thread and returns `Mcp-Session-Id`;
  - subsequent PAT tool call echoes the session and dispatches with its `threadId` and `agentId=undefined`;
  - two initializes under one PAT create distinct sessions/threads;
  - missing session preserves non-thread tool behavior;
  - invalid/mismatched session fails before governed tool dispatch;
  - internal `X-MCP-Session` behavior and initialization remain unchanged.
- `apps/web/lib/mcp/packs/coworker-pack.test.ts`: retain the direct `missing_threadId` unit contract and add/retain proof that a human caller (`agentId` absent) passes only the target agent to the child task.

Run focused tests and retain the failing assertions as the Red evidence.

## Task 4 — Green: server-issued transport session

- Add `apps/web/lib/mcp/transport-session.ts` with narrow create/verify functions and a transport-specific payload type.
- At PAT `initialize`, create a root `AgentThread` with a non-sensitive unique context key and return the signed opaque session id in `Mcp-Session-Id`.
- On later PAT requests, verify the optional `Mcp-Session-Id` against the resolved `tokenId` and `userId`; set `ResolvedAuth.threadId` only after verification.
- Return the protocol session failure without calling `governedExecuteTool` when validation fails.
- Keep bearer validation on every request and do not add `agentId` to operator PATs.
- Do not issue or consume transport sessions for internal `X-MCP-Session` JWT calls.

Run the Task 3 tests.

## Task 5 — Refactor and blast-radius verification

Use the implementation refactor pass only to remove duplication introduced by Tasks 2–4:

- centralize response-header attachment so initialize remains the only session-issuing branch;
- centralize transport-session payload validation rather than open-coding claim checks in the route;
- keep internal authorization JWT and transport-session token semantics visibly separate even if they share a small private signing-secret helper.

Then run:

1. focused Workroom claim/store/pack tests;
2. transport-session and MCP route tests;
3. coworker-pack and work-thread-pack tests;
4. typecheck;
5. `pnpm run pregate:preflight`;
6. repository blast-radius checks and required guards returned by the Workroom change-impact contract;
7. exact-tree `pnpm run pregate` before publication.

The parent initiative's refactoring ledger remains exactly 20%; this corrective BI does not alter its allocation.

## Task 6 — Governed end-to-end acceptance

Against the verified candidate tree:

1. Initialize an external PAT MCP connection and capture the returned session id without exposing it in evidence.
2. Claim a test BacklogItem with design intent and both current SHAs; confirm one subject-bound Workroom readback contains the complete snapshot.
3. Request one designated reviewer; confirm the parent is the server-created root, the caller agent is null, the child TaskRun is target-agent attributed, and existing clearance/grant checks apply.
4. Record immutable design/spec and plan review receipts through the designated lanes.
5. Record plan coverage and confirm validation reaches the mapping logic rather than artifact ownership or missing-thread refusal.
6. Re-adopt a rewritten head and confirm the old SHA no longer resolves while the new one does.

No credential, session token, private thread content, or raw database row is committed as evidence.

## Publication

- Commit with one DCO trailer.
- Refresh the Workroom head SHA after the commit.
- Obtain independent semantic review of the stable commit.
- Run exact-tree local CI, push the green SHA, open a regular ready PR, read review-bot findings, and use the protected merge queue.
- After merge, mark BI-F0715C9C done only when the live MCP route reproduces Task 6. Then return to BI-441BECAC (TASK) and BI-812AC0D8 (UX); neither may be declared complete on this prerequisite alone.
