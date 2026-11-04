---
status: draft
---

# Continual improvement as a standing operation: implementation plan

- **Backlog item:** BI-CE564FBB (epic EP-C00F61F4)
- **Workroom:** WC-E16F92C0
- **Design:** [Workroom-owned harness evolution](../specs/2026-10-28-harness-evolution-loop-design.md), section "Continual improvement as a standing operation" (OBJ-7, OBJ-8, AC-20 – AC-25)
- **Decisions:**
  - WWMD DI-942BE30F1B00: a new cross-cutting CI specialist.
  - WWMD DI-D7C2BBE33693: the registry resolves the improve activity by shape family, so it is not written into each literal.
- **Coordination:** slice 2 (BI-B8DAEB71) owns `apps/web/lib/harness-evolution/`. This plan touches nothing there. Slice 2 swaps its local stub `improvement-criteria.ts` for this plan's module and records the cycle ledger on the TaskRun.

## Phase 1: three stacked PRs

The phase is split so that no PR exceeds the reviewer size limit:

1. operating criteria, with the spec and this plan;
2. improve activity;
3. CI Manager seed, stacked on 2.

The register-shape step in the table below is deferred to BI-F47DD4CF. It waits on BI-90F0863B.

| Step | File | Test |
| --- | --- | --- |
| Operating criteria: typed config, clamp, layer overrides, Define screen, K rule, c-chart control limits, control-check schedule, Pareto ledger | `apps/web/lib/continual-improvement/operating-criteria.ts` | `operating-criteria.test.ts` |
| Improve activity: the standard declaration, its layers and scopes, validation | `apps/web/lib/work-management/improve-activity.ts` | `improve-activity.test.ts` |
| Registry: shape families carry their layer; `getWorkShapeImproveActivity`, `resolveRoomImproveActivity` | `apps/web/lib/work-management/work-shapes.ts` | `improve-activity.test.ts`, `work-shapes.test.ts` |
| CI register standing shape (DMAIC stages; adoption is a governed decision), registered last | `continual-improvement-register-shape.ts`, `standing-operations-shapes.ts` | standing-shape suites, drive golden, shape signature, migration proof |
| CI Manager AGT-908: registry, roster, grants, identity, model floor, persona, profession family | `agent_registry.json`, `workforce-seed.ts`, `coworker-grants.ts`, `agent-identity.ts`, `agent-model-defaults.ts`, `prompts/specialist/continual-improvement-manager.prompt.md`, `docs/professions/registry.json` | `coworker-definition-conformance.test.ts`, `capability-completeness.test.ts` |
| The daily job's owner moves to AGT-908, and existing installs re-point on seed | `packages/db/src/harness-evolution-loop-config.ts` | `seed-harness-evolution-loop.test.ts` |

## Phase 2: on the DEV install, after slice 2 merges

Phase 2 waits for two things: slice 2 (BI-B8DAEB71) merges, and the install upgrades through `request_self_upgrade`. Then:

1. The daily job runs under AGT-908.
2. A ring-0 room passes through one cycle: miss → eligible candidate → probe → verdict → control checks scheduled at 7 and 14 days.
3. The evidence is recorded on BI-CE564FBB.

## Traceability

| Deliverable | Requirement | Verification |
| --- | --- | --- |
| Improve activity on every shape, inherited by rooms | OBJ-7 | AC-20 |
| CI Manager seeded, owns the daily job, authority binding derived | OBJ-7 | AC-21 |
| Typed operating criteria | OBJ-8 | AC-22 |
| Cycle ledger (eligible, skipped with reason, worked) | OBJ-8 | AC-23 |
| Control limits and control-check schedule | OBJ-8 | AC-24 |
| One DMAIC cycle on DEV with no human step | OBJ-7 | AC-25 |

## Backlog coverage

- Decision: decomposed
- Parent: BI-CE564FBB
- Receipt: blocked-by: record_plan_backlog_coverage needs the spec-approval baseline for BI-CE564FBB, which has no independent spec-approval receipt yet (readiness SPEC_APPROVAL_REQUIRED / OBJECTIVE_BASELINE_REQUIRED)
- Dependencies: BI-B8DAEB71 (slice 2 consumes the criteria and records the ledger); BI-90F0863B (unblocks BI-F47DD4CF)
- Mappings:
  - Operating criteria, spec amendment and plan (AC-22, AC-24) -> BI-CE564FBB
  - Improve activity on every shape (AC-20) -> BI-CE564FBB
  - CI Manager seed and job ownership (AC-21) -> BI-CE564FBB
  - Register shape and coordination binding (AC-21) -> BI-F47DD4CF
  - Cycle ledger on the TaskRun (AC-23) -> BI-B8DAEB71
  - One DMAIC cycle on DEV (AC-25) -> BI-CE564FBB
