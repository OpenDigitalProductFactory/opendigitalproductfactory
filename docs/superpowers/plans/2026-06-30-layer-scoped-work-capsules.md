# Layer-Scoped Work Capsules Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to execute this plan step-by-step.

**Goal:** Add layer, portfolio, persona, activity, and outcome-anchor metadata to Work Capsules so the same coordination plane can track WWMD platform work, WWWD company/business work, and WSID profession/coworker craft work without requiring a platform backlog item.

**Architecture:** Extend the existing `WorkCapsule` spine. Use direct nullable string columns for the queryable dimensions (`decisionScope`, `portfolioRole`, `servedPersona`, `activityKind`) and JSON fields for the flexible anchor/portfolio graph (`outcomeAnchor`, `servesPortfolioRoles`, `dependsOnPortfolioRoles`). Keep the existing backlog/build/git/runtime fields as optional anchors, not required identity. Centralize closed vocabularies and validation in `apps/web/lib/work-capsules.ts`, expose them through MCP schemas, and project them into Work Control/change-lane read models for human-visible context.

**Tech Stack:** Next.js 16, TypeScript, React, Prisma 7, PostgreSQL JSON columns, Vitest, existing DPF MCP tool handlers, existing DPF theme tokens.

---

## Scope

Implement the first product slice of `docs/superpowers/specs/2026-06-29-layer-scoped-work-capsules-design.md`.

In scope:
- Persist typed Work Capsule scope metadata.
- Accept and validate scope metadata through `create_work_capsule` and `adopt_worktree`.
- Return scope metadata through `list_work_capsules`, `get_work_capsule`, Work Control, and contributor change-lane read models.
- Improve Work Control UI so the user sees the outcome/layer/portfolio context before relying on the internal `WC-*` identifier.
- Add tests and migration evidence.

Out of scope for this slice:
- Creating a full business Work Case domain model.
- Replacing backlog/epic planning.
- Automatic AI inference of layer/portfolio from arbitrary prose.
- A new Work Capsule detail page.

## Design Decisions

1. Use direct columns for the primary classification fields:
   - `decisionScope`: `wwmd`, `wwwd`, `wsid`
   - `portfolioRole`: `foundational`, `manufactureAndDeliver`, `forEmployees`, `productsAndServicesSold`
   - `servedPersona`: string slug/label, nullable for backward compatibility
   - `activityKind`: `delivery`, `support`, `improvement`, `governance`, `launch-readiness`, `craft-judgment`, `lifecycle`, `remediation`

2. Use JSON for flexible relationships:
   - `outcomeAnchor`: object with `{ kind, id?, label?, url?, source? }`
   - `servesPortfolioRoles`: JSON array of portfolio roles
   - `dependsOnPortfolioRoles`: JSON array of portfolio roles

3. Preserve backlog optionality:
   - `backlogItemId` and `epicId` remain platform-delivery anchors.
   - A Work Capsule can be valid with no backlog item when it represents a company activity, employee-facing AI coworker activity, customer delivery activity, or WSID craft activity.

4. UI text is outcome-first:
   - The table primary text remains the activity title.
   - The `WC-*` ID remains secondary debug/recovery context.
   - Layer/portfolio/persona badges provide scan context without turning the table into a dense taxonomy wall.

## Work Items

### 1. Add Failing Tests For Scope Vocabularies

- [ ] Update `apps/web/lib/work-capsules.test.ts`.
  - Assert each new enum has the expected values.
  - Assert validators accept valid values and reject unknown strings.
  - Assert `normalizeWorkCapsuleScopeInput(undefined)` returns empty nullable/default values.
  - Assert `normalizeWorkCapsuleScopeInput(...)` trims `servedPersona`, validates arrays, and normalizes `outcomeAnchor`.

Expected new API:

```ts
export const WORK_CAPSULE_DECISION_SCOPES = ["wwmd", "wwwd", "wsid"] as const;
export const WORK_CAPSULE_PORTFOLIO_ROLES = [
  "foundational",
  "manufactureAndDeliver",
  "forEmployees",
  "productsAndServicesSold",
] as const;
export const WORK_CAPSULE_SCOPE_ACTIVITY_KINDS = [
  "delivery",
  "support",
  "improvement",
  "governance",
  "launch-readiness",
  "craft-judgment",
  "lifecycle",
  "remediation",
] as const;
```

Run:

```powershell
pnpm --filter web exec vitest run lib/work-capsules.test.ts
```

Commit checkpoint:

```powershell
git add apps/web/lib/work-capsules.test.ts
git commit -s -m "test: cover work capsule scope vocabularies"
```

### 2. Implement Shared Scope Types And Normalization

- [ ] Update `apps/web/lib/work-capsules.ts`.
  - Add closed vocabulary constants and type aliases.
  - Add `WorkCapsuleOutcomeAnchor` type.
  - Add `WorkCapsuleScopeInput` and `NormalizedWorkCapsuleScope`.
  - Add validator functions:
    - `isWorkCapsuleDecisionScope`
    - `isWorkCapsulePortfolioRole`
    - `isWorkCapsuleScopeActivityKind`
    - `isWorkCapsuleOutcomeAnchorKind`
  - Add `normalizeWorkCapsuleScopeInput(input)`.

Implementation shape:

```ts
export type WorkCapsuleOutcomeAnchor = {
  kind: WorkCapsuleOutcomeAnchorKind;
  id?: string;
  label?: string;
  url?: string;
  source?: string;
};

export type NormalizedWorkCapsuleScope = {
  decisionScope: WorkCapsuleDecisionScope | null;
  portfolioRole: WorkCapsulePortfolioRole | null;
  servedPersona: string | null;
  activityKind: WorkCapsuleScopeActivityKind | null;
  outcomeAnchor: WorkCapsuleOutcomeAnchor | null;
  servesPortfolioRoles: WorkCapsulePortfolioRole[];
  dependsOnPortfolioRoles: WorkCapsulePortfolioRole[];
};
```

- [ ] Keep `servedPersona` as a bounded string for this slice. Do not create a persona registry yet.
- [ ] Keep `outcomeAnchor.url` only if it is a non-empty string. Do not validate external URLs in this slice.

Run:

```powershell
pnpm --filter web exec vitest run lib/work-capsules.test.ts
```

Commit checkpoint:

```powershell
git add apps/web/lib/work-capsules.ts apps/web/lib/work-capsules.test.ts
git commit -s -m "feat: add work capsule scope vocabulary"
```

### 3. Add The Prisma Migration

- [ ] Update `packages/db/prisma/schema.prisma` in `model WorkCapsule`.

Add fields near existing work identity fields:

```prisma
  decisionScope           String?
  portfolioRole           String?
  servedPersona           String?
  activityKind            String?
  outcomeAnchor           Json                  @default("{}")
  servesPortfolioRoles    Json                  @default("[]")
  dependsOnPortfolioRoles Json                  @default("[]")
```

Add indexes:

```prisma
  @@index([decisionScope])
  @@index([portfolioRole])
  @@index([activityKind])
```

- [ ] Create migration:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --name add_work_capsule_scope
```

- [ ] Inspect generated SQL. It should add nullable text columns, JSONB defaults, and indexes only. It must not rewrite existing rows.

Run:

```powershell
pnpm --filter @dpf/db exec prisma validate
```

Commit checkpoint:

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -s -m "feat: persist work capsule scope metadata"
```

### 4. Wire Scope Through The Store

- [ ] Update `apps/web/lib/work-capsules/work-capsule-store.ts`.
  - Extend `CapsuleCreateInput` and `CapsuleAdoptionInput` with optional `scope?: WorkCapsuleScopeInput`.
  - Call `normalizeWorkCapsuleScopeInput(args.input.scope)`.
  - Persist normalized fields in both `createWorkCapsule` and `adoptWorktreeCapsule`.
  - If idempotent create/adopt returns an existing capsule, do not overwrite its scope in this slice.

Expected create data shape:

```ts
const scope = normalizeWorkCapsuleScopeInput(args.input.scope);

data: {
  // existing fields...
  decisionScope: scope.decisionScope,
  portfolioRole: scope.portfolioRole,
  servedPersona: scope.servedPersona,
  activityKind: scope.activityKind,
  outcomeAnchor: scope.outcomeAnchor ?? {},
  servesPortfolioRoles: scope.servesPortfolioRoles,
  dependsOnPortfolioRoles: scope.dependsOnPortfolioRoles,
}
```

- [ ] Update `apps/web/lib/work-capsules/work-capsule-store.test.ts`.
  - Add create test proving scoped fields are persisted.
  - Add adopt test proving scoped fields are persisted.
  - Add invalid scope test proving validation errors are raised before DB writes.
  - Add backlog-free create test proving no backlog item is required when scope is WWWD/WSID.

Run:

```powershell
pnpm --filter web exec vitest run lib/work-capsules/work-capsule-store.test.ts lib/work-capsules.test.ts
```

Commit checkpoint:

```powershell
git add apps/web/lib/work-capsules.ts apps/web/lib/work-capsules/work-capsule-store.ts apps/web/lib/work-capsules/work-capsule-store.test.ts
git commit -s -m "feat: wire scope through work capsule store"
```

### 5. Expose Scope Through MCP Tools

- [ ] Update `apps/web/lib/work-capsules/mcp-handlers.ts`.
  - Include new enums in `workCapsuleToolEnums()`.
  - Add a `parseScopeInput(params)` helper using `normalizeWorkCapsuleScopeInput`.
  - Pass parsed scope into `createWorkCapsule` and `adoptWorktreeCapsule`.
  - Include scope fields in `listWorkCapsulesTool` select.
  - Keep `getWorkCapsuleTool` include behavior; Prisma full row will include fields after migration.
  - Return `invalid_scope` errors with enum choices when validation fails.

- [ ] Update `apps/web/lib/mcp-tools.ts`.
  - Add optional input schema fields to `create_work_capsule`.
  - Add optional input schema fields to `adopt_worktree`.
  - Add optional filters to `list_work_capsules` for `decisionScope` and `portfolioRole`.
  - Keep tool descriptions provenance-free.

Input schema shape:

```ts
decisionScope: { type: "string", enum: workCapsuleEnums.decisionScopes },
portfolioRole: { type: "string", enum: workCapsuleEnums.portfolioRoles },
servedPersona: { type: "string" },
activityKind: { type: "string", enum: workCapsuleEnums.scopeActivityKinds },
outcomeAnchor: {
  type: "object",
  additionalProperties: true,
  properties: {
    kind: { type: "string", enum: workCapsuleEnums.outcomeAnchorKinds },
    id: { type: "string" },
    label: { type: "string" },
    url: { type: "string" },
    source: { type: "string" },
  },
},
servesPortfolioRoles: {
  type: "array",
  items: { type: "string", enum: workCapsuleEnums.portfolioRoles },
},
dependsOnPortfolioRoles: {
  type: "array",
  items: { type: "string", enum: workCapsuleEnums.portfolioRoles },
},
```

- [ ] Update `apps/web/lib/mcp-tools-work-capsules.test.ts`.
  - `create_work_capsule` accepts WWWD customer-delivery scope with no backlog item.
  - `adopt_worktree` accepts WWMD/platform scope.
  - invalid `portfolioRole` returns `invalid_scope`.
  - `list_work_capsules` can filter by `decisionScope` and `portfolioRole`.

- [ ] Update `apps/web/lib/work-capsules-enum-parity.test.ts` so MCP enum schemas match source constants.

Run:

```powershell
pnpm --filter web exec vitest run lib/mcp-tools-work-capsules.test.ts lib/work-capsules-enum-parity.test.ts lib/work-capsules/work-capsule-store.test.ts lib/work-capsules.test.ts
```

Commit checkpoint:

```powershell
git add apps/web/lib/mcp-tools.ts apps/web/lib/work-capsules/mcp-handlers.ts apps/web/lib/mcp-tools-work-capsules.test.ts apps/web/lib/work-capsules-enum-parity.test.ts
git commit -s -m "feat: expose work capsule scope through mcp"
```

### 6. Project Scope Into Work Control

- [ ] Update `apps/web/lib/work-capsules/work-capsule-presenter.ts`.
  - Extend `CapsuleRowInput` with the new scope fields.
  - Return a compact `scope` object or `scopeLabel` fields for the table.
  - Prefer readable labels:
    - `wwmd` -> `WWMD`
    - `wwwd` -> `WWWD`
    - `wsid` -> `WSID`
    - `manufactureAndDeliver` -> `Manufacture & Deliver`
    - `forEmployees` -> `For Employees`

- [ ] Update the page/action that loads Work Control rows if needed:
  - Inspect `apps/web/app/(shell)/build/work-control/page.tsx` or the current route that calls `presentCapsuleRow`.
  - Add selected fields to the Prisma query.

- [ ] Update `apps/web/components/build/work-control/WorkCapsuleTable.tsx`.
  - Add a `Context` column only if it fits cleanly on desktop.
  - On narrow screens, keep horizontal table scroll rather than cramming text.
  - Render layer and portfolio as subdued badges using existing DPF variables:
    - `border-[var(--dpf-border)]`
    - `bg-[var(--dpf-surface-2)]`
    - `text-[var(--dpf-muted)]`
  - Keep card radius at `rounded-md`.
  - Do not add explanatory in-app text.

Example row layout:

```tsx
<div className="font-medium text-[var(--dpf-text)]">{capsule.title}</div>
<div className="mt-1 flex flex-wrap gap-1">
  {capsule.scope.decisionScopeLabel ? <ScopeBadge>{capsule.scope.decisionScopeLabel}</ScopeBadge> : null}
  {capsule.scope.portfolioRoleLabel ? <ScopeBadge>{capsule.scope.portfolioRoleLabel}</ScopeBadge> : null}
  {capsule.scope.servedPersona ? <ScopeBadge>{capsule.scope.servedPersona}</ScopeBadge> : null}
</div>
<div className="mt-1 font-mono text-xs text-[var(--dpf-muted)]">{capsule.capsuleId}</div>
```

- [ ] Update `apps/web/components/build/work-control/WorkControlPanel.test.tsx` or `WorkCapsuleTable` tests.
  - Assert scoped badges render.
  - Assert internal ID remains secondary text.
  - Assert unscoped capsules still render.

Run:

```powershell
pnpm --filter web exec vitest run components/build/work-control/WorkControlPanel.test.tsx lib/work-capsules/work-capsule-presenter.test.ts
```

Commit checkpoint:

```powershell
git add apps/web/lib/work-capsules/work-capsule-presenter.ts apps/web/lib/work-capsules/work-capsule-presenter.test.ts apps/web/components/build/work-control/WorkCapsuleTable.tsx apps/web/components/build/work-control/WorkControlPanel.test.tsx
git commit -s -m "feat: show work capsule scope in work control"
```

### 7. Project Scope Into Contributor Change Lanes

- [ ] Update `apps/web/lib/contributor-change-lanes/types.ts`.
  - Add scope fields to `WorkCapsuleSnapshot`.
  - Add optional `decisionScope`, `portfolioRole`, `servedPersona`, `activityKind`, and `outcomeAnchorLabel` to `ContributorChangeLane` if the UI needs them.

- [ ] Update `apps/web/lib/contributor-change-lanes/read-model.ts`.
  - Add explicit `select` for `readWorkCapsules` instead of full row read, including new scope fields.
  - Update `toWorkCapsuleSnapshot` mapping.

- [ ] Update `apps/web/lib/contributor-change-lanes/lane-projection.ts`.
  - Carry scope fields from capsule lanes into projected lanes.
  - Do not alter lane status logic.

- [ ] Update UI if it currently renders lane purpose:
  - `apps/web/components/platform/development/change-lanes/ChangeLaneTable.tsx`
  - `apps/web/components/platform/development/change-lanes/ChangeLaneSourceSummary.tsx`
  - Keep a compact label; no marketing copy or help text.

- [ ] Update tests:
  - `apps/web/lib/contributor-change-lanes/read-model.test.ts`
  - `apps/web/lib/contributor-change-lanes/lane-projection.test.ts`
  - `apps/web/components/platform/development/change-lanes/ChangeLanesDashboard.test.tsx` if UI text changes.

Run:

```powershell
pnpm --filter web exec vitest run lib/contributor-change-lanes/read-model.test.ts lib/contributor-change-lanes/lane-projection.test.ts components/platform/development/change-lanes/ChangeLanesDashboard.test.tsx
```

Commit checkpoint:

```powershell
git add apps/web/lib/contributor-change-lanes apps/web/components/platform/development/change-lanes
git commit -s -m "feat: project work capsule scope into change lanes"
```

### 8. Documentation And Evidence

- [ ] Update `docs/superpowers/specs/2026-06-29-layer-scoped-work-capsules-design.md`.
  - Move selected open questions to decisions:
    - Direct columns for queryable fields.
    - JSON flexible outcome anchor.
    - Backlog remains optional.
  - Add implementation notes and link this plan.

- [ ] Record execution evidence on `WC-68DB68F8` after each verification batch:
  - Targeted tests.
  - Prisma validation/migration application.
  - Typecheck/build.
  - UX verification.

Commit checkpoint:

```powershell
git add docs/superpowers/specs/2026-06-29-layer-scoped-work-capsules-design.md docs/superpowers/plans/2026-06-30-layer-scoped-work-capsules.md
git commit -s -m "docs: plan layer scoped work capsule implementation"
```

### 9. Final Verification

Run source-local gates:

```powershell
pnpm --filter web exec vitest run lib/work-capsules.test.ts lib/work-capsules/work-capsule-store.test.ts lib/mcp-tools-work-capsules.test.ts lib/work-capsules-enum-parity.test.ts lib/contributor-change-lanes/read-model.test.ts lib/contributor-change-lanes/lane-projection.test.ts components/build/work-control/WorkControlPanel.test.tsx
pnpm --filter web typecheck
pnpm --filter @dpf/db exec prisma validate
```

Run runtime-bound gates through the governed local install or shared local-CI convergence sandbox:

```powershell
pnpm --filter web build
```

UX verification path:
- Open Work Control.
- Create or adopt a capsule with `decisionScope=wwwd`, `portfolioRole=productsAndServicesSold`, `servedPersona=customer`, and an `outcomeAnchor.kind=work-case`.
- Confirm the table shows the title first, then WWWD/portfolio/persona context, then the `WC-*` ID as secondary text.
- Open Contributor Change Lanes.
- Confirm the capsule lane carries the same context without changing lane status semantics.

Migration verification:

```powershell
pnpm --filter @dpf/db exec prisma migrate status
```

Final branch steps:

```powershell
git status --short
git push
```

Do not open a PR until all gates pass and UX evidence is recorded.

## Acceptance Criteria

- [ ] Work Capsules can be created without a backlog item.
- [ ] Work Capsules can declare WWMD/WWWD/WSID scope.
- [ ] Work Capsules can declare one primary portfolio role and M&D recursive relationships through `servesPortfolioRoles` and `dependsOnPortfolioRoles`.
- [ ] AI coworker activity can be represented as `portfolioRole=forEmployees` with a Digital Product or coworker outcome anchor.
- [ ] Customer/company work can be represented as `portfolioRole=productsAndServicesSold` with a Work Case or external outcome anchor.
- [ ] MCP schemas expose the new closed vocabularies and reject invalid values.
- [ ] Work Control shows human activity/outcome context before the internal capsule ID.
- [ ] Change-lane projections preserve scope context without changing status behavior.
- [ ] Migration applies cleanly and does not backfill or rewrite existing capsules.
- [ ] Targeted tests, typecheck, build, and UX verification evidence are recorded.

## Refactoring Budget

Reserve roughly 20 percent of implementation effort for cleanup discovered while executing:
- Prefer a small `ScopeBadge` helper if the Work Control table starts duplicating badge markup.
- Prefer a shared label map in `apps/web/lib/work-capsules.ts` if labels are needed in more than one presenter.
- Replace any ad hoc MCP parameter parsing for new scope fields with a single `parseScopeInput` helper.
- Keep refactors bounded to Work Capsule scope handling; do not widen into backlog, Work Case, or general portfolio modeling.
