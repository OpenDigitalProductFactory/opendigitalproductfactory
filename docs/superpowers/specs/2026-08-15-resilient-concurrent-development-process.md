---
status: binding
---

# Resilient Concurrent Development Process

**Surface-agnostic flow control for high-fan-out AI development**

- Program: `BI-7C1F43E3` — Restore flow efficiency across DPF external-agent delivery gates
- Epic: `EP-56AE0F69` — Reset/dogfood cycle 3: install, lifecycle, agent-host and CI-gate findings
- Decision: `DI-83C76A3C1B58` — durable flow control selected with high confidence and no commandment conflict
- Extends `AGENTS.md` doctrine: four peer surfaces, one process; governance approves evidence, not provenance.

> **2026-09-03 local-capacity decision.** The operator selected two paired local
> installations as the primary capacity investment. The extension in
> [`2026-09-03-local-first-agentic-delivery-throughput-design.md`](2026-09-03-local-first-agentic-delivery-throughput-design.md)
> keeps this specification's server-owned admission and resource lanes, adds
> capability/pressure-aware cross-install placement, and retains cloud CI as the
> protected safety net and contingency lane—not the default scaling strategy.

## 1. Problem and measured baseline

DPF needs high fan-out, but fan-out is useful only while work keeps moving. The current host ran continuously and produced four pull requests in seven hours: about 0.57 PR/hour. During the same investigation, nonproduction lease traffic contained 498 claims, 426 renewals, and 373 list calls. Of those 1,297 calls, 1,222 (about 94%) were estimated waiting overhead rather than useful state transitions.

The bottleneck is not merely a two-slot gate. It is the shape of the work around the gate:

1. Waiting is implemented by live client processes that repeatedly call MCP.
2. The CI evidence planner is advisory locally, so documentation and affected-only changes still enter the heavyweight lane.
3. The same immutable tree can be reviewed or gated more than once when tasks race.
4. Workroom identity is not canonical across path spellings. A Windows path written with `\` and `/` created two records for one branch, worktree, session, and task.
5. Readiness projections can disagree with canonical demand state, leaving tasks unable to tell whether they should proceed, sleep, or escalate.
6. Typecheck, Vitest, Next builds, Docker, model inference, and preview environments can compete for RAM outside one shared admission model.

The result is a queue of active Node processes, tool traffic, memory pressure, and repeated reasoning around a small number of actual transitions.

## 2. Binding constraints

- **C1 — Preserve useful concurrency.** Do not solve contention by imposing one global thread limit. Limit work-in-process at each constrained resource.
- **C2 — Evidence may not weaken.** Every pass is bound to an immutable tree, policy, toolchain, and evidence tier. Unresolved scope expands to exhaustive verification.
- **C3 — Waiting consumes no worker.** A task waiting for a gate must be durably suspended. It must not retain a Node process, model context, heartbeat loop, or heavyweight lease.
- **C4 — One identity, one execution.** Equivalent review and CI requests coalesce. A retry observes the existing run instead of creating another.
- **C5 — The platform owns liveness.** Clients may disconnect, restart, or omit advisory instructions without losing queue position or evidence.
- **C6 — Local memory is a governed resource.** All heavyweight host processes use resource lanes; process naming or client provenance cannot bypass admission.
- **C7 — Fail closed with a reason.** Stale projections, identity conflicts, and missing evidence block the affected transition and produce one actionable escalation.

## 2.1 Objectives and acceptance contract

**OBJ-FLOW-001:** Replace rapid nonproduction admission polling with a server-owned durable wait that preserves FIFO identity while the client process is absent.

**OBJ-FLOW-002:** Wake only the exact FIFO head after capacity changes, without allowing an event or client-supplied field to grant admission.

**OBJ-FLOW-003:** Make missed notifications recoverable through bounded reconciliation and idempotent event identity.

**OBJ-FLOW-004:** Treat a durable capacity wait as live Workroom progress without counting it as executing work.

**OBJ-FLOW-005:** Surface executing, next-ready, dormant, oldest-wait, no-transition, throughput, p95 wait, and abandonment signals through canonical operational read models.

| Acceptance criterion | Objective links | Observable result |
| --- | --- | --- |
| AC-FLOW-001 | OBJ-FLOW-001 | A queued claim returns one deterministic TaskRun, extends only the queued lease to the bounded wait deadline, and the canonical runners exit without renew/list/claim polling or releasing queue position. |
| AC-FLOW-002 | OBJ-FLOW-002 | Release or expiry selects only the FIFO head and persists an exact lease/claim/session/candidate-bound capacity event before advisory delivery. |
| AC-FLOW-003 | OBJ-FLOW-003 | Duplicate events are suppressed, and a five-minute reconciler repairs missed delivery without creating a second wait identity. |
| AC-FLOW-004 | OBJ-FLOW-004 | An exact worktree/branch durable lease prevents Workroom reaping even when its authoring lease expired; queued work remains outside the executing count. |
| AC-FLOW-005 | OBJ-FLOW-005 | Workroom and queue projections show heavy-lane state and progress SLO breaches, including backlog with zero completions and p95 wait beyond one hour. |
| AC-FLOW-006 | OBJ-FLOW-001, OBJ-FLOW-002, OBJ-FLOW-003 | A woken client must re-read the TaskRun and make one fresh host-pressure-aware claim; neither TaskRun nor event admits capacity. |

## Design grounding

- **Existing specs/plans reviewed:** this resilient-development specification and `docs/superpowers/plans/2026-08-24-resilient-gate-flow-control.md`.
- **Current code substrate reviewed:** `NonProductionEnvironmentLease`, `TaskRun`, Workroom liveness, queue telemetry, MCP lease handlers, and the two canonical host runners.
- **Source of truth:** the lease remains FIFO admission authority; TaskRun is the durable wait projection; queue and Workroom read models remain operational projections.
- **Decision:** extend the existing lease and TaskRun substrate with one bounded, idempotent server-owned wait. No client event, notification, or UI state grants capacity.

## 3. Canonical identities and state

No parallel queue or evidence table is introduced. Existing `Workroom`, `NonProductionEnvironmentLease`, `QueueTelemetryEvent`, task lifecycle, and local-CI evidence records remain authoritative.

### 3.1 Workroom identity

Before lookup or persistence, normalize:

- repository to its canonical full name;
- branch to the Git ref spelling used by the provider;
- Windows paths to a resolved absolute path with one separator and case policy;
- session aliases to the root provider session when supplied.

The unique logical key is `(repository, branch)`. Path and session are attributes used for liveness and conflict explanation, not alternate identities. A same-owner re-claim refreshes one Workroom.

### 3.2 Gate run identity

A gate request derives:

`gateKey = sha256(repository + integrationTreeSha + evidencePlanDigest + toolchainFingerprint + gateKind)`

`GateRun` is a logical projection over existing lease, task, and evidence records. It is not a new mutable source of truth. The heavyweight lease uses `gateKey` as its transactional `claimKey`; task and evidence records carry the same value for lookup and audit. For a given `gateKey`:

- one executor may be admitted;
- any number of tasks may subscribe;
- a valid terminal result is reused;
- a failed or expired result may be retried with a new attempt under the same key;
- a changed tree, policy, toolchain, or gate kind creates a new key.

Semantic review uses the same rule with `gateKind=semantic-review` and the committed tree SHA. Exact-tree CI cannot consume a receipt for a different tree.

## 4. Evidence lanes

The existing CI evidence planner becomes the admission authority. It evaluates the immutable candidate/integration tree before any heavyweight lease is claimed.

| Lane | Qualification | Runs | Shared heavyweight lease |
| --- | --- | --- | --- |
| **Plan-only** | Invalid/missing planner input or dry-run | Planner and diagnostics only; unresolved input escalates | No |
| **Documentation** | `docsOnly=true`, no escalation, clean exact candidate tree contains the accepted base | Doc index, link, derived-artifact, and repository guards in the candidate worktree | No |
| **Affected code** | Planner is trusted and `fullSuite=false` | Global guards, affected package typechecks, mapped tests, changed-route UX evidence | Resource-specific lane only; no Docker/Next build lease |
| **Exhaustive** | Risk escalation, unsafe graph, merge group, main, schedule, or explicit override | Full typecheck, full tests, production build, required integration and UX evidence | Yes; preferably elastic cloud execution |

Documentation is not “no verification.” It is a smaller, exact, policy-defined evidence contract. An edit to workspace configuration, generated contracts, migration state, gate policy, or an unresolved derived artifact cannot enter the documentation lane.

The first rollout admits the documentation lane only when `origin/main` is an ancestor of the clean candidate SHA, so the candidate tree is also the integration tree. A stale base, dirty worktree, unresolved tree, or planner escalation uses the existing exhaustive integration path. A later slice may synthesize a unique lightweight merge worktree; this slice does not claim evidence for a prospective tree it did not execute.

The planner output records its lane, selected commands, reasons, affected tests/routes/packages, policy version, digest, and immutable tree. The executor must run that plan or fail; it may not silently replace an affected plan with an exhaustive one merely because exhaustive is easier to invoke.

## 5. Durable admission and wake-up flow

1. The client requests a gate using the immutable `gateKey` and its owner/task identity.
2. The platform returns one of `reused`, `admitted`, `queued`, or `blocked`.
3. On `queued`, the task stores a durable wait with the lease/task id and disconnects. Queued liveness is server-owned; client polling is not a heartbeat.
4. Release, expiry, capacity change, or reconciliation emits a queue transition event.
5. DPF resumes subscribed platform workflows through the existing Inngest event bus. MCP Streamable HTTP clients receive a task status notification/SSE event when supported. Codex and other clients use a host adapter that wakes the task; they do not keep the original Node command alive.
6. Because release deliberately does not admit using stale host pressure, a woken task makes one fresh claim. The durable claim key preserves order and prevents duplication.
7. If a notification is missed, a low-frequency reconciliation checks durable task state. Reconciliation is a safety net, not the normal wait mechanism.

MCP task notifications are optional by specification, so correctness never depends on delivery. The server-owned task and lease state is authoritative; events reduce latency and traffic.

### 5.1 Durable wait projection

No wait table is added. Each queued claimant or immutable-run subscriber is
projected as a `TaskRun` whose `repeatedPatternKey` is
`nonprod-wait:<leaseId>`. The lease remains queue authority; the task is the
durable client-facing checkpoint. Its `progressPayload` carries a versioned
`nonprod-lease-wait.v1` envelope with:

- lease id, stable claim key, environment, owner provider, owner session, and
  Workroom/worktree identity;
- immutable candidate identity when the claim is a gate run;
- wait deadline, current wait state, queue position, and last transition time;
- the last capacity-event identity and whether a fresh claim consumed it.

The MCP task remains `submitted` while its wait state is `waiting`. A capacity
event updates the same task to `capacity-available`; admission, terminal
evidence reuse, cancellation, or deadline expiry completes or cancels it. The
MCP projection includes the wait envelope in task metadata, so `tasks/get` is
the durable recovery read even when notifications were missed.

### 5.2 Capacity event identity and delivery

A normal wake has identity
`nonprod-capacity:<environment>:<released-or-expired-lease>:<head-lease>`.
Reconciliation uses
`nonprod-reconcile:<environment>:<head-lease>:<five-minute-bucket>`.
Task updates compare the stored event identity before writing or notifying, so
release retries and duplicate Inngest delivery are idempotent. The event
contains the lease, claim, owner session, task, immutable candidate, and event
identity; adapters never reconstruct authority from prose.

After the lease transaction commits, DPF persists the task transition, emits
the matching Inngest event for suspended platform workflows, and broadcasts an
advisory `notifications/tasks/status` message. One authenticated Streamable
HTTP SSE connection serves all waiting tasks for a host. On reconnect it first
replays durable `capacity-available` tasks, then follows live events. In-memory
broadcast is latency only; TaskRun plus bounded reconciliation is correctness.

### 5.3 Server-owned liveness and host resume

The initial claim supplies a bounded wait deadline separately from the short
active-lease TTL. While the task remains live, the five-minute reconciler owns
queued expiry and may extend it only to the earlier of the next reconciliation
window or the wait deadline. Clients do not renew queued leases. Active leases
retain their existing short heartbeat and process-fence rules.

`gate-worktree` and `host-resource-runner` write an atomic local wake descriptor
and exit with the typed queued result. A singleton host adapter holds the one
SSE connection, deduplicates event identities on disk, and resumes the owning
Codex session with the immutable task/lease identity. The resumed client
re-reads `tasks/get` and makes exactly one fresh claim with current host
pressure. Claude/Grok adapters consume the same descriptor contract when their
session-resume command is available; lack of a native resume command degrades
to an operator-visible durable task, not polling.

The adapter is not queue authority, does not reserve capacity, and cannot mark
a task admitted. Its only authority is to deliver a wake hint to the recorded
owner. If it is stopped, the next connection replays unconsumed durable events;
if delivery is lost entirely, the five-minute reconciliation emits another
bounded event.

## 6. Resource lanes and host memory

All heavyweight developer processes must declare a lane and expected memory class:

| Resource lane | Examples | Default policy |
| --- | --- | --- |
| `host-compile` | TypeScript, affected Vitest | Bounded workers and heap; multiple only within measured RAM budget |
| `host-build` | Next production build | Single-flight per tree; one admitted host build unless pressure policy permits more |
| `container-build` | Docker build, local integration stack | Existing nonproduction lease and process fence |
| `preview` | Shared portal/UX verification | Governed shared environment lease |
| `model-inference` | Local llama.cpp model and KV cache | Reserve model/working-set memory before admitting developer processes |

Capacity is computed from available RAM, committed memory, recent peak working sets, and a safety reserve. It is not a fixed number of clients. A resource-lane holder must terminate descendants before release; ungoverned matching processes block admission and produce one owner-visible diagnostic.

## 7. Workroom flow, WIP, and liveness

Every Workroom projects one of these states:

`ready → active → waiting(resource|review|input) → active → ready-for-promotion → terminal`

Only `active` work consumes an agent execution slot. `waiting` work is persisted and resumable.

Enforcement:

- WIP limits apply per portfolio and constrained lane, not as one global thread cap.
- A task may have one active implementation identity and one outstanding gate request per immutable tree.
- A new commit supersedes older queued review/CI requests for that branch; completed receipts remain immutable history.
- No-progress and oldest-wait thresholds emit one deduplicated escalation with owner, blocker, last transition, and recovery action.
- Reapers use server state plus process/host evidence. A queued durable task is live without a client process; a duplicate path spelling is not a second task.
- Readiness decisions must cite the exact canonical fields and versions they evaluated. A projection that conflicts with canonical state returns `projection-stale` and requests one recomputation instead of asking every client to retry.

Initial service objectives:

- 95% reduction in claim/list calls made only to wait;
- p95 queued client CPU time below one second per minute of wait;
- documentation lane starts within 30 seconds on a healthy host;
- no duplicate semantic review or exact-tree CI execution for the same `gateKey`;
- queued-to-admitted transition visible within 15 seconds when notifications are connected, within five minutes through reconciliation;
- no Workroom without a state transition or explicit blocker for more than 30 minutes while its owner task is active.

## 8. Cross-surface enforcement

| Concern | Claude | Codex | Grok | Antigravity | Build Studio |
| --- | --- | --- | --- | --- | --- |
| Workroom identity/readiness | Platform | Platform | Platform | Platform | Platform |
| Evidence lane selection | Planner | Planner | Planner | Planner | Planner |
| Durable wait/resume | MCP task adapter | MCP task/host adapter | MCP task adapter | MCP task adapter | Native Inngest wait |
| Gate/review single-flight | Platform | Platform | Platform | Platform | Platform |
| Evidence acceptance | Platform | Platform | Platform | Platform | Platform |

Build Studio remains an optional executor, not the workflow authority. Removing Build Studio does not remove the need for Workrooms, task state, evidence planning, or governed promotion. Conversely, retaining it does not justify a separate queue or evidence contract.

## 9. Standards and comparable systems

- MCP Tasks provides durable task status plus optional `notifications/tasks/status`; Streamable HTTP supports server-to-client notifications over SSE. DPF follows the notification-plus-reconciliation model because clients cannot rely on optional delivery. See [MCP Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks) and [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
- Inngest `step.waitForEvent()` suspends a workflow until an event or timeout without retaining the client process. DPF already uses this substrate, so it is the server-side resume mechanism rather than a new queue. See [Inngest event waits](https://www.inngest.com/docs/typescript).
- GitHub Actions concurrency groups coalesce work by a stable key and allow bounded pending work. DPF adopts stable concurrency identities but preserves immutable completed evidence instead of canceling it. See [GitHub Actions concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
- Nx affected uses Git plus a project graph to run only impacted tasks, and expands on dependency uncertainty. DPF's evidence planner follows this affected-first, fail-safe expansion model without adopting another build system. See [Nx affected](https://nx.dev/docs/features/ci-features/affected).

## 10. Rollout and ownership

1. `BI-B2E9FC9D` — make evidence lanes authoritative before heavyweight admission.
2. `BI-6A5AB570` — coalesce semantic review and CI by immutable gate identity.
3. `BI-MCP-EFF-0285909C` — replace lease polling with durable wait/resume and reconciliation.
4. `BI-30EDD4B0` — converge heavyweight developer processes on governed resource lanes.
5. `BI-114C1F40` — enforce Workroom WIP, progress SLOs, and durable-wait liveness.

Each slice ships independently, preserves the evidence contract, and records before/after flow telemetry. The scale ceiling after these changes is the capacity of cloud/host executors, not the number of waiting client processes. Further scale comes from remote cache/distributed execution and more executor capacity, not more polling.
