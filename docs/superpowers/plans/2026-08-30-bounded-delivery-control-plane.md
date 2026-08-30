# Implementation Plan: Bounded Delivery Control Plane

> You are an excellent senior software engineer who specializes in analyzing existing codebases and implementing robust, well-tested solutions.
>
> - Read `AGENTS.md` fully before starting.
> - Work only in the governed Workroom worktree and preserve one branch/PR per deliverable.
> - Prefer reuse of existing platform primitives over new queues, tables, or parallel state.
> - Never claim a test, gate, receipt, or approval that did not actually run or persist.

Status: proposed  
Umbrella BI: `BI-7C1F43E3`  
Epic: `EP-56AE0F69`  
Workroom: `WC-4C4D810C`  
Design: `docs/superpowers/specs/2026-08-30-bounded-delivery-control-plane-design.md`

## Operating rules

- One independently shippable deliverable maps to one existing BI and one PR.
- Every phase begins with a read-only snapshot of gate key, candidate SHA, plan digest, owner, and current Workroom state.
- Local checks are proportional and may be recorded `INCONCLUSIVE` only when capacity/transport is genuinely unavailable and the reason plus compensating protected evidence is ledgered. DCO, immutable provenance, protected CI/merge, approval, and genuine receipts are never bypassed.
- Waiting is a durable server state. Do not poll leases, quiescence, or backlog rows as a heartbeat.
- A failed historical execution is auditable but contributes no positive evidence.

## Existing source anchors

The implementation is expected to extend these current modules, with exact paths confirmed by `rg` during each phase:

- `apps/web/lib/gates/gate-run-identity.ts`
- `apps/web/lib/nonprod/environment-lease.ts`
- `apps/web/lib/nonprod/durable-wait.ts`
- `apps/web/lib/mcp/packs/nonprod-lease-pack.ts`
- `apps/web/lib/queue/queue-telemetry.ts`
- `apps/web/lib/queue/flow-metrics.ts`
- `apps/web/lib/queue/queue-snapshot-service.ts`
- `apps/web/lib/queue/functions/nonprod-lease-wait.ts`
- `apps/web/lib/queue/functions/taskrun-watchdog.ts`
- `apps/web/lib/queue/functions/quiescence-run.ts`
- `apps/web/lib/mcp/packs/initiative-readiness-pack.ts`
- `scripts/check-plan-backlog-coverage.mjs`
- `packages/db/prisma/schema/work-coordination.prisma`

## Phase 0 — Baseline, contracts, and decomposition

Deliverable: freeze the before/after measurement contract and link each slice to its BI. Capture call counts, retry pairs, wait CPU, event latency, stale projections, duplicate gate executions, PR throughput, and first-pass yield. Define the typed reason set and the evidence-packet JSON contract in the existing Workroom/evidence shape.

Touched files: design/plan docs; `packages/db/prisma/schema/work-coordination.prisma` only if an existing JSON/index field is insufficient.

Dependencies: `BI-7C1F43E3` and existing rollout BIs listed in the design.

Verification: server backlog read; architecture review; schema/index review; no code gate claimed from docs alone.

## Phase 1 — Stable gate identity and coalescing (BI-6A5AB570)

Deliverable: derive one stable gate key from repository, integration tree, evidence-plan digest, toolchain fingerprint, and gate kind. Make lease/task/evidence admission idempotent for that key and return a prior durable run/receipt.

Touched files: `apps/web/lib/gates/gate-run-identity.ts`, lease and gate adapters, matching unit/contract tests, and any required Prisma index migration.

Verification: concurrent identical requests create one run; changed tree/policy/toolchain creates a new key; a valid receipt is reused; mismatched receipt fails closed. Run focused tests, affected tests, typecheck, and protected CI.

## Phase 2 — Durable waits and event wake-up (BI-MCP-EFF-0285909C)

Deliverable: replace client lease polling with durable wait records and event-driven resume. Use existing Inngest/event-bus primitives; keep one bounded reconciliation safety net.

Touched files: `apps/web/lib/nonprod/durable-wait.ts`, `apps/web/lib/queue/functions/nonprod-lease-wait.ts`, `apps/web/lib/queue/inngest-client.ts`, nonprod lease MCP pack, tests.

Verification: queued task disconnects without heartbeat/lease; release/capacity/review event wakes exactly one waiter; missed event is repaired by reconciliation; timeout becomes a typed blocker. Measure wait-only call reduction and wake latency.

## Phase 3 — Evidence lanes and atomic closure packet (BI-B2E9FC9D)

Deliverable: make the planner authoritative before capacity claims and add one closure validator over existing evidence records. Validate exact candidate SHA, integration tree, plan digest, objective baseline, receipt IDs, and runtime provenance.

Touched files: `apps/web/lib/mcp/packs/initiative-readiness-pack.ts`, `scripts/check-plan-backlog-coverage.mjs`, evidence/readiness modules, Workroom packet projection, tests.

Verification: docs/affected/exhaustive lane fixtures; missing/conflicting/oversized/failed-only evidence fails once with an actionable reason; complete packets close; local `INCONCLUSIVE` never becomes `PASS`.

## Phase 4 — Failure taxonomy, retry budgets, and tool contracts (BI-MCP-EFF-CD5F744B, BI-MCP-EFF-B5F7D216, BI-MCP-EFF-7AFED9F2)

Deliverable: centralize typed blocker reasons and bounded retry policy. Repair the high-failure contracts for `record_plan_backlog_coverage` and `find_related_tests`; stop retry storms and preserve failed history as non-evidence.

Touched files: MCP pack handlers/tests, retry policy, queue telemetry, `apps/web/lib/operate/mcp-call-efficiency/*` analysis and tests.

Verification: provider timeout gets one retry plus one durable retry; malformed packet gets no retry; repeated failure links one BI; telemetry counts success/failure/retry/duplicate suppression.

## Phase 5 — Resource lanes and WIP/liveness (BI-30EDD4B0, BI-114C1F40)

Deliverable: enforce lane-specific memory/WIP ceilings and truthful Workroom state, including `waiting`, `ready-to-resume`, `projection-stale`, and terminal. Integrate watchdog and janitor without reaping queued work.

Touched files: `apps/web/lib/queue/quiescence-gates.ts`, `apps/web/lib/queue/functions/taskrun-watchdog.ts`, `apps/web/lib/queue/functions/quiescence-run.ts`, `apps/web/lib/queue/flow-metrics.ts`, `apps/web/lib/work-capsules/liveness-inventory.ts`, tests.

Verification: lane admission refuses over-capacity with one reason; queued work is not reaped; merged/terminal durable records reconcile stale projections; no Workroom lacks a transition or blocker for 30 minutes.

## Phase 6 — Surface adapters and minimal operator UX

Deliverable: make Codex, Build Studio, desktop, scheduled jobs, and portal render the same five statuses and next action from MCP state. Keep packet detail available to operators without exposing credentials or process identity.

Touched files: queue awareness resolver, queue snapshot service, Workroom views, operator metrics, and their tests. If UI changes are material, run the DPF UX-fit review.

Verification: same Workroom has identical status across adapters; stale projection is visible; user can resume from one next action; accessibility and route checks pass.

## Phase 7 — Pilot, migration, and observability

Deliverable: run a seven-day pilot on the existing efficiency BIs and representative docs, affected-code, and exhaustive candidates. Publish before/after telemetry and a rollback decision.

Touched files: flow metrics dashboards, migration/runbook docs, no product-source edits in pilot fixtures.

Verification: ≥95% wait-call reduction, zero duplicate gate executions per key, event wake p95 <15s, reconciliation <5m, queue CPU p95 <1s/minute, throughput target ≥3 PR/hour, and protected-check quality unchanged. If a metric misses target, disable only the affected lane/consumer and resume durable waits.

## Dependency and risk register

| Risk | Mitigation | Rollback |
| --- | --- | --- |
| missed event | bounded reconciliation and durable state | run reconciler; do not poll |
| stale Workroom projection | revisioned projection + `projection-stale` state | rebuild projection from durable records |
| provider outage | one retry, durable wait, typed blocker | resume same identity after health returns |
| schema/index migration | additive field/index, bounded backfill | feature-flag new projection |
| evidence ambiguity | exact SHA/digest/baseline validator | refuse closure; preserve audit rows |
| lane starvation | per-lane WIP and oldest-wait escalation | temporarily lower lane admission |

## Release sequence

Each BI ships through the normal DCO PR and protected merge queue. Canonical release and live verification are required for runtime changes. No live replay or upgrade is part of this design/plan authoring change. The plan coverage receipt must be recorded server-side against this immutable plan blob before implementation begins; if the coverage tool is unavailable, preserve the exact failure and stop rather than infer coverage.

## Current evidence ledger

- Workroom `WC-4C4D810C` is bound to `BI-7C1F43E3`, branch `doc/bounded-delivery-control-plane-design-and-plan`, head `88645e47894001351945ebab36953c64385a7055`.
- `node scripts/check-doc-links.mjs`, `node scripts/gen-doc-index.mjs --check`, and `node scripts/check-docs-impact.mjs` passed.
- `pnpm run check:prose-lint` could not start because this fresh worktree has no installed `tsx` dependency; this is an infrastructure limitation, not a pass.
- `pnpm run pregate:preflight` progressed through the guard loop but stopped on the existing pinned-TypeScript bootstrap failure (`GuardRuntimeEnvironmentError: Pinned repo guard TypeScript 6.0.3 is missing`) and one dependent guard self-test. It was stopped after remaining silent work; this is recorded as `INCONCLUSIVE`, not PASS.
- `record_plan_backlog_coverage` was attempted once with the exact committed plan blob `370fa7e2005dd843e6934cea810e40e64a422d92` and returned `plan-artifact-invalid: Repository provider could not resolve immutable commit provenance after 2 attempts (transport failure)`. No coverage receipt is claimed. Retry only after provider transport is healthy, using this same commit/blob and deliverable mapping.
