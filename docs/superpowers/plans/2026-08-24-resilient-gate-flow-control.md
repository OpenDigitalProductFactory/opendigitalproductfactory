---
status: active
---

# Resilient Gate Flow-Control Implementation Plan

**Program:** `BI-7C1F43E3`

**Decision:** `DI-83C76A3C1B58`

**Canonical design:** `docs/superpowers/specs/2026-08-15-resilient-concurrent-development-process.md`

## Outcome

Increase delivery throughput without reducing evidence quality by moving wait state into the platform, selecting verification work before heavyweight admission, and coalescing equivalent immutable work. The measured starting point is four pull requests in seven hours and 1,222 estimated waiting calls among 1,297 nonproduction lease calls.

## Invariants

- A pass is valid only for its exact integration tree, evidence-plan digest, toolchain fingerprint, and gate kind.
- Missing or untrusted impact data expands verification; it never suppresses it.
- Queued work remains live without a client process or polling heartbeat.
- Existing Workroom, lease, task, queue telemetry, and evidence records remain canonical.
- Every change is independently deployable and reversible.
- Documentation, UX, migration, and operator-facing behavior are explicit blast-radius dimensions.

## Slice 1 — Authoritative evidence lanes (`BI-B2E9FC9D`)

### Requirements

- `REQ-LANE-1`: classify an immutable candidate/integration tree before claiming a heavyweight lease.
- `REQ-LANE-2`: documentation-only work runs the exact documentation evidence contract without a heavyweight lease.
- `REQ-LANE-3`: affected work runs mapped evidence; unsafe input expands to exhaustive.
- `REQ-LANE-4`: recorded evidence contains lane, plan digest, selected commands, tree identity, and escalation reasons.

### Implementation

1. Add a pure execution-lane projection to `scripts/lib/ci-evidence-plan.mjs` and contract tests for documentation, affected, and exhaustive plans.
2. Split `createLocalIntegrationPlan` into merge/setup, global guards, affected/exhaustive verification, and production-build command groups. Select groups from a supplied evidence plan rather than always appending full Vitest and build.
3. Add a pre-admission planner step to `scripts/gate-worktree.mjs`. When the clean candidate contains the accepted base, its tree is the exact integration tree: run documentation guards there and record evidence without calling `claim_nonprod_environment_lease`. Otherwise retain the existing exhaustive path.
4. Keep exhaustive admission fail-closed when the planner cannot resolve the base, tree, policy, derived artifacts, or graph advice.
5. Persist the evidence-plan digest and lane in local-CI metadata and governed result evidence.

### Verification

- `node --test scripts/lib/ci-evidence-plan.test.mjs`
- `node --test scripts/lib/local-integration-ci.test.mjs`
- `node --test scripts/gate-worktree-lease.test.mjs`
- Doc index/link/guard checks from the change-impact contract.
- Exact-tree pregate for runtime script changes.

## Slice 2 — Immutable single-flight (`BI-6A5AB570`)

### Requirements

- `REQ-SF-1`: one executor per `(repository, tree, plan, toolchain, gateKind)`.
- `REQ-SF-2`: concurrent callers subscribe to or reuse the existing run.
- `REQ-SF-3`: a new branch commit supersedes only nonterminal requests for the older tree.

### Implementation

1. Derive `gateKey` once. Use it as the transactional lease `claimKey`, and persist it on task/evidence activity for lookup and audit. Add a schema index only if query measurements require one.
2. Make claim transactional: return `reused`, `admitted`, `queued`, or `blocked` with the canonical task/lease identity.
3. Apply the same identity to independent semantic review and exact-tree CI receipts.
4. Add concurrency race tests and immutable-receipt reuse tests.

### Verification

- Parallel claim test proves one executor and N subscribers.
- Same tree/policy/toolchain reuses a valid result.
- Any identity component change produces a distinct run.

## Slice 3 — Durable wait and resume (`BI-MCP-EFF-0285909C`)

### Requirements

- `REQ-WAIT-1`: queued clients disconnect without losing position.
- `REQ-WAIT-2`: release/capacity transitions wake server workflows and notify connected clients.
- `REQ-WAIT-3`: missed notifications recover by bounded reconciliation.

### Implementation

1. Add `nonprod/durable-wait.ts` as the single projection service. Derive a deterministic task identity per lease/subscriber, persist `nonprod-lease-wait.v1` in `TaskRun.progressPayload`, bind the lease to its owner task, and make capacity-event updates idempotent. No Prisma migration.
2. Extend `claim_nonprod_environment_lease` with a bounded `waitDeadlineAt`. When a claim is queued or subscribed, return the MCP task and checkpoint the wait; when its fresh claim admits, reuses evidence, or becomes terminal, settle that task. Accept a refreshed PID/process identity for a same-owner queued host-resource claim because its original runner is intentionally gone.
3. After release/expiry, select only the FIFO head of each capacity lane and emit a typed event carrying task, lease, claim, owner session, immutable candidate, and event identity. Add a five-minute scheduled reconciliation that repairs a lost wake and owns queued liveness until the task deadline.
4. Add an Inngest durable-wait function: wait for the exact capacity event with `step.waitForEvent()`, then apply the idempotent task transition. Keep direct durable transition/replay as the recovery path when Inngest or advisory delivery is unavailable.
5. Extend the MCP task projection with wait metadata and add authenticated Streamable HTTP GET/SSE. One connection replays all durable `capacity-available` tasks for the token's user, then publishes `notifications/tasks/status`; it does not create one connection per waiter.
6. Change `gate-worktree.mjs` and `host-resource-runner.mjs` to write atomic wake descriptors and terminate on `queued`/`subscribed`, without release or renewal. On a wake they re-read the task and make one fresh claim; the existing active-lease supervisor remains unchanged after admission.
7. Add one host adapter process for the contributor toolchain. It consumes the SSE stream, deduplicates event ids in a bounded local ledger, and invokes the provider's supported session-resume command. Codex is the first executable adapter; unsupported providers surface the durable task and recovery command instead of polling.
8. Update contributor bootstrap and operations documentation so the adapter is installed, health-checked, and visible. Record queue/task/event ids in gate evidence for later throughput attribution.

### Verification

- A queued task has no live client Node process after suspension.
- One release produces one wake-up and one fresh claim.
- Dropped SSE still resumes through reconciliation.
- Waiting lease-call volume falls at least 95% in a soak test.
- A duplicated release/event does not launch a second resume.
- A queued host-resource claim survives the intentional death of its original PID and safely rebinds only on the same owner/claim/resource contract.
- A reconnecting singleton adapter replays an unconsumed wake without one resident process per task.

### Exact implementation sequence

1. **Red — projection and idempotency:** add focused tests for deterministic task ids, queued checkpointing, duplicate event suppression, task settlement, and deadline expiry.
2. **Green — server state:** implement the projection service and wire claim/release/reap paths. Run the environment-lease and nonprod MCP pack suites.
3. **Red/green — transport:** add route tests for authenticated GET/SSE replay, live task notification, disconnect cleanup, and task metadata; then implement the singleton stream.
4. **Red/green — durable event:** add Inngest function tests for exact correlation, timeout, duplicate delivery, and reconciliation; register the function and five-minute catalog entry.
5. **Red/green — host:** change the gate and resource-runner fixtures so queueing exits quickly, preserves its claim, writes a descriptor, and performs only one claim after a simulated wake. Add adapter tests for replay, dedupe, Codex invocation, and unsupported-provider fallback.
6. **Functional soak:** hold a capacity lease, enqueue at least ten synthetic waiters, release once, drop/reconnect the stream, and run reconciliation. Assert zero resident waiter processes, FIFO-head wake, no duplicate execution, and at most one normal claim plus one five-minute recovery read per wait interval (at least 95% fewer waiting MCP calls than the recorded baseline).
7. **Documentation and handoff:** update install/contributor operations, regenerate the documentation index, record before/after telemetry, run the impacted suites plus typecheck and policy guards, then ship through independent semantic review, exact-tree CI, DCO, and the protected merge queue.

## Slice 4 — Governed host resource lanes (`BI-30EDD4B0`)

**Architecture decision:** `DI-F6868CA99BC1` selected explicit typed fields on
the existing `NonProductionEnvironmentLease` at high confidence. The host lane
therefore does not create a new broker/table or encode its contract into a
free-form purpose string. `resourceClass`, `expectedMemoryBytes`, and
`ownerPid` extend the existing durable authority; the in-process
`ResourceLane` remains its portal adapter. `ownerProcessIdentity` accompanies
the PID so liveness cannot be fooled by OS PID reuse.

### Requirements

- `REQ-RES-1`: TypeScript, Vitest, Next, Docker, preview, and inference declare resource class and expected memory.
- `REQ-RES-2`: capacity uses host pressure and reserved inference memory.
- `REQ-RES-3`: descendants terminate before resource release.

### Implementation

1. Extend the existing nonproduction admission policy to named resource lanes; do not create client-specific semaphores.
2. Add measured peak working-set telemetry and configurable host reserve.
3. Route all canonical script entry points through the resource broker.
4. Detect ungoverned matching processes and return one actionable owner diagnostic.
5. Route the root `typecheck`, `test`, `build`, and development-preview scripts
   through one Node-native host runner. Cloud CI bypasses host-local admission;
   a configured DPF contributor host fails closed when the lease facade is not
   reachable.
6. When admission is full, return a typed bounded retry and exit. Do not retain
   a polling Node process; Slice 3 later replaces retry with server-driven wake.

### Verification

- Mixed compile/build/inference load stays within configured committed-memory budget.
- A killed owner releases or expires without leaked descendants.
- A process cannot bypass admission through an alternate client entry point.

## Slice 5 — Workroom WIP and progress guarantees (`BI-114C1F40`)

### Requirements

- `REQ-WIP-1`: one canonical Workroom for a repository/branch across Windows path spellings.
- `REQ-WIP-2`: waiting does not count as active execution WIP.
- `REQ-WIP-3`: stalled work emits one deduplicated escalation with a recovery action.
- `REQ-WIP-4`: readiness projections are versioned and self-identify stale inputs.

### Implementation

1. Canonicalize repository, branch, path, and root-session identity before Workroom lookup and persistence; merge safe duplicates through a governed repair.
2. Add explicit `waiting(resource|review|input)` projections and transition timestamps.
3. Enforce portfolio/resource-lane WIP limits at activation, not task creation.
4. Add oldest-wait and no-transition monitors with owner routing and deduplication.
5. Return `projection-stale` plus recomputation identity when readiness disagrees with canonical demand state.

### Verification

- `D:\path` and `D:/path` claims refresh one Workroom.
- A durable waiter consumes no active execution slot.
- A 30-minute no-transition simulation emits one alert, then resolves on progress.
- Canonical classification cannot yield `CLASSIFICATION_REQUIRED` from the same versioned read.

## Delivery and coverage map

| Deliverable | Requirement refs | Contract refs | Flow refs | Verification refs | Depends on |
| --- | --- | --- | --- | --- | --- |
| `BI-B2E9FC9D` | `REQ-LANE-1..4` | Evidence lane table; exact evidence identity | Plan → lane → execute/claim | Slice 1 tests and exact-tree pregate | — |
| `BI-6A5AB570` | `REQ-SF-1..3` | Gate run identity | Claim → reuse/subscribe/admit | Slice 2 race/reuse tests | `BI-B2E9FC9D` |
| `BI-MCP-EFF-0285909C` | `REQ-WAIT-1..3` | Durable admission flow | Queue → suspend → event → fresh claim | Slice 3 disconnect/drop/soak tests | `BI-6A5AB570` |
| `BI-30EDD4B0` | `REQ-RES-1..3` | Resource lanes | Declare → admit → supervise → release | Slice 4 memory/fence tests | `BI-B2E9FC9D` |
| `BI-114C1F40` | `REQ-WIP-1..4` | Workroom identity and liveness | Active ↔ waiting → promotion | Slice 5 identity/SLO tests | `BI-6A5AB570`, `BI-MCP-EFF-0285909C` |

## Rollout and rollback

1. Ship lane selection in observe mode for non-documentation branches while making documentation bypass authoritative.
2. Compare selected versus exhaustive evidence on a bounded sample; promote affected execution only after zero missed failures.
3. Enable single-flight before durable client suspension so every waiter has one canonical run to observe.
4. Enable notification adapters per client, retaining reconciliation throughout rollout.
5. Introduce resource lanes one process family at a time and retain the existing local-CI fence as the rollback path.
6. Enable WIP/SLO enforcement in report-only mode, then enforce after thresholds are calibrated.

Rollback is configuration-first: force exhaustive planning, disable client suspension adapters, or restore one-slot resource policy. Immutable evidence and queue telemetry remain valid through rollback.

## Success measures

- Waiting claim/list calls reduced by at least 95%.
- No duplicate review or CI execution for one immutable gate identity.
- Documentation PRs do not enter the heavyweight queue.
- Median and p95 time from implementation-complete to PR-open improve without increasing change-failure rate.
- Host committed memory stays within the configured reserve while local inference is resident.
- PR throughput improves from the 0.57 PR/hour baseline; report throughput together with lead time and failure rate, not as a vanity count.
