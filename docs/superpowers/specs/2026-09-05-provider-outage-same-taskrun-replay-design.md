---
status: draft
---

# Provider-outage same-TaskRun replay

**Backlog item:** `BI-A50F6B7B`  
**Tracking parent:** `BI-F6AD1E18`  
**Design Workroom:** `WC-08FF9F3D`

This is the first independently shippable child of the xlarge temporal-failover
parent. It uses the durable TaskRun wait and background reconciliation already
in the platform. It does not add another queue, operation identity, retry
ledger, or provider transport.

## Objectives

**OBJ-OUTAGE-REPLAY-1:** A proven transient provider outage before any tool has
run becomes a durable, observable wait on the original governed TaskRun rather
than a terminal writer failure or a discarded request.

**OBJ-OUTAGE-REPLAY-2:** Recovery redispatches the server-owned immutable
request and authorization on the same TaskRun without client polling, request
reconstruction, or identity churn.

**OBJ-OUTAGE-REPLAY-3:** Structural, authorization, policy, context, unknown,
and post-tool failures remain fail closed and cannot enter temporal replay.

## Acceptance manifest

| Acceptance | Objectives | Required outcome |
| --- | --- | --- |
| AC-OUTAGE-REPLAY-1 | OBJ-OUTAGE-REPLAY-1 | `All endpoints failed` with network/fetch/connect evidence and zero executed tools is classified as the existing transient `busy` outcome. |
| AC-OUTAGE-REPLAY-2 | OBJ-OUTAGE-REPLAY-1 | The TaskRun is persisted as `submitted` with a valid versioned `resourceWait`, `completedAt = null`, and `resumeMode = same-taskrun`. |
| AC-OUTAGE-REPLAY-3 | OBJ-OUTAGE-REPLAY-2 | Scheduled reconciliation selects a stale valid resource wait even when ordinary asynchronous submission is disabled and emits a deterministic event for the same TaskRun. |
| AC-OUTAGE-REPLAY-4 | OBJ-OUTAGE-REPLAY-2 | The worker validates and reconstructs the original server-owned digest, packet, token authority, route, binding, and agent before execution; no sibling TaskRun is created. |
| AC-OUTAGE-REPLAY-5 | OBJ-OUTAGE-REPLAY-3 | Model inventory, credential/auth, policy/capability, sensitivity, context-size, malformed/mismatched packet, unknown, and post-tool failures do not become outage waits. |
| AC-OUTAGE-REPLAY-6 | OBJ-OUTAGE-REPLAY-1, OBJ-OUTAGE-REPLAY-2 | The wait survives process restart because TaskRun state is canonical and the scheduled reconciler, not an in-memory retry, owns redispatch. |

## Current evidence

At protected main `4e48b40a727b9a1bf02b355c69a2c661ab4af275`:

1. `describeToolRouteFailureMessage` maps `All endpoints failed` to the provider
   busy handoff, but `describeToolRouteFailureOutcome` only returns `busy` for
   explicit rate-limit, overload, busy, 429, or 529 text. A route error whose
   endpoint attempts say `Network error ... fetch failed` therefore becomes
   `unknown`.
2. `agentic-loop.ts` preserves only typed pre-inference `capacity` or `busy`
   outcomes for a governed terminal-writer route. The `unknown` result becomes
   `terminal-writer-missing`.
3. `mcp-task-execution.ts` already projects a typed zero-tool `capacity` or
   `busy` result to a durable `submitted` TaskRun with a versioned
   `resourceWait` and no completion timestamp.
4. `mcp-task-background-dispatch.ts` reconciles ordinary submitted external-MCP
   tasks only when `DPF_EXTERNAL_MCP_TASK_ASYNC` is enabled. A valid resource
   wait created while that rollback flag is off has a trusted manual resume
   seam but no production recovery caller.
5. `mcp-task-background-worker.ts` already reconstructs the server-owned packet,
   verifies its digest and live token authority, and reserves the same TaskRun
   by CAS. The wait update discards the prior dispatch projection, so each
   recovery cycle starts a new bounded dispatch delivery attempt rather than
   consuming a provider-attempt counter.

## Policy decisions

The platform kernel recorded two high-confidence decisions for this design.

- `background-only`: v1 applies only to background/autonomous governed TaskRuns.
  Interactive chat retains immediate, truthful retry guidance.
- `clearable-only`: only a proven, pre-inference transient outage or capacity
  condition with zero executed tools is durable. Credentials, configuration,
  policy/capability, context overflow, unknown errors, and any post-tool failure
  stay fail closed.

The first unfeatured consultation was explicitly inconclusive and is retained
as audit evidence, not a decision. The corrected feature-bearing consultations
produced the high-confidence outcomes above.

## Research and standards

| Reference | Adopt | Reject for this slice |
| --- | --- | --- |
| [Temporal durable execution](https://docs.temporal.io/) and [retry policies](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/retry-policies.mdx) | Persist workflow identity and retry transient work after process/network failure; explicitly mark non-retryable classes. | Adding Temporal or replaying nondeterministic model/tool output. DPF already has durable TaskRun state and Inngest reconciliation. |
| [AWS Step Functions error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html) | Match retriers to named transient errors; do not retry every failure. | A fixed retry count that terminally discards an outage wait before service recovers. |
| [Kubernetes Pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) | Keep accepted but unschedulable work pending instead of declaring it failed. | Treating pending as success, or erasing the reason and immutable work identity. |
| Existing DPF `resourceWait` and background outbox | Reuse the versioned wait, scheduled reconciliation, deterministic event ID, server-owned packet, token revalidation, and TaskRun CAS. | New schema, sibling TaskRun, client-supplied replay packet, or ephemeral in-memory recovery. |

## Design

### 1. Narrow outage classification

Extend `describeToolRouteFailureOutcome` after all existing structural branches.
An `All endpoints failed` aggregate is `busy` only when its attempt evidence
contains a network/connectivity failure such as `fetch failed`, timeout,
connection reset/refused, DNS failure, or network error. Existing model-missing,
credential/auth, sensitivity, policy/capability, and context branches run first.
An aggregate without recognizable transient evidence remains `unknown`.

This is deliberately not an inference retry policy. It is a stop-reason
classification consumed by the existing TaskRun resource-wait contract.

### 2. Resource-wait reconciliation

Add a distinct scheduled reconciliation candidate: `status = submitted`,
external-MCP trigger, and a structurally valid `progressPayload.resourceWait`.
It is selected regardless of the ordinary asynchronous-submission feature flag.
After the database scan, parse the wait again before reserving dispatch. A
coarse or raced row with invalid wait evidence is ignored.

The existing deterministic dispatch event and TaskRun CAS remain unchanged.
The worker continues to reconstruct the original stored request and authority.
The caller cannot supply a new packet, token, binding, agent, or TaskRun id.

### 3. Dependency and integration boundary

`BI-41EB722B` owns provider HTTP transport and may change how raw fetch failures
are produced. This child must merge after that repair for integration evidence,
but must not edit its inference/routing transport paths. Its contract begins at
the typed aggregate route failure and ends at the existing TaskRun worker wake.

Waiting-queue metrics and recovery-signal/provider-status drain are separate
children of `BI-F6AD1E18`. This child supplies a restart-safe periodic fallback;
it does not claim the parent's full queue-observability acceptance.

## Security and compatibility

- No migration or new durable record.
- No authorization broadening: token status and capability are re-read before
  execution, and immutable request digest mismatch still settles fail closed.
- No writer bypass: a resumed turn must still call its required writer and pass
  existing approval/idempotency checks.
- No interactive behavior change.
- The async rollback flag continues to disable first-submit background delivery;
  it no longer disables recovery of a TaskRun that is already durably waiting.

## Verification

TDD must prove the exact network aggregate red case, every fail-closed class,
resource-wait selection with `includeOrdinary: false`, invalid/raced wait
rejection, deterministic same-TaskRun event identity, and request/auth digest
reconstruction. Then run the linked agentic-loop, TaskRun execution, capacity
resume, background dispatch/worker, and queue-function suites plus web typecheck.
Protected PR and merge-group checks remain mandatory. Local immutable gates may
be recorded as inconclusive only when capacity is unavailable.

## Rollback

Revert the classifier and reconciliation-candidate changes together. Existing
TaskRun rows remain valid: they use the prior version-1 `resourceWait` contract
and require no data rollback.
