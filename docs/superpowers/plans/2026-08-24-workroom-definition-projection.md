---
status: active
---

# Workroom Definition Projection Implementation Plan

**Backlog item:** `BI-80BECE1E`  
**Umbrella:** `BI-D4C110BC`  
**Workroom:** `WC-DCE05F54`  
**Branch:** `refactor/workroom-definition-projection`

## Outcome

One existing Workspace Workroom route will distinguish the reusable room definition from the room instance that is doing the work. The same read model will carry both identities. The existing Overview/Details control will become the progressive-disclosure boundary for activity, participants, evidence, receipts, and technical references.

This is one atomic PR. It adds no route, Prisma model, migration, task bus, or parallel Workroom API.

## Design grounding

- Canonical architecture: `docs/architecture/workroom-vocabulary-boundary.md` and `docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md`.
- UX standards: `docs/platform-usability-standards.md` and `docs/superpowers/plans/2026-05-26-portal-ux-simplification-spine.md`.
- Existing substrate: `apps/web/lib/work-management/source-registry.ts`, `room-read-model.ts`, `room-types.ts`, the Workspace Workroom components, and their current tests.
- Source of truth: the source registry owns the reusable definition projection; the Work Case plus current cycle and carrier references own the instance occurrence trace.
- Decision: extend those contracts. Unknown sources remain explicitly unresolved. Development evidence stays optional and does not become part of definition identity.

## UX fit review

- **Decision:** fits-with-guardrails
- **Owning area:** Workspace
- **Route family:** the existing `/workspace/cases/[caseKey]` detail route
- **Primary persona:** a business operator who needs the room's purpose, state, next action, and relationship to its reusable pattern without reading execution internals
- **Navigation layer:** existing local page toggle only
- **Reuse:** refactor `ShapeViewToggle` and `WorkroomShapeSection`; add no navigation or disclosure component family
- **Source truth:** `WorkroomView` built by `buildWorkroomView`
- **Empty/failure behavior:** an unknown source has no fabricated definition identity and retains the existing low-confidence boundary warning
- **AI boundary:** no coworker work starts from this change
- **Guardrails:** Overview remains the default; the header's next action and attention state remain visible; technical identifiers, activity, evidence, participants, and receipts move behind Details
- **Evidence:** pure read-model tests, server-rendered component tests for both disclosure levels, theme/style guards, and the served Workspace route at desktop and narrow viewports

## Implementation

### 1. Drive the contract red

Add failing tests that require:

- every registered Work Case source to declare a positive definition version;
- a registered room to expose definition identity/version and a Work Case-derived occurrence trace;
- an unknown source to leave definition identity unresolved instead of inventing one;
- the default Overview rendering to omit detailed activity, participants, evidence, receipts, and raw source references;
- the explicit Details rendering to reveal those existing records.

Affected tests:

- `apps/web/lib/work-management/source-registry.test.ts`
- `apps/web/lib/work-management/room-read-model.test.ts`
- `apps/web/components/workspace/WorkCaseDetailView.test.tsx`
- related Workroom type/projection tests named by the Workroom impact contract

### 2. Extend the existing projection

- Add `definitionVersion` to each source-registry entry.
- Derive the stable definition id from the source key in one registry helper.
- Add one `identity` object to `WorkroomView`: nullable definition ref plus instance id and occurrence trace.
- Build the occurrence trace from the Work Case, primary source, current cycle, and active execution carrier references.
- Keep the implementation pure and database-free. Do not persist derived ids.

### 3. Make progressive disclosure real

- Lift the existing Overview/Details state to `WorkroomBody`.
- Keep the room header, boundary warning, identity summary, and shape visible in Overview.
- Render cycles, activity, participants, context, decisions, evidence, receipts, and technical references only in Details.
- Keep the existing local preference and token-based styling.
- Expose a controlled content component so both disclosure states are testable without adding another route or fetch contract.

### 4. Reconcile documentation and evidence

- Point the architecture boundary to the implemented source-registry/read-model seam.
- Record a measured UX-fit manifest for the existing Workspace route.
- Run the targeted tests, related tests, prose/style guards, typecheck, preflight, exact-tree integration gate, and served-route verification.

## Backlog coverage

- Decision: atomic
- Parent: `BI-80BECE1E`
- Rationale: Definition versioning, occurrence trace, and progressive disclosure are one consumer contract. Shipping any one without the others either exposes no usable behavior or leaves the existing Workroom surface inconsistent with its read model.
- Receipt: `cmt8evhbb0p4d01mg1ijx4m6x`
- Dependencies: none

Deliverable mapping:

1. `D1-definition-registry` — canonical reusable Workroom definition projection.
   - Backlog item: `BI-80BECE1E`
   - Requirement: `OBJ-WR-001`
   - Verification: `AC-WR-001`
   - Contract: `workroom-source-registry`
   - Flow: `source-registry -> definition lookup -> Workroom read model`
   - Independently shippable: no
2. `D2-occurrence-view` — definition and occurrence trace in the existing Workroom read model.
   - Backlog item: `BI-80BECE1E`
   - Requirement: `OBJ-WR-001`
   - Verification: `AC-WR-002`, `AC-WR-003`
   - Contracts: `WorkCaseDetail`, `WorkroomView`
   - Flow: `WorkCaseDetail -> buildWorkroomView -> WorkroomView`
   - Depends on: `D1-definition-registry`
   - Independently shippable: no
3. `D3-progressive-disclosure` — business-first Overview and disclosed Details on the existing Workroom surface.
   - Backlog item: `BI-80BECE1E`
   - Requirement: `OBJ-WR-001`
   - Verification: `AC-WR-004`
   - Contract: `WorkroomBody`
   - Flow: `WorkroomView -> WorkroomBody -> Overview/Details`
   - Depends on: `D2-occurrence-view`
   - Independently shippable: no
4. `D4-conformance-evidence` — architecture and UX conformance evidence for the consolidated surface.
   - Backlog item: `BI-80BECE1E`
   - Requirement: `OBJ-WR-001`
   - Verification: `AC-WR-005`
   - Contracts: `architecture-conformance`, `ux-fit-manifest`
   - Flow: `implementation -> architecture review -> served UX evidence`
   - Depends on: `D3-progressive-disclosure`
   - Independently shippable: no

## Risks and rollback

- **Type reach:** `WorkroomView` is used by Workspace components and pure shape/posture projections. Run all graph-linked tests and typecheck.
- **Presentation reach:** hiding detail by default could hide the room's primary action. The action and attention state remain in `WorkroomHeader`, and the component test will guard them.
- **Registry drift:** a source without a definition version could silently lose identity. The registry invariant test covers every entry.
- **Overlap:** an unmerged sibling branch adds separate Workroom reporting routes. This PR does not use those routes and remains confined to the canonical Workspace adapter.
- **Rollback:** revert the PR. No stored data, schema, route, or migration requires a compensating operation.

## Completion gate

- Targeted Vitest tests pass from this worktree.
- `pnpm --filter web typecheck` passes.
- `pnpm run check:prose-lint:test` and `pnpm run check:prose-lint` pass.
- `node scripts/check-style-drift.mjs` passes.
- `pnpm run pregate:preflight` passes.
- The exact committed tree passes the governed local-integration gate.
- `/workspace/cases/[caseKey]` is exercised at desktop and narrow widths with Overview first and Details explicit.
- `pnpm pr:health <number>` reports ready before merge queue admission.
