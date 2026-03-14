# EA Reference Value Stream Projection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable EA workflow that projects normalized reference-model value streams into a visual EA view and lets the user load or refresh that view from the reference-model page.

**Architecture:** Keep the implementation deterministic and narrowly scoped. Add a database-backed projection service in `packages/db` that reads `EaReferenceModelElement`, upserts EA elements, relationships, and view elements with stable projection metadata, and returns the target view. Then add a thin server action and UI affordance in `/ea/models/[slug]` to trigger the projection and navigate to the resulting EA view. Reuse the existing structured value-stream renderer instead of inventing another visual path.

**Tech Stack:** Prisma/PostgreSQL, TypeScript, Next.js App Router, React Server Components, Vitest, pnpm

---

## File Structure

### Projection service

- Create: `packages/db/src/reference-model-projection.ts`
  - Deterministic projection service and helper queries.
- Create: `packages/db/src/reference-model-projection.test.ts`
  - Service-level tests for projection creation, refresh, and failure cases.
- Modify: `packages/db/src/index.ts`
  - Export the projection service from a runtime-safe path only if needed by the app.

### Web action and read-model layer

- Modify: `apps/web/lib/actions/ea.ts`
  - Add a server action to load or refresh the value-stream projection.
- Modify: `apps/web/lib/actions/ea.test.ts`
  - Add tests for the new projection action.
- Modify: `apps/web/lib/ea-data.ts`
  - Surface projection state for a reference model detail page.
- Modify: `apps/web/lib/reference-model-types.ts`
  - Add projection summary fields to `ReferenceModelDetail`.
- Create: `apps/web/lib/reference-model-projection.test.ts`
  - Read-model tests for projection status lookup if keeping that logic out of existing test files improves clarity.

### EA reference-model UI

- Create: `apps/web/components/ea/ReferenceProjectionActions.tsx`
  - Button/form surface for `Load value stream view` and `Refresh value stream view`.
- Modify: `apps/web/app/(shell)/ea/models/[slug]/page.tsx`
  - Display projection status and render the projection action component.
- Create: `apps/web/components/ea/ReferenceProjectionActions.test.tsx`
  - Rendering tests for the action component.

### Docs

- Modify: `docs/superpowers/specs/2026-03-14-ea-reference-value-stream-projection-design.md`
  - Update implementation notes and status after code lands.

### Constraints

- Do not edit the root workspace directly. Execute this plan in `d:\OpenDigitalProductFactory\.worktrees\feature-ea-reference-value-stream-projection`.
- Do not reintroduce seed exports into `packages/db/src/index.ts`.
- Prefer projection metadata in existing EA records before adding schema.

---

## Chunk 1: Projection Service Foundation

### Task 1: Add failing tests for value-stream projection creation

**Files:**
- Create: `packages/db/src/reference-model-projection.test.ts`
- Test: `packages/db/src/reference-model-projection.test.ts`

- [ ] **Step 1: Write the failing projection test for initial creation**

Cover this scenario:
- reference model exists
- one value stream with ordered stages exists in `EaReferenceModelElement`
- no EA projection exists yet
- service creates one EA view, top-level value stream view element, and nested ordered stage view elements

Target shape:

```ts
it("projects reference-model value streams into a structured EA view", async () => {
  const result = await projectReferenceModel({
    referenceModelSlug: "it4it_v3_0_1",
    projectionType: "value_stream_view",
  });

  expect(result.viewId).toBeTruthy();
  expect(result.createdView).toBe(true);
  expect(result.createdViewElements).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `pnpm --filter @dpf/db test -- src/reference-model-projection.test.ts`

Expected: FAIL because the projection service does not exist yet.

- [ ] **Step 3: Add the minimal projection service skeleton**

Create `packages/db/src/reference-model-projection.ts` with:

```ts
export type ReferenceProjectionType = "value_stream_view";

export async function projectReferenceModel(input: {
  referenceModelSlug: string;
  projectionType: ReferenceProjectionType;
}) {
  throw new Error("Not implemented");
}
```

- [ ] **Step 4: Re-run the targeted test to verify the failure is now about missing behavior, not missing files**

Run: `pnpm --filter @dpf/db test -- src/reference-model-projection.test.ts`

Expected: FAIL with the service stubbed but not implemented.

- [ ] **Step 5: Implement the minimal happy-path projection**

Implementation rules:
- resolve the reference model by slug
- support only `value_stream_view`
- query `EaReferenceModelElement` for `kind in ("value_stream", "value_stream_stage")`
- resolve parent-child stage membership from `parentId`
- resolve `archimate4` notation and the `Business Architecture` viewpoint
- create or find one `EaView` with a stable identity:
  - `scopeType = "reference_model_projection"`
  - `scopeRef = "<referenceModelSlug>:value_stream_view"`
- attach stable projection metadata in:
  - `EaView.description` or `EaView.scopeRef`
  - `EaElement.properties.projection`

- [ ] **Step 6: Re-run the targeted test**

Run: `pnpm --filter @dpf/db test -- src/reference-model-projection.test.ts`

Expected: PASS for the happy path.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/reference-model-projection.ts packages/db/src/reference-model-projection.test.ts
git commit -m "feat: add reference model value stream projection service"
```

### Task 2: Add failing tests for refresh and idempotency

**Files:**
- Modify: `packages/db/src/reference-model-projection.test.ts`
- Test: `packages/db/src/reference-model-projection.test.ts`

- [ ] **Step 1: Write the failing idempotency tests**

Add tests covering:
- re-running the projection reuses the same view
- projected EA elements are updated, not duplicated
- projected view elements are updated, not duplicated

Examples:

```ts
it("refreshes an existing projection without duplicating the view", async () => {
  const first = await projectReferenceModel({ referenceModelSlug: "it4it_v3_0_1", projectionType: "value_stream_view" });
  const second = await projectReferenceModel({ referenceModelSlug: "it4it_v3_0_1", projectionType: "value_stream_view" });

  expect(second.viewId).toBe(first.viewId);
  expect(second.createdView).toBe(false);
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `pnpm --filter @dpf/db test -- src/reference-model-projection.test.ts`

Expected: FAIL because duplicates are created or refresh metadata is missing.

- [ ] **Step 3: Implement stable identity resolution**

Use deterministic lookup rules:
- view identity from `scopeType + scopeRef`
- EA element identity from JSON metadata under `properties.projection`
- stage membership from `EaViewElement.parentViewElementId`
- stage order from `EaViewElement.orderIndex`

Implementation notes:
- prefer `findFirst` with JSON-path filters against `EaElement.properties`
- if JSON-path lookup proves too awkward in Prisma, use a compact fallback key in `EaElement.name` only as a last resort, and document it in the spec

- [ ] **Step 4: Ensure implied relationships are synchronized**

For sibling stages under a value stream:
- create or refresh explicit stage-to-stage sequence relationships if the structured EA model expects them
- keep them hidden in the rendered projection

- [ ] **Step 5: Re-run the targeted test**

Run: `pnpm --filter @dpf/db test -- src/reference-model-projection.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/reference-model-projection.ts packages/db/src/reference-model-projection.test.ts
git commit -m "feat: make reference model projection idempotent"
```

### Task 3: Add failing tests for operator-friendly failure cases

**Files:**
- Modify: `packages/db/src/reference-model-projection.test.ts`
- Test: `packages/db/src/reference-model-projection.test.ts`

- [ ] **Step 1: Write failing tests for missing model and missing value streams**

Cover:
- unknown reference model slug
- valid model with no `value_stream` elements

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `pnpm --filter @dpf/db test -- src/reference-model-projection.test.ts`

Expected: FAIL because the service returns generic or unhelpful errors.

- [ ] **Step 3: Implement explicit service errors**

Return or throw clear errors such as:
- `Reference model not found`
- `Reference model has no value streams to project`

If stage structure is incomplete but still renderable:
- project the valid subset
- add or refresh `EaConformanceIssue` warnings instead of aborting

- [ ] **Step 4: Re-run the targeted test**

Run: `pnpm --filter @dpf/db test -- src/reference-model-projection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/reference-model-projection.ts packages/db/src/reference-model-projection.test.ts
git commit -m "feat: add projection failure handling"
```

---

## Chunk 2: EA Action And Reference-Model Read Model

### Task 4: Add a failing server-action test for loading the projection

**Files:**
- Modify: `apps/web/lib/actions/ea.test.ts`
- Modify: `apps/web/lib/actions/ea.ts`

- [ ] **Step 1: Write the failing server-action test**

Add a test for a new action such as:

```ts
it("loads the value stream projection and returns the target view id", async () => {
  mockProjectReferenceModel.mockResolvedValue({ viewId: "view-1", createdView: true });

  const result = await projectReferenceModelValueStreams({
    referenceModelSlug: "it4it_v3_0_1",
  });

  expect(result).toEqual({ viewId: "view-1" });
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `pnpm --filter web test -- lib/actions/ea.test.ts`

Expected: FAIL because the action and mocks do not exist yet.

- [ ] **Step 3: Implement the minimal server action**

In `apps/web/lib/actions/ea.ts`:
- require `manage_ea_model`
- call the projection service
- return `{ viewId }`

Use a server-only import path that does not leak seed code back into the runtime bundle.

- [ ] **Step 4: Re-run the targeted test**

Run: `pnpm --filter web test -- lib/actions/ea.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/ea.ts apps/web/lib/actions/ea.test.ts packages/db/src/index.ts
git commit -m "feat: add EA reference projection action"
```

### Task 5: Add a failing read-model test for projection status

**Files:**
- Modify: `apps/web/lib/reference-model-types.ts`
- Modify: `apps/web/lib/ea-data.ts`
- Create or Modify: `apps/web/lib/reference-model-data.test.ts`

- [ ] **Step 1: Write the failing read-model test**

Extend `ReferenceModelDetail` to include projection status, for example:

```ts
valueStreamProjection: {
  viewId: string | null;
  isProjected: boolean;
}
```

Test that `getReferenceModelDetail(slug)` reports whether the projection exists.

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `pnpm --filter web test -- lib/reference-model-data.test.ts`

Expected: FAIL because projection fields are not returned yet.

- [ ] **Step 3: Implement the read-model extension**

In `apps/web/lib/ea-data.ts`:
- look up `EaView` by:
  - `scopeType = "reference_model_projection"`
  - `scopeRef = "<slug>:value_stream_view"`
- attach projection state to `ReferenceModelDetail`

- [ ] **Step 4: Re-run the targeted test**

Run: `pnpm --filter web test -- lib/reference-model-data.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reference-model-types.ts apps/web/lib/ea-data.ts apps/web/lib/reference-model-data.test.ts
git commit -m "feat: expose reference projection status in EA data"
```

---

## Chunk 3: Reference-Model Page UX

### Task 6: Add a failing component test for projection actions

**Files:**
- Create: `apps/web/components/ea/ReferenceProjectionActions.tsx`
- Create: `apps/web/components/ea/ReferenceProjectionActions.test.tsx`

- [ ] **Step 1: Write the failing component test**

Cover:
- shows `Load value stream view` when no projection exists
- shows `Refresh value stream view` when a projection already exists
- shows a link to open the existing view when `viewId` is present

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `pnpm --filter web test -- components/ea/ReferenceProjectionActions.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the minimal component**

Recommended behavior:
- render a server-action-backed `<form>`
- submit `referenceModelSlug`
- on success, redirect to `/ea/views/<viewId>`
- if `viewId` already exists, also render a direct link to open the view

Keep the component narrow. It should not own unrelated reference-model UI.

- [ ] **Step 4: Re-run the targeted test**

Run: `pnpm --filter web test -- components/ea/ReferenceProjectionActions.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ea/ReferenceProjectionActions.tsx apps/web/components/ea/ReferenceProjectionActions.test.tsx
git commit -m "feat: add reference projection action component"
```

### Task 7: Wire the reference-model page to the projection action

**Files:**
- Modify: `apps/web/app/(shell)/ea/models/[slug]/page.tsx`

- [ ] **Step 1: Add the projection panel to the page**

Place it near the top of the reference-model detail page, before the artifacts list, so the user sees:
- model summary
- projection status
- load/refresh action
- open view link when present

- [ ] **Step 2: Add a narrow rendering assertion if page tests already exist**

If a page-level test exists, extend it. If not, prefer keeping coverage at the data and component level to avoid unnecessary page-test overhead.

- [ ] **Step 3: Run the targeted UI tests**

Run:
- `pnpm --filter web test -- components/ea/ReferenceProjectionActions.test.tsx`
- `pnpm --filter web test -- lib/reference-model-data.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(shell)/ea/models/[slug]/page.tsx
git commit -m "feat: wire EA reference projection into model detail page"
```

---

## Chunk 4: End-To-End Verification And Docs

### Task 8: Verify the projection from database through UI route

**Files:**
- Modify: `docs/superpowers/specs/2026-03-14-ea-reference-value-stream-projection-design.md`

- [ ] **Step 1: Run the targeted database and web tests**

Run:
- `pnpm --filter @dpf/db test -- src/reference-model-projection.test.ts`
- `pnpm --filter web test -- lib/actions/ea.test.ts lib/reference-model-data.test.ts components/ea/ReferenceProjectionActions.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run typechecks**

Run:
- `pnpm --filter @dpf/db typecheck`
- `pnpm --filter web typecheck`

Expected: PASS, or clearly identify any unrelated baseline failures if they remain.

- [ ] **Step 3: Run a production build**

Run: `pnpm --filter web build`

Expected: PASS.

- [ ] **Step 4: Perform a live projection against the local database**

Use the running app or a targeted script to:
- open `/ea/models/it4it_v3_0_1`
- trigger `Load value stream view`
- confirm a navigable `EaView` is created
- confirm `EaViewElement` rows exist

Suggested verification command if using a script:

```bash
pnpm --filter @dpf/db exec tsx scripts/verify-reference-projection.ts
```

Create the script only if the manual verification path proves too fragile.

- [ ] **Step 5: Update the spec status**

Mark the spec as implemented or partially implemented, and record:
- what shipped
- how projection identity is persisted
- any deferred items for uploaded artifacts or agent-driven ingestion

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-03-14-ea-reference-value-stream-projection-design.md
git commit -m "docs: update EA reference projection spec status"
```

---

## Final Verification Checklist

- [ ] `projectReferenceModel()` creates a value-stream EA view from normalized reference-model data
- [ ] rerunning projection refreshes the same view without duplicates
- [ ] value streams and stages are nested and ordered correctly in `EaViewElement`
- [ ] the reference-model detail page shows load/refresh status
- [ ] the action returns or navigates to the projected EA view
- [ ] `pnpm --filter @dpf/db test -- src/reference-model-projection.test.ts`
- [ ] `pnpm --filter web test -- lib/actions/ea.test.ts lib/reference-model-data.test.ts components/ea/ReferenceProjectionActions.test.tsx`
- [ ] `pnpm --filter @dpf/db typecheck`
- [ ] `pnpm --filter web typecheck`
- [ ] `pnpm --filter web build`

---

## Notes For The Implementer

- Keep projection logic deterministic and repository-backed.
- Do not reset the database as part of this feature.
- Do not mix criteria visualization into the value-stream projection slice.
- Keep the server action thin; the projection service should own the heavy lifting.
- Preserve the future path where an embedded AI coworker triggers the same projection workflow after uploaded artifacts are normalized.
