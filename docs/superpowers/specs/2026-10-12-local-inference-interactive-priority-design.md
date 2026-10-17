---
status: active
backlog_item: BI-285EF102
workroom: WC-1EBA9720
decision: DI-3329D0A9F402
---

# Local inference interactive priority

## 1. Objective

Make the supported single-portal install keep its local Docker Model Runner useful
for a person while autonomous Build Studio work is already using the same GPU.
The platform must keep one request on the GPU at a time, serve an admitted
interactive waiter before later autonomous work, let old autonomous work
eventually progress, and report genuinely external GPU occupancy honestly.

This is the distributed-lane follow-up already declared by `BI-285EF102`. It
ratifies only this narrow admission repair. The broader
`2026-10-11-task-aware-inference-routing-design.md` remains a draft.

### Objectives

- **OBJ-LIP-1 — One local admission home.** Portal HTTP inference and the local
  sandbox build engine use `compute:local-inference`; no second local semaphore
  may hold a slot while waiting on that lane.
- **OBJ-LIP-2 — Interactive priority with fairness.** A queued interactive turn
  starts before newer autonomous work, while aging prevents an autonomous waiter
  from being postponed indefinitely.
- **OBJ-LIP-3 — Probe after admission.** Docker Model Runner and host-GPU probes
  run only after the caller owns the local lane. Internal use therefore queues;
  an external owner still produces the typed honest-busy result.
- **OBJ-LIP-4 — Observable and verifiable.** Tests reproduce the old immediate
  `local-runner-busy` outcome, prove the corrected ordering and fairness, and the
  live portal executes an attached governed DPF tool while autonomous local work
  is active or queued.

## 2. Current evidence

Live evidence on `f881fcb84de1bb07748f017ce07ecb85042507ac` showed:

1. Docker Model Runner is healthy and the installed Qwen 3.8 27B model emits
   native tool calls. A governed certification turn selected `describe_model`
   and `wiki_query`; both crossed authorization and executed, with the first
   returning the honest `No active build` result and the second returning live
   knowledge hits.
2. A browser coworker request made while an autonomous sandbox CLI request was
   running returned `local-runner-busy` in about 62 ms and executed zero tools.
3. The live portal has one `next-server` process. That process spawned and waited
   on the sandbox `docker exec`; this is internal same-process contention, not a
   multi-replica portal.
4. `callProvider` probes the host before `acquireInferenceSlot`, and
   `withLocalInferenceLock` probes before `ResourceLane.run`. A running internal
   request is therefore rejected as if it were an external GPU owner before the
   queue can arbitrate it.
5. Local HTTP calls pass through both `inference-admission.ts` and
   `resource-lane.ts`, while the sandbox CLI uses only the latter. The two queues
   cannot provide one ordering contract.

The existing unit suite proves FIFO serialization and the separate inference
semaphore's priority behavior. It does not cover their composition or the
probe-before-queue failure.

## 3. Research and precedent

The fresh routing research in
`2026-10-11-task-aware-inference-routing-design.md` compared LiteLLM, Portkey,
Envoy AI Gateway, Cloudflare AI Gateway and OpenRouter from their primary
configuration and routing contracts. This slice adopts three common properties:
one executable deployment reservation, bounded attempts, and capacity state
separate from eligibility. It rejects a new gateway, Redis dependency or a
second authored routing graph.

DPF already owns the required primitive:

- `ResourceLane` is the canonical single-slot local compute gate and is shared by
  chat and the sandbox build engine.
- `InferenceOrigin` already distinguishes `interactive` and `autonomous`.
- `host-gpu-admission.ts` already distinguishes internal runner occupancy from
  external host pressure, but its decision currently happens too early.

No schema or new service is needed for the supported single-portal topology.
Postgres-backed distributed reservation remains appropriate only when the
platform supports more than one portal replica; claiming aggregate guarantees
before that topology exists would add lifecycle and failure modes without fixing
today's queue composition defect.

## 4. Decision

WWMD decision `DI-3329D0A9F402` recommends **consolidate-existing-local-lane**
(composite 10.623, high confidence, proceed). The alternatives were:

| Option | Disposition | Reason |
| --- | --- | --- |
| Consolidate the existing local lane | Chosen | One source of truth, no schema, directly covers the measured topology and failure. |
| Add a PostgreSQL distributed queue | Deferred | Correct only for a future multi-replica guarantee; disproportionate lifecycle and blast radius now. |
| Retry `local-runner-busy` | Rejected | Preserves competing queues, hides ownership and creates timing-dependent recovery. |

## 5. Contract

### 5.1 ResourceLane priority

`ResourceLane.run` accepts an explicit priority class and enqueue time. The local
lane maintains separate interactive and autonomous queues. It normally serves
interactive first. When the oldest autonomous waiter reaches a bounded age, that
waiter is promoted for the next free slot; running work is never preempted.

Priority is explicit at the producer:

- local provider dispatch uses `currentInferenceOrigin()`;
- the sandbox Build Studio CLI passes `autonomous`;
- an unlabelled producer keeps the existing interactive default, but tests and
  review must reject any known background producer left unlabelled.

The bounded queue-depth setting remains aggregate across both queues. Cancellation
or failure removes exactly one waiter; release remains idempotent.

Caller cancellation stays separate from governed parent authority. The provider
composes both signals for local admission, and post-admission authority checks
stop waiting when the caller expires. Cancelling a queued caller removes its
entry without dispatching HTTP or revoking its parent. Active provider execution
retains the lane until its transport settles.

Each queued callback captures its submitting async context. Dispatch restores
that context so the preceding holder cannot supply another caller's authority,
deadline, transport or origin. Regression coverage includes an unscoped waiter
and two distinct governed parent scopes.

### 5.2 One local execution boundary

`callProvider` uses the local ResourceLane around `adapter.execute` for local
providers. Remote providers continue to use `inference-admission.ts`. The local
chat adapter no longer takes a nested local lock. This preserves the timeout
contract because the adapter creates the HTTP timeout only after admission.

The sandbox CLI retains the same ResourceLane around its awaited execution. It
does not use the remote/provider semaphore.

### 5.3 Host capacity

The lane owner runs `assertLocalGpuFree` immediately before local execution.
When another DPF request owns the lane, a new request waits without probing.
When the lane is free but Docker Model Runner is still in use, or host telemetry
shows an external GPU owner, the existing typed deferral remains authoritative.

The repair never permits concurrent local completions and never unloads a serving
runner.

### 5.4 Observability

Existing queue transition telemetry records origin, wait duration and queue
depth for the local lane when enabled. The typed result distinguishes:

- queued internal contention;
- external host busy;
- runner unexpectedly busy after admission;
- queue timeout.

No raw prompt, tool arguments or credentials enter these records.

## 6. Ordered delivery

1. Add a failing composition test that reproduces an interactive call being
   rejected before it can queue behind an autonomous local lane holder.
2. Extend `ResourceLane` with explicit priority and bounded autonomous aging;
   preserve FIFO order within each class and aggregate queue limits.
3. Make `callProvider` the local HTTP admission boundary, pass the current origin,
   and remove the nested chat-adapter acquisition.
4. Move the host probe inside the admitted local critical section and mark the
   sandbox CLI call autonomous.
5. Run affected unit/type checks, exact-tree pregate, independent semantic
   review, protected PR/merge queue, self-upgrade and live browser verification.

## 7. Acceptance and stop conditions

Acceptance requires all four objectives and these concrete proofs:

- one autonomous holder, one older autonomous waiter and one interactive waiter
  execute holder → interactive → autonomous;
- an aged autonomous waiter eventually runs under repeated interactive arrivals;
- aggregate bounded-depth and idempotent release tests remain green;
- a true external/unknown DMR owner still returns typed busy after the lane is
  acquired;
- the live browser request selects and executes a governed DPF tool while
  autonomous work contends for local inference, within the interactive admission
  budget;
- no local overlap/OOM and no regression to remote-provider admission.

Stop rather than weaken the contract if the protected gate, semantic review,
merge queue or exact-live verification refuses it. Multi-replica aggregate
admission is explicitly not claimed by this slice.

## 8. Proposed extension: accepted interactive capacity recovery

**State: proposed; implementation and acceptance are unrun.** This section extends
the existing BI-285EF102 delivery, not the background-only scope of BI-F6AD1E18
or BI-A50F6B7B. The deployed lane repair and its proofs remain valid. Original
AC-LIP-5 remains failed: the 2026-10-16 canonical governed lookup's corrective
inference expired after 120000 ms behind a real autonomous plan request lasting
about 308 seconds. The later successful 70377 ms lookup had no proven autonomous
overlap. Neither that lookup nor the successful source-answer controls is a
load-acceptance pass.

### 8.1 Decision and evidence

WWMD DI-9A4E9EE0053E selected `same-turn-pretool-recovery`: composite 9.389,
margin 2.217, high confidence, autonomy eligible, no commandment conflict. The
agent recorded agreement. The alternatives were general post-tool loop replay
and retaining terminal retry guidance. Existing-substrate reuse, one source of
truth and platform-owned execution support the selected bounded extension.
This decision selects direction; it is not an independent design receipt or a
claim that the source is implemented.

Source was inspected at 92bd1ea9532a001d10f0c1743a616074be7c93c6, containing
canonical 305c5e2af8d446c4e263cf96d90fad41c82fc5a2:

- `app/api/agent/send/route.ts` persists the user message, acknowledges it and
  runs `sendMessage` in a process-local IIFE. Accepted input survives; execution
  does not have a durable continuation.
- `lib/actions/agent-coworker.ts` authenticates the human, constructs context,
  calls the loop and persists a capacity failure as a finished system response.
- `lib/tak/agentic-loop.ts` has no typed durable checkpoint. A failed corrective
  dispatch can follow a settled but unverified model answer without any tools.
- `lib/mcp-task-capacity-contract.ts` supplies bounded backoff and a versioned
  same-TaskRun wait. Its zero-executed-tools predicate alone is insufficient:
  loop-intrinsic tool loading can mutate messages without entering that array.
- `lib/tak/autonomous-work-run.ts`, the external-MCP background outbox/worker,
  and `lib/jobs` already provide TaskRun, immutable TaskMessage, jobs, CAS and
  scheduled reconciliation. Their MCP bearer requirements must remain unchanged.

### 8.2 Identity and acknowledgment

One accepted user message owns one TaskRun and one preallocated assistant-message
id. The TaskRun's server-owned input binds the human, thread, accepted message,
route, mode, attachment/question/form references, history boundary and digest.
Never resolve the newest conversation TaskRun as the continuation identity.

Persist the accepted input and recoverable submission atomically before a
successful acknowledgment. Job emission uses an outbox so an event-delivery
failure cannot lose acknowledged work. A worker reloads the committed packet;
neither a browser nor a wake event supplies a replacement actor or replay body.
Only the oldest nonterminal accepted turn in a thread may execute; later accepted
turns remain queued and cannot enter the older turn's context.

Extract shared preparation, execution and final-message persistence into
server-only modules. Public server actions retain session authentication and
ownership checks. A durable worker revalidates the original human with
`currentUserContext`, current thread ownership, coworker lifecycle/grants,
Workroom posture and routing/privacy rules. Do not add an actor argument to a
public server action or manufacture an MCP token. Audit every nested
session-dependent context reader during extraction.

### 8.3 Closed pre-tool continuation

This version resumes only a proven local HTTP admission-capacity wait before
any tool or loop intrinsic starts. It excludes terminal-writer policy, execution
plans, structured assistant tool calls/tool-role history, changed dynamic tool
surfaces, unknown failures, execution uncertainty and all post-tool work.
Authentication, configuration, missing models, privacy/capability refusal and
context overflow remain terminal. Generic error-text matching is insufficient.

Persist a versioned, digest-bound checkpoint of the **pending dispatch**, not a
fresh `sendMessage` invocation. It contains the exact message snapshot and
provenance, original system-instruction provenance, allowed tool names/policy
ceiling, settled last-result metadata, best pre-nudge answer, current iteration,
inference/token totals and all continuation/evidence/fabrication/frustration/
truncation counters. Later chat history is excluded. Resume restores that state;
it does not rerun successful inference, reset nudges or create another reply.
No raw provider reasoning or credentials belong in the checkpoint.

The versioned state inventory is exhaustive, not an illustrative field list.
It also fixes original evidenceRequirement/suppliedSourceEvidence, original
skill and turn policy, effective route/model/tool-schema digests,
resolvedMaxContextTokens, ctxPeakTokens and previousResponseId. Preserve both
raw loop messages and the exact pending dispatch. Evidence intent must not be
reclassified from a nudge-tailed message array. The local chat protocol must
prove previousResponseId absent, or retain and validate it without introducing
a different provider protocol. All excluded tool/intrinsic state must assert
zero/empty, including dynamic attachment changes and execution-plan state.
Centralize resumable state in a closed type/schema; missing, unknown or
unsupported state versions fail closed. Review/tests must enumerate every
mutable pre-tool loop variable before enabling the adapter.

Before any governed or intrinsic tool dispatch, atomically mark the turn
non-replayable under its worker reservation. Failure to persist that marker
prevents the tool call. A crash after the marker cannot authorize automatic
replay, even when no completed ToolExecution exists. Preserve the existing
execution-uncertain classification and governed approval/idempotency controls.

### 8.4 State and clocks

Reuse TaskRun status/progress, TaskMessage and the jobs facade. Add a closed
interactive adapter; do not widen the external-MCP worker's token contract,
create another table, scheduler, GPU lane or provider transport.

| State | Durable meaning | Permitted next transition |
| --- | --- | --- |
| submitted | Input committed; dispatch or recovery due | working, canceled |
| working | One CAS-reserved worker owns this accepted turn | submitted with resourceWait, terminal result, canceled |
| submitted + resourceWait | Proven eligible local capacity wait; checkpoint committed; completedAt null | working when due, canceled, bounded exhaustion |
| terminal | Final reply, honest nonretryable failure or cancellation committed once | No automatic replay |

Keep the current local admission and transport timeouts, single-GPU exclusion,
interactive priority and autonomous aging. Reuse the resource-wait backoff and
attempt ceiling, including an honest final busy result on exhaustion.

The extension deliberately separates proven queue waiting from active execution
time: measure admission wait through caller-scoped lane events, persist it, and
exclude only that proven interval from active effort accounting. Preserve the
original effort warrant, iteration/nudge/token ceilings and cumulative active
time across wakes. No wake receives a fresh execution budget. Unknown/unmeasured
time cannot be deducted. This changes clock semantics and requires review; it
does not claim the original within-one-admission-budget AC-LIP-5 passed.

Maintain two separate persisted clocks: cumulative active effort and resource-
wait lifetime. Matched lane events alone exclude an in-process admission interval;
a committed parked/backoff interval belongs to resource-wait lifetime and does
not consume active execution effort. Restart gaps without a committed parked
state are conservatively charged or settled uncertain, never guessed away.
Preserve any original absolute governed parent deadline unchanged and enforce
it on every wake, independently of these clocks. Never derive a fresh parent
deadline from now plus remaining effort, revive a closed parent, or extend the
deadline to fit a backoff. An expired parent settles without model/tool dispatch.
A crash after provider dispatch without a durable settled capacity rejection
remains execution-uncertain; zero tools alone cannot authorize replay.

CAS owns reservation, parking and settlement. Deterministic event delivery is
an optimization, not the sole duplicate-execution control. Cancellation updates
the parent TaskRun durably, removes a queued waiter, and prevents later wake or
reply settlement. Active transport retains its GPU reservation until settled.
Status and reconnect read durable state; the event bus remains best effort.

### 8.5 Proposed extension acceptance

Keep original AC-LIP-1 through AC-LIP-4 unchanged. Retain original AC-LIP-5 and
its failures in history. A reviewed baseline amendment must distinguish bounded
attempt latency from eventual turn completion; never edit the old result into a
pass. Proposed extension criteria:

| Acceptance | Objective | Required outcome |
| --- | --- | --- |
| AC-LIR-1 | OBJ-LIP-4 | A successfully acknowledged interactive local turn has one durable accepted-message/TaskRun/reply identity and recoverable original input, including when event emission fails. |
| AC-LIR-2 | OBJ-LIP-4 | A proven eligible local admission expiry persists a same-turn capacity wait with completedAt null and resumes the exact pending dispatch automatically after capacity recovers. |
| AC-LIR-3 | OBJ-LIP-4 | Duplicate deliveries, process restart and later user messages do not duplicate execution, change original context or create a second final reply. |
| AC-LIR-4 | OBJ-LIP-4 | Original effort limits and spent work persist across wakes; observed admission and committed parked time are accounted separately; recovery attempts/backoff remain bounded and original absolute parent deadlines never extend. |
| AC-LIR-5 | OBJ-LIP-4 | Cancellation, revoked human membership/grants, changed ownership/posture/privacy, malformed checkpoints, execution uncertainty and any started tool or intrinsic block automatic replay. |
| AC-LIR-6 | OBJ-LIP-4 | The canonical portal shows a persisted waiting state and completes a real governed local tool turn behind a naturally occurring long autonomous holder, with actual overlap, capacity wait, release, tool execution and final reply evidence. |

### 8.6 Research, rollout and rollback

[Inngest idempotency](https://www.inngest.com/docs/durable-execution/guides-and-advanced/idempotency)
distinguishes delivery deduplication from making effects safe to repeat; therefore
the database reservation and durable pre-tool fence remain required.
[Inngest concurrency](https://www.inngest.com/docs/durable-execution/flow-control/concurrency)
supports execution limits by key; thread ordering supplements the existing GPU
lane rather than replacing it.
[AWS workflow error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
supports named transient-error handling; broad retries remain excluded.

These primary references were read on 2026-10-17. The implementation sequence
and exact verification obligations extend the existing July admission plan.
No implementation starts without current coverage and required independent
contract review. Release uses the protected queue and canonical self-upgrade;
live acceptance waits for materially containing bytes and actual natural load.
Rollback stops new recoverable submissions, preserves existing waits as visible
pending obligations, and either drains them with the compatible worker or
settles them explicitly. Never silently strand accepted tasks by reverting the
only worker or discarding checkpoints.
