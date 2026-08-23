---
status: draft
---

# External contributor readiness bootstrap

**Backlog item:** BI-F0715C9C  
**Profile:** cross-domain  
**Status:** proposed design  
**Source baseline:** `origin/main` at `a2a1630dff160d4696875097f863ae11647965ad`

## Problem

An authenticated Codex, Claude, or Grok task can claim a DPF Workroom and produce an immutable DCO-signed artifact, but two gaps still prevent the complete governed workflow from being attainable in one external session:

1. `claim_backlog_item_for_work` binds the BacklogItem, repository, branch, Workroom, principal, and worktree, but its public contract does not accept the current base/head SHAs. The caller must make a second `adopt_worktree` call before repository-artifact resolution can succeed.
2. The external MCP PAT authenticates a human principal but supplies neither `threadId` nor `agentId`. `request_coworker`, `summon_coworker`, and the work-thread tools correctly refuse without a server-owned parent `AgentThread`, so an external task cannot obtain independent initiative-review receipts.

The second refusal is a safety property, not a defect in coworker routing. Accepting an arbitrary `threadId` from tool arguments would allow a caller to name a thread it does not own. Fabricating an `agentId` would also misstate authority and could accidentally apply an agent's delegation grants.

## Verified current substrate

The original report covered several failures. Current main has already repaired most of them:

| Acceptance concern | Current result | Evidence |
|---|---|---|
| Re-adopt advances `headSha` after commit/amend/rebase | satisfied | `adoptWorktreeCapsule` syncs `headSha`, `baseSha`, and `lastSyncedAt`; live WC-2ABA65F7 accepted `a2a1630d…` |
| A human-principal external artifact needs no fabricated agent | satisfied | `resolveRepositoryArtifact` treats the Workroom owner + one DCO identity as authority; `authorAgentId` is optional |
| Spec approval creates the objective baseline | satisfied | `record_initiative_design_review` routes passing `spec-approval` to `recordInitiativeSpecApproval`, which records the canonical baseline |
| Coverage can precede implementation claim | satisfied | `workIntent:"design"` creates a subject-bound Workroom before implementation readiness; adoption can then stamp its SHA |
| Claim includes current SHA in the same operation | missing | claim schema and `claimBacklogItemWorkspace` input omit `baseSha`/`headSha` |
| External task receives a safe parent thread | missing | PAT resolution has no transport session; route context forwards `token.threadId`, which exists only on internal session JWTs |

This design changes only the two missing rows. It does not duplicate the already-landed Workroom, artifact-author, baseline, or intent machinery.

## Decision

### 1. Make claim-at-start a complete repository snapshot

Add optional `baseSha` and `headSha` fields to `claim_backlog_item_for_work`. Thread both values through `claimBacklogItemForWork` → `claimGovernedBacklogWorkspace` → `claimBacklogItemWorkspace` → `adoptWorktreeCapsule`.

The existing Workroom transaction remains authoritative. On create it writes both SHAs with the subject/location/principal binding. On reuse it applies the existing head/base sync rules and returns the exact readback. Invalid or foreign branch identity continues to fail with `branch_occupied`; multiple live subject Workrooms and DCO mismatch remain fail-closed in repository-artifact resolution.

Both fields stay optional for hosts that cannot discover git state. Immutable artifact workflows must supply `headSha`; the error from `resolveRepositoryArtifact` continues to identify the missing/stale head and the re-adopt remedy.

### 2. Use the MCP transport session as the external task boundary

Implement Streamable HTTP session management for PAT-authenticated clients:

1. On `initialize`, create a root `AgentThread` owned by the authenticated `userId`. Its `contextKey` is unique to the new transport session, not merely to the reusable PAT.
2. Return a server-generated, opaque `Mcp-Session-Id` response header. The value is integrity-protected and binds a random session identifier, PAT `tokenId`, `userId`, and the root `threadId`.
3. On later PAT requests, require any presented `Mcp-Session-Id` to verify and to match the current token and user. A valid session supplies `threadId` to `ToolExecutionContext`; an invalid, mismatched, or expired session receives the transport-level session error and never reaches a tool.
4. Continue requiring the bearer PAT on every request. `Mcp-Session-Id` is correlation and server-owned context, not authentication or additional authority.
5. Keep `agentId=null` for an operator PAT. A human-principal external task may convene a designated reviewer under the existing human clearance and tool-grant checks, but it never inherits the reviewer's grants. The spawned child `TaskRun` is attributed to the target reviewer; the parent remains human/session attributed.
6. Internal `X-MCP-Session` JWT calls retain their current explicit `threadId` and do not receive a second transport session.

The root thread is reused only within that initialized MCP transport session. Different Codex tasks using the same PAT get different roots, avoiding shared child limits, mixed timelines, and cross-task cancellation.

### Session token shape

The transport session identifier is a separate type from the existing five-minute internal MCP authorization JWT. It uses the same configured signing secret but a distinct issuer/audience and payload validator so neither token can be replayed in the other's header.

Required claims:

- random `jti` for global session uniqueness;
- `sub=userId`;
- `tokenId` for PAT binding;
- `threadId` for server-derived tool context;
- issued-at and bounded expiry.

The raw PAT, email, task prompt, Workroom objective, and other sensitive data never enter the session identifier or `AgentThread.contextKey`.

## Standards and benchmarking

- MCP Streamable HTTP permits a server to assign `Mcp-Session-Id` during initialization and requires clients to return it on subsequent requests. This is the protocol-native place for external task continuity, rather than repeating a DPF-specific argument on every tool: [MCP 2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
- MCP authorization remains request-scoped even inside a logical session. The bearer PAT is therefore still validated on every request; the session id cannot replace it: [MCP 2025-11-25 authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
- MCP task security requires durable work to be bound to the requester's authorization context. Binding the transport session to both `tokenId` and `userId`, then creating a user-owned `AgentThread`, follows the same isolation rule: [MCP 2025-11-25 tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks).
- W3C Trace Context treats propagated identifiers as correlation data across boundaries and calls for validation/restart at trust boundaries. DPF similarly accepts a server-issued opaque context but derives authority independently from the PAT: [W3C Trace Context](https://www.w3.org/TR/trace-context/).
- RFC 6750 recommends audience restriction and scoped bearer tokens. DPF's session binding narrows continuity to the already-resolved PAT/user rather than widening its grants: [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html).

### Kernel comparison

`principle_decide` compared three options: a protocol transport session, per-tool Workroom arguments, and one deterministic thread per PAT. With explicit feature vectors across maintainability, blast radius, reuse, evidence, cognitive load, governance, speed, schema grounding, operator effort, consequence legibility, privacy, and reversibility, it recommended **transport-session** with high confidence (composite 11.881, margin 3.467), no commandment conflict, and stable sensitivity. Ledger: `DI-238A8A83FCBD`.

The per-tool option duplicates identity validation across packs and makes callers repeatedly present coordination context. The per-PAT option conflates concurrent host tasks and turns a long-lived credential into a long-lived conversation boundary.

## Trust boundaries and failure behavior

| Boundary | Rule |
|---|---|
| Client → MCP route | Validate PAT on every request; validate Origin/TLS as today |
| Client session id → route context | Verify signature, issuer/audience, expiry, `tokenId`, and `userId`; never trust a client-supplied thread id |
| Route context → coworker pack | Pass only the verified server-owned `threadId`; leave `agentId` null for an operator PAT |
| Parent → child coworker | Existing user ownership, lifecycle, clearance, fan-out, delegation, and TaskRun creation stay authoritative |
| Worktree → repository artifact | Workroom subject/repository/head/principal plus provider blob and DCO remain authoritative |

Expected failure states:

- PAT request without a transport session may use tools that do not require a thread. Coordination tools keep returning `missing_threadId` until initialization completes.
- Unknown, malformed, expired, wrong-token, or wrong-user `Mcp-Session-Id` fails before tool dispatch and does not disclose whether the embedded thread exists.
- A deleted parent thread causes the existing fail-closed spawn behavior. A new initialize obtains a new root.
- Hosts that do not implement MCP session echo remain usable for non-thread tools; their coordination limitation is explicit rather than silently falling back to a shared PAT thread.

## UX fit

There is no new portal screen. The user-visible behavior is the existing collaboration card and child task, now reachable from external hosts. Error copy must distinguish:

- “initialize or reconnect this MCP session” for missing context;
- “session is invalid or expired; reconnect” for transport validation;
- existing clearance, lifecycle, child-limit, and dispatch failures after a valid session.

No raw JWT, internal thread id, PAT id, or signing detail is shown to the user.

## Acceptance criteria

1. A single `claim_backlog_item_for_work` call can create or reuse a subject-bound Workroom and return the submitted base/head SHAs with repository, branch, principal, session, and worktree identity.
2. Re-adoption still advances SHAs, and ambiguity, foreign branch identity, and DCO mismatch remain fail-closed.
3. PAT `initialize` returns a unique `Mcp-Session-Id` and creates one user-owned root `AgentThread`.
4. A later call with the same PAT + session id reaches `request_coworker` with that root thread and `agentId=null`.
5. A session id cannot be replayed with a different PAT/user, cannot be supplied as `X-MCP-Session`, and cannot grant reviewer authority.
6. Two initialized sessions sharing one PAT receive distinct root threads.
7. Internal session-JWT behavior remains unchanged.
8. A regression flow covers external design/spec/specialist/plan review routing and reaches coverage validation rather than `plan-artifact-invalid` or `missing_threadId`.

## Non-goals

- Replacing PAT authentication with OAuth in this BI.
- Allowing arbitrary tool parameters to select an `AgentThread`.
- Binding operator PATs to fabricated coworkers.
- Changing reviewer grants, clearance, separation of duties, or the initiative readiness policy.
- Adding a new session or thread database model; `AgentThread` is the canonical conversation substrate.
- Altering the parent initiative's exact 20% refactoring allocation. This prerequisite repairs the governed delivery path; it does not consume or reassign the parent feature slices.
