---
status: proposed
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
