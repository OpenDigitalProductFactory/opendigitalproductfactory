---
status: binding
---

# Resilient Concurrent Development Process

**Surface-agnostic flow control for high-fan-out AI development**

- Program: `BI-7C1F43E3` — Restore flow efficiency across DPF external-agent delivery gates
- Epic: `EP-56AE0F69` — Reset/dogfood cycle 3: install, lifecycle, agent-host and CI-gate findings
- Decision: `DI-83C76A3C1B58` — durable flow control selected with high confidence and no commandment conflict
- Extends `AGENTS.md` doctrine: four peer surfaces, one process; governance approves evidence, not provenance.

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
