# Workroom executor and invocation attribution

Backlog: BI-1B5BE5F4. Delivery shape: medium. Status: implementation design.

## Design grounding

Extends [the Work Capsule control harness](2026-05-14-portal-work-capsule-control-harness-design.md), sections 6–9. Room creation source and current executor are distinct facts. Reuse Workroom, WorkroomActivity, TaskRun and ScheduledAgentTask; do not introduce a parallel session registry. BI-C41AB195 owns broader session rollup. BI-9FA87F90 owns install permission convergence and is independently delivered.

Verified against source on 2026-10-01: `WorkroomInventory.tsx` displays null executor as Unassigned; `liveness-inventory.ts` omits invocation evidence; the governance and corpus coverage upserts omit executor identity; the workroom drive snapshot omits its selected agent.

## Requirements

- AC1: Every roster row presents executor and an evidenced invocation path. Historical absence is explicitly identified as missing recorded attribution, never invented identity.
- AC2: Governance and corpus maintenance writers record dpf-native and a stable executor reference on both creation and subsequent runs. Existing history may identify these native paths from their recorded activity kind.
- AC3: Scheduled work shows task, target agent and stage when recorded. New dispatch snapshots persist the selected agent. Creation source manual must not overwrite scheduled invocation evidence.
- AC4: Linked TaskRun provenance exposes initiating/current agent, run and parent identifiers. A2A is shown only when supported by recorded run evidence, never inferred merely from scheduling.
- AC5: Regression tests cover external execution, native automation, schedule, A2A, uninvoked drafts, and historical gaps. No confidential payloads are exposed.

## Research & Benchmarking

[OpenTelemetry traces](https://opentelemetry.io/docs/concepts/signals/traces/) model causal relationships using explicit parent links. Adopt that evidence discipline for existing TaskRun relationships; reject adding a tracing service for this display fix.

[Argo Workflows DAGs](https://argo-workflows.readthedocs.io/en/latest/walk-through/dag/) make task dependencies explicit. Adopt identifiable task and stage presentation; reject treating a schedule as proof of inter-agent delegation. Neither benchmark requires a dependency addition.

## Ordered implementation plan

1. Extend the shared inventory projection with narrowly selected provenance fields. Add a pure projection for executor label, invocation summary and evidence identifiers. Do not return raw workspace state or arbitrary A2A payloads. Test evidence precedence and missing-history cases (AC1, AC3, AC4, AC5).
2. Record native executor identity in `concierge-sweep-runner.ts` and `embedding-coverage-workroom.ts`; persist the dispatched agent in `workroom-drive.ts`. Test both initial and repeated writes and dispatch evidence (AC2, AC3, AC5).
3. Render the shared projection in `WorkroomInventory.tsx`, keeping sorting meaningful, using existing theme tokens and report primitives. Update relevant operator documentation (AC1, AC5).
4. Run affected unit tests, web typecheck and source guards. Push DCO-signed commits, complete cloud build and independent review, then use the canonical runtime for UX evidence. Inspect native, external and scheduled rows; verify A2A with a recorded TaskRun fixture. Do not report a live result from a worktree-only test.

## Backlog coverage

One atomic deliverable maps to BI-1B5BE5F4: trustworthy roster attribution. Writers, projection and presentation are ordered implementation phases of the same defect; shipping a label without causal evidence would fail the requested outcome. Live coverage receipt must bind this immutable document before source implementation.

## Risk, convergence and rollback

## Operator-authorized execution exception — 2026-10-01

For this thread's BI-1B5BE5F4 run only, the operator instructed continuation after the explicit request to skip the broken plan-coverage receipt. Scope: `record_plan_backlog_coverage` remains **unrun/not satisfied** following `traceability-incomplete`; no receipt is fabricated. Implementation readiness independently allowed the medium fix (IRD-11F041E61E8F), but coverage requires a persisted scope baseline that its supplied recovery does not produce. The atomic coverage mapping above remains the reviewable plan. This exception does not bypass grant intersection, DCO, PR protection, tests, independent acceptance, runtime verification, or deployment integrity. It expires with this item's delivery and does not change platform policy. Install permission work BI-9FA87F90 is excluded.

No schema change or new dependency. Limit selected activity history and project only known identifiers; avoid per-row unbounded reads. Preserve a recorded executor instead of overwriting it with guesses. Native writers converge existing rows on their next run, while historical display derives only from stored evidence. Installation permission changes remain in BI-9FA87F90. Rollback is a single PR revert; added JSON evidence is backward-compatible and may remain in history.
