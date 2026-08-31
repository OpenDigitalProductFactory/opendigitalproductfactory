---
status: active
---

# Governed TaskRun asynchronous push delivery design

**Backlog item:** BI-2014236E  
**Workroom:** WC-48A3D214  
**Branch:** `feat/taskrun-async-delivery`  
**Status:** implementation design

## Problem

External governed coworker work is represented by a durable `TaskRun`, but
`tasks/submit` currently calls the autonomous inference loop before returning.
A correct review can therefore outlive the HTTP request that created it. The
caller sees a timeout even while the server keeps working, then spends cycles
polling, resubmitting, or reconstructing an identity the server already owns.

The defect is observable on the current tree in
`apps/web/lib/mcp-task-submit.ts`: after the `TaskRun` and initial user message
are committed, the ordinary path returns `executeRemoteTaskAttempt(...)`
directly. The existing Task lifecycle projection advertises a polling interval,
and the internal task subscription route already replays persisted task state
and streams later events, but submission does not hand execution to the durable
queue.

## Existing substrate

| Concern | Existing source of truth |
| --- | --- |
| Task identity, owner, status, request metadata, audit | `TaskRun` |
| Original prompt | first persisted `TaskMessage` |
| Idempotent logical request | token-bound request digest and deterministic `taskRunId` |
| Background execution | existing Inngest event/function runtime |
| Agent execution | `executeRemoteTaskAttempt` and the existing governed tool loop |
| Live progress | `agentEventBus` and authenticated task SSE projection |
| Missed-delivery recovery | MCP `tasks/list`, `tasks/get`, and `tasks/result` |
| Long provider-operation resume | `AsyncInferenceOp` work governed by BI-801313EB |
| Cross-page operator notification UX | BI-05D7A0DC |

This repair adds no task ledger, reviewer, receipt, queue, or authorization
model. It projects the existing persisted request into the existing queue and
projects committed TaskRun changes onto existing notification transports.

## Decision

Adopt push-first delivery with reconciliation fallback:

1. `tasks/submit` authenticates and authorizes exactly as it does today.
2. It creates the deterministic `TaskRun` and initial `TaskMessage` before any
   queue event is emitted.
3. It records a server-owned dispatch projection on that same TaskRun and sends
   a deterministic `mcp/task-run.execute` event containing only `taskRunId`.
4. It returns the durable MCP Task handle immediately. It does not wait for
   model routing, inference, tools, approval, or the terminal writer.
5. The Inngest consumer reloads the owner, task, prompt, authority snapshot,
   request digest, and review binding from the database. It atomically claims a
   `submitted` task before calling the unchanged execution function.
6. Every status transition is committed before notification. The existing
   authenticated task subscription replays persisted state first, then streams
   live Task events. A host wakes an agent from the notification, then re-reads
   the TaskRun; the notification itself is never authority.
7. A disconnected, restarted, or notification-incapable host reconciles the
   same task with `tasks/list`/`tasks/get`. Backoff is adaptive and bounded;
   polling is the recovery plane rather than the normal wait loop.
8. If initial queue delivery fails after the TaskRun commits, the row remains
   `submitted` with a dispatch-pending projection. A bounded reconciliation
   scan re-emits the same deterministic event. Duplicate delivery cannot create
   a second TaskRun or execute a second claimed attempt.

## Webhook and MCP notification boundary

For a connected MCP client, the standard task notification/subscription is the
preferred webhook-equivalent: it is immediate, auth-bound, carries complete task
state, and does not require an Internet-reachable callback. DPF supports this
through authenticated Streamable HTTP GET on the canonical `/api/mcp/v1`
endpoint. The stream emits MCP 2025-11-25
`notifications/tasks/status` frames. It replays durable token-owned TaskRuns
before subscribing to live post-commit transitions, closing the
commit-to-subscribe race without making the in-memory notification bus a source
of truth. Multiple streams for one auth context receive one logical live frame,
not a duplicate broadcast.

The first delivery slice has an explicit scale ceiling: live event fan-out is
process-local and therefore assumes one active portal replica for immediate
push. This does not create a correctness dependency on that process. A client
connected to another replica, or reconnecting after a replica replacement,
first receives durable TaskRun snapshots and then recovers with auth-bound
`tasks/get` / `tasks/list`; scheduled reconciliation recovers missed queue
delivery. BI-05D7A0DC owns the registered-host and cross-process notification
transport needed before DPF promises immediate fan-out across multiple portal
replicas. That follow-up must reuse TaskRun as the ledger rather than add a
second task state store.

An outbound webhook is useful only for a separately operated host that cannot
maintain the MCP stream. It must be a registered integration endpoint with an
encrypted signing secret, fixed allowlisted origin, delivery identity, replay
protection, bounded retry, and dead-letter visibility. The submit request must
never accept a callback URL or secret. DPF has inbound callback receipts and
user notification subscriptions, but no canonical registered outbound agent-
host endpoint today. This BI therefore preserves an explicit delivery-adapter
seam and rejects per-request webhook configuration; BI-05D7A0DC owns the
operator-facing registered-host/notification experience. Adding a one-off URL
field here would create an SSRF and authority-confusion surface and is rejected.

The standards boundary is deliberately thin:

- [MCP 2025-11-25 Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
  supplies durable task identity, auth-bound retrieval, optional task status
  notification, and the server-advertised poll interval.
- [MCP Tasks extension draft](https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks)
  adds task subscriptions and complete task notifications. DPF can adopt the
  finalized wire spelling without changing its TaskRun, queue, or authority
  semantics.

## Persisted dispatch contract

The TaskRun `a2aMetadata` already contains the server-owned immutable request
packet: idempotency key, request digest, risk class, API-token/session identity,
token source/capability, requested agent, collaboration kind, and initiative
review binding. The row also owns route, objective, authority scope, user, and
thread. The initial user `TaskMessage` owns the complete prompt.

The new `progressPayload.dispatch` projection is operational state, not a new
authority source:

```text
schemaVersion: 1
kind: external-mcp-task
state: pending | enqueued | claimed | failed
eventId: deterministic from taskRunId and logical attempt
attempt: positive integer
requestedAt / enqueuedAt / claimedAt / failedAt
lastError: bounded diagnostic, when applicable
```

Only the server writes this projection. A worker reconstructs and validates the
packet from the TaskRun and TaskMessage; event data never carries prompt bytes,
credentials, user-supplied callback URLs, or writer arguments.

## Concurrency and failure semantics

- The worker claims with the canonical heartbeat-aware compare-and-set from
  `submitted` plus the row version it reconstructed to `working`. The event
  carries only `taskRunId`; the persisted dispatch event ID remains the audit
  and retry identity. One row-version winner executes and duplicates return
  the current durable state.
- Queue-send failure does not roll back or delete the TaskRun. Reconciliation
  retries the deterministic event and records the failure.
- If stored identity, prompt, request digest, owner, agent, review binding, or
  token authority is missing or contradictory, the worker transitions to a
  typed failed/input-required state without invoking the model.
- Approval and terminal-writer resumes keep their existing same-TaskRun paths.
  This slice changes the initial submission only; it does not auto-resume human
  approval or fabricate a terminal disposition.
- A terminal-writer resume supplies its hydrated immutable artifact evidence as
  the first chat-history system message, before the original user prompt. This
  preserves the provider-neutral system-first conversation contract while the
  separate coworker system prompt remains authoritative. Providers that reject
  misplaced system messages must receive the same canonical ordering.
- If a proposed human-approval envelope expires before the operator acts, an
  exact replay supersedes it on the same TaskRun with the same stored writer
  arguments, approval binding, request digest, and artifact identity. It never
  reruns inference or mints a sibling TaskRun; the replacement still requires
  fresh human approval.
- Cancellation that wins before claim prevents execution. Cancellation after
  claim continues to use the existing cooperative cancellation semantics.
- Quiescence and runtime admission remain enforced by the existing queue and
  agent loop.

## WWMD action authority

An approval wait is not the normal authority model for a bounded platform
action that Mark's standing policy has already delegated. WWMD is the
human-rooted governance process authority: it applies the current promoted
platform-principle version to the exact action and records the result as a
sealed `DecisionInteraction`. The action gate may project that judgment into a
short-lived, single-use authorization only when all of the following are true:

- the result is an explicit `proceed`, has usable evidence, is high confidence,
  is autonomy eligible, and has no commandment conflict;
- the judgment is fresh and binds the exact action, backlog-item subject,
  organization scope, route, immutable input/artifact fingerprint, policy
  version, acting human root, acting agent, and delegation evidence;
- the action is one of the bounded initiative-readiness writers already
  admitted by the canonical lane registry and is no higher than medium risk;
- independent reviewer and author separation required by the lane remains
  satisfied by the tool grant and reviewer identity. WWMD authorizes execution;
  it does not manufacture or predetermine the reviewer's finding.

The authority adapter first looks for a fresh exact judgment. If none exists,
it performs one server-owned WWMD consult with server-derived options and
binding, persists the sealed interaction, and re-evaluates it through the
existing policy-authority projector. Callers cannot supply a DecisionInteraction
id, binding, policy version, scoring vector, or affirmative option. A decline is
an authoritative denial. Uncertain, defer, escalate, tie, stale, missing,
unsealed, mismatched, or dual-control-required results remain input-required or
denied. There is no blanket root instruction, direct DecisionInteraction-as-RBAC
shortcut, reusable bypass, or automatic retry loop.

This reconnects existing substrate rather than adding a parallel authority
system: `DecisionInteraction` remains judgment SSOT;
`AuthorizationDecisionLog` records the projected authorization;
`CoworkerActionEnvelope` supplies exact binding, expiry, and single-use
reservation; `DelegationGrant` proves the agent's human-rooted scope. The
governing architecture decision is `DI-A16B2E483B28`, which selected exact
action-bound WWMD projection with high confidence and
`autonomyEligible=true`.

## Acceptance criteria

| ID | Criterion |
| --- | --- |
| AC-ASYNC-RETURN | A new ordinary submission returns the durable TaskRun handle without awaiting `executeRemoteTaskAttempt`. |
| AC-ONE-EXECUTION | Duplicate submit, duplicate queue event, and reconciliation race execute at most one claimed attempt for one request digest. |
| AC-SERVER-REHYDRATION | The worker reconstructs the exact auth-bound packet from persisted server state; no prompt, credential, callback, or writer argument is trusted from the event. |
| AC-PUSH-FIRST | A committed working/input-required/terminal transition reaches the authenticated MCP Streamable HTTP subscription as `notifications/tasks/status`; consumers re-read before acting. |
| AC-SCALE-CEILING | Single-replica push is immediate; a replica miss or replacement remains lossless through durable replay/list/get, and multi-replica immediate fan-out is explicitly deferred to BI-05D7A0DC. |
| AC-RECONCILE | A missed enqueue or disconnected notification is recovered by deterministic re-enqueue and auth-bound list/get without a sibling TaskRun. |
| AC-FAIL-CLOSED | Missing/mismatched identity, revoked authority, cancellation, approval, and terminal-writer boundaries remain non-executable or input-required. |
| AC-SYNC-REGRESSION | High-risk pre-execution approval and existing idempotent replay/resume behavior remain unchanged. |
| AC-APPROVAL-EXPIRY | An expired proposed writer envelope is replaced on the same TaskRun with identical persisted arguments and binding, without inference rerun or sibling identity. |
| AC-RESUME-MESSAGE-ORDER | A terminal-writer replay places hydrated immutable evidence before the user prompt so every supported provider receives a valid system-first conversation without changing the stored prompt or artifact binding. |
| AC-WWMD-AUTHORITY | A bounded initiative-readiness action with no fresh exact judgment invokes WWMD once and proceeds without a per-action human click only on explicit, autonomy-eligible `proceed`; every no/uncertain/conflict/stale/mismatched result fails closed. |

## Traceability and verification

| Requirement | Contract/flow | Verification |
| --- | --- | --- |
| AC-ASYNC-RETURN | persisted TaskRun -> deterministic enqueue -> immediate task response | submission unit test with an unresolved execution promise |
| AC-ONE-EXECUTION | heartbeat-aware row-version CAS + deterministic Inngest event ID | duplicate-event and replay race tests |
| AC-SERVER-REHYDRATION | TaskRun/TaskMessage/owner resolver | missing and mismatched persisted-field tests |
| AC-PUSH-FIRST | post-commit TaskRun transition -> token-scoped MCP task event projection | GET auth, snapshot replay, live notification, and no-fanout tests |
| AC-SCALE-CEILING | process-local live bus + durable snapshot/list/get recovery | reconnect snapshot test and documented BI-05D7A0DC dependency |
| AC-RECONCILE | submitted dispatch-pending scan -> same event ID | enqueue-failure and scheduled-reconcile tests |
| AC-FAIL-CLOSED | existing approval, terminal writer, token, cancellation checks | existing negative suites plus worker reconstruction matrix |
| AC-SYNC-REGRESSION | unchanged high-risk and same-task replay paths | current `mcp-task-submit` regression suite |
| AC-APPROVAL-EXPIRY | stale proposed envelope -> cancel old -> clone exact proposal -> fresh approval | approval-recovery transaction and replay tests |
| AC-RESUME-MESSAGE-ORDER | hydrated immutable evidence -> system-first chat history -> original user prompt -> writer-only replay | pure ordering regression plus live same-TaskRun DMR replay |
| AC-WWMD-AUTHORITY | server-derived action question -> sealed exact DecisionInteraction -> existing projector -> expiring single-use authorization | producer, ledger-binding, projector, denial, mismatch, duplicate-consult, and gate integration tests |

## Rollout and rollback

Ship enabled by default with the server-owned
`DPF_EXTERNAL_MCP_TASK_ASYNC=off` kill switch. Nonproduction proves immediate
return, single execution, event wake, disconnect/reconcile, approval,
cancellation, and terminal-writer wait. Rollback disables new async enqueue;
already persisted tasks remain retrievable and reconcilable, and no audit rows
are deleted. Disabling push never disables `tasks/get`, `tasks/list`, or durable
TaskRun audit.
