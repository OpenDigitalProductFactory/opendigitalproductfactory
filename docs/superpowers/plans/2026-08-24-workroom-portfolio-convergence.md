---
status: active
---

# Workroom portfolio convergence implementation plan

Backlog item: `BI-3023912F`  
Workroom: `WC-261E0B3D`  
Branch: `refactor/workroom-portfolio-convergence`

## Outcome

Give reusable Workroom definitions and running Workrooms distinct, memorable homes without creating a second source of truth:

- Enterprise Architecture owns definition-time coordination: portfolio, value stream, team pattern, roles, queues, human gates, and linked EA views.
- Operations owns live and historical Workroom instances and their truthful liveness.
- Build Studio shows only development-scoped Workrooms and points to the canonical Operations inventory.

The implementation extends `ValueStreamTeam`, `WorkItem`, `Workroom`, and `WorkroomActivity`; it does not add a `WorkroomDefinition` model.

## Research and benchmarking

- [Camunda Web Modeler and Operate](https://docs.camunda.io/docs/components/modeler/web-modeler/run-or-publish-your-process/) separate a process definition from its running instances and link a newly started instance into the operational monitor. DPF adopts the definition-to-instance drill-through and rejects a second deployment/runtime state store.
- [GitHub Actions workflows](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows) define triggers, jobs, and steps separately from workflow runs. [Run history](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/monitoring-workflows/viewing-workflow-run-history) is filtered by definition and drills into status/log detail. DPF adopts bounded definition/run history and keeps Workroom activity as the one runtime ledger.
- DPF's own `WorkroomShape`, participant, cycle, posture, and activity components already provide the detail renderer. This plan reuses them through `/workspace/cases/[caseKey]` rather than drawing a second detail UI.

## UX fit decision

- Decision: fits with guardrails
- Owning areas: Architecture for definitions; Operations for instances
- Primary personas: founder/operator and enterprise architect
- Navigation: one section tab in EA and one section tab in Operations; no new global rail item
- Source truth: `ValueStreamTeam` definition graph and `Workroom` liveness/activity graph
- Empty/failure behavior: every portfolio stays visible; missing definitions explain the gap; no Workrooms is an honest empty state; stale rooms are history/cleanup, not active
- AI boundary: read-only navigation; no click starts coworker work
- Reuse: `EaTabNav`, `OpsTabNav`, report-kit KPI/status/table/empty primitives, and existing Workroom detail route

## Impact contract

The initial Workroom scope contract is unresolved because two directory claims do not identify exact files. The plan therefore uses exhaustive affected-route verification and narrows the claims before implementation. Required test families are:

- `apps/web/lib/actions/work-capsules.test.ts`
- `apps/web/components/build/work-control/WorkControlPanel.test.tsx`
- `apps/web/lib/work-capsules/liveness-inventory.test.ts`
- new EA Workroom architecture projection tests
- new Operations Workroom inventory component/page tests
- EA and Operations navigation tests
- UX route budget/theme checks for `/ea/workrooms`, `/ops/workrooms`, and `/build/work`

## Phase 1 — converge the Workroom inventory read model

Deliverable: one bounded liveness inventory shared by MCP, Operations, and Build Studio.

Files:

- `apps/web/lib/work-capsules/liveness-inventory.ts`
- `apps/web/lib/actions/work-capsules.ts`
- their existing tests

Steps:

1. Add failing tests that require summary counts, true-live filtering, history classification, and development-scope filtering.
2. Extend the existing inventory loader only where the UI projection needs additional canonical fields.
3. Refactor `getWorkControlData` to consume the shared inventory instead of duplicating the Workroom/FeatureBuild liveness join.

Verification: targeted Vitest suites prove 74 stored rows cannot render as 74 active when only 2 carry live evidence.

## Phase 2 — make Operations the instance home

Deliverable: `/ops/workrooms` with live and historical Workrooms, portfolio context, honest cleanup states, and detail links.

Files:

- `apps/web/app/(shell)/ops/workrooms/page.tsx`
- `apps/web/components/ops/workrooms/*`
- `apps/web/components/ops/ops-nav.ts`

Steps:

1. Add failing component/navigation tests for the new route, live/history split, portfolio labels, empty states, and `/workspace/cases/<WC-id>` drill-through.
2. Build the page from report-kit primitives with bounded client-side paging over the bounded server result.
3. Keep stale, blocked, terminal, abandoned, and archived records visible in history without calling them active.

Verification: component tests plus browser exercise of populated, empty, and stale-only fixtures.

## Phase 3 — expose definition-time Workroom architecture

Deliverable: `/ea/workrooms`, grouped by the four canonical portfolio roles.

Files:

- `apps/web/lib/ea/workroom-architecture.ts`
- `apps/web/app/(shell)/ea/workrooms/page.tsx`
- `apps/web/components/ea/ea-nav.ts`

Steps:

1. Add failing projection tests for portfolio grouping, team patterns, participant roles, queues, HITL triggers, EA links, and associated instance counts.
2. Load a bounded `ValueStreamTeam` definition graph and join Workroom counts through `WorkItem.teamId` without denormalizing the schema.
3. Render four portfolio bands with an accessible definition card/list. Link EA process/view where present and link to filtered Operations instances.

Verification: projection and page tests cover complete, partially defined, and empty portfolios.

## Phase 4 — narrow Build Studio to development context

Deliverable: truthful Build Studio metrics and a clear link to the canonical Workroom inventory.

Files:

- `apps/web/components/build/work-control/WorkControlPanel.tsx`
- `apps/web/components/build/work-control/WorkCapsuleTable.tsx`
- their tests

Steps:

1. Add failing tests proving the visible count uses live development Workrooms rather than stored row count.
2. Relabel the surface as development Workrooms and show stale/history counts as secondary context, not active work.
3. Link to `/ops/workrooms` and `/ea/workrooms`; retain the existing governed worktree/adoption tools.

Verification: existing Work Control tests plus the new liveness/IA assertions.

## Phase 5 — refactor, documentation, and functional evidence

Deliverable: shared labels/projections, measured UX-fit evidence, and a clean branch.

Steps:

1. Remove duplicated portfolio/liveness label maps uncovered by the change and keep one presentation contract.
2. Add the measured `docs/ux-fit/2026-08-24-workroom-portfolio-convergence.ux-fit.json` manifest covering every UI file.
3. Run targeted tests, web typecheck, lint/theme/UX scans, and the governed browser exercise in the shared nonproduction environment.
4. Run blast-radius review, semantic review, pregate, DCO, push, and PR readiness.

Verification: local tests/typecheck plus governed runtime evidence for desktop and narrow viewports; production build remains the cloud merge-queue gate unless local policy explicitly requires it.

## Delivery boundary

Decision: atomic. The phases are internal sequencing, not independent product slices. Shipping an Operations inventory without the shared liveness refactor preserves the false-active defect; shipping Architecture without instance traversal creates a stranded definition surface; narrowing Build Studio before the canonical Operations home exists removes visibility. They must land together so there is one coherent definition → instance → activity mental model.

## Risks and rollback

- **Query scale:** bound definition and instance reads and expose explicit truncation/next-action copy. Roll back the routes if the join cannot stay bounded; do not silently cap.
- **Permission mismatch:** `/ea/workrooms` inherits `view_ea_modeler`; `/ops/workrooms` inherits `view_operations`. Tests must prove no broader access.
- **Stale-room interpretation:** reuse `classifyWorkCapsuleLiveness`; never derive liveness from status or `updatedAt`.
- **Navigation crowding:** only section navigation changes; the global rail stays unchanged.
- **Rollback:** the PR is additive except the Build Work Control read-model refactor. Reverting the PR restores the previous routes and behavior without a migration.

## Backlog coverage

Coverage recorder result: blocked at provider provenance. The signed plan commit
`3bd5230770ffb88558554be9826fc5c2e87c7a28` and blob
`1ef3983d4aaa82c2651e8a19fc09254de41f68f8` both resolve from GitHub, and
Workroom `WC-261E0B3D` records the same repository, branch, and head. The live
`record_plan_backlog_coverage` call nevertheless returned
`plan-artifact-invalid` / "Repository provider could not resolve immutable
commit provenance." No receipt is claimed. The governed
`check_branch_plan_backlog_gate` then confirmed that this `large` BI does not
require an xlarge decomposition/atomic coverage decision before source work.

Decision: atomic; all phases map to `BI-3023912F`.
