---
status: draft
---

# Bounded Delivery Control Plane

Status: draft for architecture review  
Backlog: `BI-7C1F43E3` — Restore flow efficiency across DPF external-agent delivery gates  
Epic: `EP-56AE0F69`  
Extends: `2026-08-15-resilient-concurrent-development-process.md` and `2026-06-05-unified-delivery-surfaces-execution-alignment-design.md`  
Workroom: `WC-1B73A988`

> **2026-09-03 throughput extension.** The local-first campaign, paired-install
> placement, PR/review-tail controller, operator delivery rail, and outcome
> scorecard are specified in
> [`2026-09-03-local-first-agentic-delivery-throughput-design.md`](2026-09-03-local-first-agentic-delivery-throughput-design.md).
> They consume this control plane; they do not replace its gate identity, durable
> wait, proportional evidence, or atomic completion packet. `BI-7C1F43E3` remains
> independently owned through its live pilot.

## Decision in one paragraph

Adopt a server-owned, event-driven delivery control plane built on the existing Workroom, TaskRun, NonProductionEnvironmentLease, QueueTelemetryEvent, Inngest, and evidence records. Compute one immutable gate identity before scarce capacity is claimed; park waiting work durably; wake it from capacity/review/input events; and close work only with an atomic evidence packet that matches the candidate, plan, and objective baseline. Do not add a second queue, a second Workroom ledger, or a client polling protocol. This is the smallest architecture that addresses the measured failure mode without weakening protected CI, immutable provenance, approval, or receipt requirements.

## Why this is necessary

The live seven-day efficiency window measured 5,000 MCP calls with 94.28% success, but success concealed a large amount of non-progress traffic:

| Signal | Measured value | Interpretation |
| --- | ---: | --- |
| `get_quiescence_status` | 1,550 calls | repeated waiting checks |
| lease claims | 704 (35 failed) | contention and retry pressure |
| lease renewals | 659 (7 failed) | waiting mistaken for liveness |
| backlog reads | 520 (19 failed) | status polling/N+1 reads |
| lease list calls | 443 | client-side queue reconstruction |
| `find_related_tests` | 89/89 failed | contract/tool discovery gap |
| `record_plan_backlog_coverage` | 22/22 failed | plan packet not validated before write |
| A2A collaboration edges | 0 captured | handoffs are not observable |

The canonical BI baseline is four PRs in seven hours (0.57 PR/hour) and an earlier 1,297 lease calls with about 94% estimated waiting overhead. A recent Workroom also remained `working` after its PR had merged, proving that projections can disagree with durable delivery truth. The installed runtime has no `.git`/`DPF_REPO_ROOT`, so runtime acceptance must use an explicit immutable provenance service rather than retrying Git discovery.

## Goals and non-goals

### Goals

1. Cut wait-only MCP calls by at least 95% from the current baseline without reducing evidence.
2. Prevent duplicate semantic review, exact-tree CI, replay, release, or upgrade for one immutable candidate.
3. Make waiting consume no model context, Node process, heartbeat, or heavyweight lease.
4. Make every Workroom state truthful within 15 seconds of an event and within five minutes after a missed event.
5. Make a completion decision explainable from one packet: objective baseline, plan coverage, delivery evidence, acceptance evidence, and immutable runtime identity.
6. Turn tool-contract failures into one actionable blocker, not a retry storm.
7. Increase throughput from 0.57 PR/hour toward 3 PR/hour in the pilot while preserving first-pass evidence quality.

### Non-goals

- No bypass of protected GitHub checks, DCO, immutable artifact verification, human approval, or genuine receipts.
- No second queue, agent-memory store, or parallel Workroom database.
- No forced concurrency increase when RAM, provider capacity, or review authority is unavailable.
- No assumption that a source-free install can resolve provenance from local Git.

## Canonical objectives

**OBJ-BDCP-WAIT:** Replace wait-only claim, list, lease-renewal, and quiescence polling with a server-owned durable wait that consumes no client process, model context, heartbeat, or heavyweight lease.

**OBJ-BDCP-IDENTITY:** Bind every semantic review, exact-tree gate, release, upgrade, and replay to one immutable candidate identity so duplicate executions cannot be created for the same gate key.

**OBJ-BDCP-WAKE:** Wake only the eligible durable waiter from authoritative capacity, review, approval, or input events, and reconcile missed events within five minutes without turning reconciliation into polling.

**OBJ-BDCP-EVIDENCE:** Admit and complete work only from an exact immutable evidence plan and atomic evidence packet containing genuine baseline, coverage, delivery, acceptance, and runtime provenance references.

**OBJ-BDCP-TRUTH:** Project Workroom and queue state from durable events with one typed blocker and next action, including explicit stale-projection handling.

**OBJ-BDCP-FLOW:** Demonstrate in a seven-day pilot at least 95% fewer wait-only MCP calls, queue CPU p95 below one second per waiting minute, event wake p95 below 15 seconds, zero duplicate gates, and throughput of at least three protected PRs per hour without reducing quality.

**OBJ-BDCP-SOURCE-FREE:** Keep source-free runtime provenance server-verified and fail closed; never fall back to local Git or trust client-supplied target identity.

## Canonical acceptance links

| Acceptance | Objective links | Verifiable outcome |
| --- | --- | --- |
| AC-BDCP-WAIT | OBJ-BDCP-WAIT | A blocked gate performs one authoritative quiescence read, persists a durable waiting state, exits with a stable resumable code, and does not poll or claim scarce capacity. |
| AC-BDCP-IDENTITY | OBJ-BDCP-IDENTITY | Repeated requests for one gate key return the existing run or valid receipt; semantic review, exact-tree CI, release, upgrade, and replay each have zero duplicate executions. |
| AC-BDCP-WAKE | OBJ-BDCP-WAKE | Capacity and approval events wake only the eligible waiter with p95 below 15 seconds, while bounded reconciliation repairs missed events within five minutes. |
| AC-BDCP-EVIDENCE | OBJ-BDCP-EVIDENCE | Completion refuses missing, conflicting, stale, or non-receipted baseline, plan coverage, delivery, acceptance, or runtime evidence and never promotes `INCONCLUSIVE` to `PASS`. |
| AC-BDCP-TRUTH | OBJ-BDCP-TRUTH | Workroom and queue projections show the durable state, typed blocker, and next action within 15 seconds of an event and expose any unresolved projection drift. |
| AC-BDCP-FLOW | OBJ-BDCP-FLOW | One continuous seven-day pilot meets the call-reduction, CPU, wake, reconciliation, duplicate-gate, throughput, protected-check, and first-pass-quality thresholds. |
| AC-BDCP-SOURCE-FREE | OBJ-BDCP-SOURCE-FREE | A source-free install verifies immutable provider and served-image identity or returns one typed blocker; it never consults local Git or accepts client target authority. |

## Constraints

The design preserves the existing C1–C7 constraints: useful concurrency; evidence never weakened; waiting consumes no worker; one logical identity/one execution; platform-owned liveness; governed local memory; and fail-closed reasons. Client status reads are advisory; durable MCP state is authoritative.

## Options considered

| ID | Option | Strength | Failure mode | Decision |
| --- | --- | --- | --- | --- |
| A | Procedure-only throttling | immediate, low code cost | cannot stop polling, duplicate gates, or stale projections | reject |
| B | Existing-substrate durable control plane | fixes waits, deduplication, evidence, and liveness together; no new ledger | requires coordinated schema/contracts and migration | **select** |
| C | New external queue service | high theoretical fan-out | duplicates source of truth, adds outage/security surface, migration cost | reject |
| D | Cloud-only execution lane | less local contention | does not solve evidence/coalescing and increases vendor coupling | reject |

Option B is selected because it extends the already-ratified resilient-concurrency design and directly targets the observed calls and stale-state incidents.

## Architecture

### 1. Canonical identities and gate key

The logical Workroom key remains `(repository, branch)`. A gate request derives:

`gateKey = sha256(repository + integrationTreeSha + evidencePlanDigest + toolchainFingerprint + gateKind)`

The gate key is the transactional claim key on the existing lease and is copied into TaskRun, WorkroomActivity, and evidence records. A changed tree, policy, toolchain, or gate kind creates a new key. Repeated requests return the existing durable run or valid receipt; they do not create a sibling.

### 2. Evidence lanes before capacity

The planner becomes admission authority and emits an immutable evidence plan before any heavyweight claim:

- `plan-only`: plan/spec/document checks only;
- `documentation`: bounded docs/index/link checks;
- `affected-code`: mapped tests/typechecks/routes;
- `exhaustive`: full integration/build/semantic path when scope is unknown or high risk.

Each plan records policy version, selected commands, affected scope, rationale, digest, and candidate tree. The executor either runs that plan or fails with a typed reason.

### 3. Durable wait and wake-up

When capacity, review, approval, or input is unavailable, the server writes a wait record tied to the gate key and disconnects the client. Inngest `step.waitForEvent` and the existing agent event bus wake the waiter. A single fresh claim follows wake-up. A low-frequency reconciliation repairs missed notifications; it is not a heartbeat and does not require a polling process.

### 4. Resource lanes and WIP

Admission is explicit by lane: `host-compile`, `host-build`, `container-build`, `preview`, `model-inference`, and `external-review`. Each lane has a memory class, WIP ceiling, queue order, and retry budget. WIP applies per portfolio and constrained lane, not as one global thread cap. The planner refuses a lane mismatch before a lease is claimed.

### 5. Atomic evidence packet

Completion writes one packet referencing existing records (not a new evidence table):

```json
{
  "candidateSha": "…",
  "integrationTreeSha": "…",
  "planDigest": "…",
  "gateKey": "…",
  "lane": "affected-code",
  "research": ["activity-id"],
  "baseline": "baseline-id",
  "planCoverage": "coverage-id",
  "delivery": ["activity-id"],
  "acceptance": ["activity-id"],
  "runtime": {"servedSha": "…", "provenance": "provider-record-id"},
  "objectiveObservations": ["observation-id"],
  "override": {"kind": "inconclusive", "reason": "…"}
}
```

The closure validator requires exact current SHA, plan digest, objective references, and genuine receipt IDs. Missing, conflicting, stale, oversized, or provider-unresolvable evidence fails closed with a reason and next action. An `INCONCLUSIVE` local/semantic bypass can explain missing evidence but can never become `PASS`.

### 6. Failure taxonomy and retry policy

Use a closed set of reasons: `blocked-capacity`, `blocked-authority`, `blocked-provenance`, `blocked-evidence`, `projection-stale`, `retryable-provider`, `terminal-failed`, and `done`. Retryable provider errors receive at most one immediate retry and one durable delayed retry. A second failure creates or links one actionable BI; it does not loop. Historical failed rows remain audit history and never count as positive evidence.

### 7. Truthful Workroom projection

Project `ready → active → waiting(resource|review|input) → active → ready-for-promotion → terminal`, plus explicit `projection-stale`. A merged PR, terminal TaskRun, release, or runtime verification is a reconciliation event. If an owner projection disagrees with durable records, show the discrepancy and recovery action instead of “working.”

### 8. Surface and UX contract

All adapters (Codex, Build Studio, desktop, scheduled jobs, and portal) call the same MCP primitives. The user-facing status is intentionally small: `Working`, `Waiting`, `Blocked`, `Ready`, `Complete`, with one next action and one blocker reason. Operators can expand the packet to see gate key, lane, owner, exact SHA, receipts, and retry budget. This avoids asking users to infer state from dozens of tool calls.

## Data and scale

Reuse Workroom/TaskRun/lease/activity/evidence fields and QueueTelemetryEvent. Add only typed fields or indexes required for `gateKey`, wait reason, lane, retry budget, and projection revision; do not add a parallel queue table. All reads are bounded by cursor/time window and indexed identity. The initial scale ceiling is thousands of waiting Workrooms with event fan-out; beyond that, partition event consumers and add remote execution/cache under `EP-56AE0F69` rather than reintroducing polling.

## Security and governance

- Server-owned binding, not client-supplied target fields, controls admission.
- Immutable repository/path/version/blob and served SHA are independently verified.
- Approval envelopes are exact, expiring, single-use, and bound to the same TaskRun/tool/arguments.
- Local gate bypass records `INCONCLUSIVE` plus compensating evidence; protected checks remain mandatory.
- Runtime images without Git fail closed with `blocked-provenance` and an explicit provider lookup path.
- Every deduplication, retry, wake, reconciliation, and override is auditable.

## Measurable acceptance criteria

1. Wait-only claim/list/quiescence calls fall by ≥95% in a seven-day pilot.
2. Duplicate semantic-review/exact-tree runs for one gate key are zero.
3. Queued work retains no client heartbeat or heavyweight lease.
4. Event wake p95 is <15 seconds; reconciliation repairs missed events within five minutes.
5. Queue CPU p95 while waiting is <1 second/minute.
6. No Workroom remains without a transition or explicit blocker for >30 minutes.
7. `find_related_tests` and `record_plan_backlog_coverage` either succeed on validated packets or fail once with a typed next action.
8. Completion is impossible without exact objective baseline, plan coverage, delivery, acceptance, and runtime/provenance references.
9. A source-free install never falls back to Git or claims a target it cannot verify.
10. Pilot throughput reaches ≥3 PR/hour without reducing protected-check pass rate or first-pass evidence quality.

## Rollout and rollback

Ship the existing rollout slices in order: `BI-B2E9FC9D` (authoritative lanes), `BI-6A5AB570` (gate coalescing), `BI-MCP-EFF-0285909C` (durable waits), `BI-30EDD4B0` (resource lanes), and `BI-114C1F40` (WIP/liveness). Cross-cutting tool-contract fixes are `BI-MCP-EFF-B5F7D216` and `BI-MCP-EFF-7AFED9F2`; retry-storm remediation is `BI-MCP-EFF-CD5F744B`. Pilot first on docs/affected-code lanes, then exhaustive lanes. Roll back by disabling a lane or event consumer and replaying from durable waiting state; never roll back by deleting evidence or re-running a consumed identity.

## Architecture review summary

Aligned with single-source-of-truth, responsible-capacity, and prospective-trust principles. The main risks are schema/index migration, event delivery gaps, and stale projections; each has a bounded reconciliation path. No new domain entity is required. The only escalated decision is whether future scale needs partitioned event consumers; defer that to measured saturation under `EP-56AE0F69`.
