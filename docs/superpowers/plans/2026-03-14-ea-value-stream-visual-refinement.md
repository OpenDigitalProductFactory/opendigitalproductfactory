# EA Value Stream Visual Refinement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the EA value-stream projection so it renders as an automatically sized directional band with nested stage chevrons, drag-and-drop stage resequencing, and the first layer of projection-aware layout metadata.

**Architecture:** Keep the existing structured-projection model and hidden internal `flows_to` behavior, but replace the current fixed-width card renderer with a geometry-driven value-stream band. Add a small pure layout helper for width and stage positioning, keep stage resequencing on the existing `moveStructuredViewElement` server action, and plumb optional layout-role metadata through the reference-model projection and EA view serializer so the canvas can evolve toward contextual lanes without a rewrite.

**Tech Stack:** Next.js 16, React 18, TypeScript, Vitest, React Flow (`@xyflow/react`), Prisma workspace package `@dpf/db`

---

## File Structure

**Renderer and client interaction**
- Modify: `apps/web/components/ea/StructuredValueStreamNode.tsx`
  - Replace fixed-width card markup with the directional band/stage chevron composition.
  - Remove embedded left/right buttons.
  - Add stage drag-start, drag-over, and drop affordances that call the existing structured-child move callback.
- Modify: `apps/web/components/ea/EaElementNode.tsx`
  - Keep parent-node handles intact while ensuring the structured node can opt out of unwanted node dragging on stage drag targets.
- Modify: `apps/web/components/ea/EaCanvas.tsx`
  - Preserve existing server action wiring, but pass any new reorder callback shape or metadata needed by the refined structured node.
- Create: `apps/web/components/ea/value-stream-layout.ts`
  - Pure helper for stage width estimation, band width calculation, chevron insets, and optional support/context lane anchor math.

**Shared types and EA data plumbing**
- Modify: `apps/web/lib/ea-types.ts`
  - Add optional projection layout metadata to `SerializedViewElement` in a backward-compatible way.
- Modify: `apps/web/lib/ea-data.ts`
  - Serialize any projection layout metadata from `EaElement.properties` into the view payload.
- Modify: `packages/db/src/reference-model-projection.ts`
  - Persist minimal projection metadata for value-stream band/stage roles so future contextual layout has a stable contract.

**Tests**
- Create: `apps/web/components/ea/value-stream-layout.test.ts`
  - Pure geometry/layout regression tests.
- Modify: `apps/web/components/ea/StructuredValueStreamNode.test.tsx`
  - Update markup assertions for the new band/stage structure and remove expectations for inline left/right buttons.
- Modify: `apps/web/lib/ea-structure.test.ts`
  - Keep proving implied internal `flows_to` edges stay hidden after the visual refactor.
- Modify: `apps/web/lib/actions/ea.test.ts`
  - Keep proving resequencing still routes through `moveStructuredViewElement`.
- Modify: `packages/db/src/reference-model-projection.test.ts`
  - Prove the projection writes stable layout-role metadata for value streams and stages.

---

## Chunk 1: Geometry and Directional Band Rendering

### Task 1: Add a pure value-stream layout helper

**Files:**
- Create: `apps/web/components/ea/value-stream-layout.ts`
- Test: `apps/web/components/ea/value-stream-layout.test.ts`

- [ ] **Step 1: Write the failing layout helper tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildValueStreamLayout,
  estimateStageWidth,
} from "./value-stream-layout";

describe("estimateStageWidth", () => {
  it("grows with label length within bounds", () => {
    expect(estimateStageWidth("Plan")).toBeGreaterThanOrEqual(120);
    expect(estimateStageWidth("Longer Stage Label")).toBeGreaterThan(estimateStageWidth("Plan"));
    expect(estimateStageWidth("A label so long that it should clamp")).toBeLessThanOrEqual(220);
  });
});

describe("buildValueStreamLayout", () => {
  it("expands the parent band as stages are added", () => {
    const short = buildValueStreamLayout(["Plan", "Build"]);
    const longer = buildValueStreamLayout(["Plan", "Build", "Run", "Improve"]);
    expect(longer.bandWidth).toBeGreaterThan(short.bandWidth);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- components/ea/value-stream-layout.test.ts`  
Expected: FAIL with module-not-found or missing-export errors for `value-stream-layout.ts`

- [ ] **Step 3: Write the minimal layout helper**

```ts
export function estimateStageWidth(label: string): number {
  const minStageWidth = 120;
  const maxStageWidth = 220;
  const approxCharWidth = 7;
  const horizontalPadding = 42;
  return Math.max(
    minStageWidth,
    Math.min(maxStageWidth, label.length * approxCharWidth + horizontalPadding),
  );
}

export function buildValueStreamLayout(labels: string[]) {
  const stageGap = 22;
  const bandInsetLeft = 56;
  const bandInsetRight = 72;
  const stageWidths = labels.map(estimateStageWidth);
  const bandWidth =
    bandInsetLeft +
    bandInsetRight +
    stageWidths.reduce((sum, width) => sum + width, 0) +
    Math.max(labels.length - 1, 0) * stageGap;

  return { stageWidths, stageGap, bandInsetLeft, bandInsetRight, bandWidth };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- components/ea/value-stream-layout.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ea/value-stream-layout.ts apps/web/components/ea/value-stream-layout.test.ts
git commit -m "test: add value stream layout helper coverage"
```

### Task 2: Refactor `StructuredValueStreamNode` to use the directional band

**Files:**
- Modify: `apps/web/components/ea/StructuredValueStreamNode.tsx`
- Modify: `apps/web/components/ea/StructuredValueStreamNode.test.tsx`
- Test: `apps/web/components/ea/value-stream-layout.test.ts`
- Test: `apps/web/components/ea/StructuredValueStreamNode.test.tsx`

- [ ] **Step 1: Rewrite the component test to assert the new visual contract**

```ts
it("renders a directional parent band sized from the ordered stage labels", () => {
  const html = renderToStaticMarkup(<StructuredValueStreamNode data={valueStream} />);
  expect(html).toContain("Value Stream");
  expect(html).toContain("value-stream-stage");
  expect(html).not.toContain("Move stage left");
  expect(html).not.toContain("Move stage right");
  expect(html).toContain("data-value-stream-band");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- components/ea/StructuredValueStreamNode.test.tsx`  
Expected: FAIL because the current component still renders the fixed-width card and inline move buttons

- [ ] **Step 3: Refactor the component to the new band/stage chevron structure**

Implementation requirements:
- Import `buildValueStreamLayout` from `apps/web/components/ea/value-stream-layout.ts`
- Replace the hard-coded `width: 440` with computed `bandWidth`
- Keep the parent `Value Stream` label and lifecycle text, but move them into a directional band shell
- Render stage chevrons with individually computed widths instead of `gridTemplateColumns: repeat(...)`
- Keep `className="value-stream-stage"` on each stage for regression coverage
- Add `data-value-stream-band` or similar stable test selector to the parent band
- Use `className="nodrag nopan"` on stage and stage drop-target markup so stage interactions do not drag the whole React Flow node

Minimal shape sketch:

```tsx
const layout = buildValueStreamLayout(stages.map((stage) => stage.element.name));

<div style={{ width: layout.bandWidth }}>
  <div data-value-stream-band style={{ clipPath: bandClipPath, ...bandStyles }}>
    <div>{data.element.name}</div>
    <div style={{ display: "flex", gap: layout.stageGap }}>
      {stages.map((stage, index) => (
        <div
          key={stage.viewElementId}
          className="value-stream-stage nodrag nopan"
          style={{ width: layout.stageWidths[index], clipPath: stageClipPath }}
        >
          {stage.element.name}
        </div>
      ))}
    </div>
  </div>
</div>
```

- [ ] **Step 4: Run the focused component tests**

Run: `pnpm --filter web test -- components/ea/value-stream-layout.test.ts components/ea/StructuredValueStreamNode.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ea/StructuredValueStreamNode.tsx apps/web/components/ea/StructuredValueStreamNode.test.tsx apps/web/components/ea/value-stream-layout.ts apps/web/components/ea/value-stream-layout.test.ts
git commit -m "feat: refine value stream band rendering"
```

## Chunk 2: Drag-and-Drop Resequencing Without Inline Buttons

### Task 3: Replace inline stage move buttons with drag-and-drop reorder

**Files:**
- Modify: `apps/web/components/ea/StructuredValueStreamNode.tsx`
- Modify: `apps/web/components/ea/EaCanvas.tsx`
- Modify: `apps/web/lib/ea-types.ts`
- Modify: `apps/web/lib/actions/ea.test.ts`
- Test: `apps/web/components/ea/StructuredValueStreamNode.test.tsx`
- Test: `apps/web/lib/actions/ea.test.ts`

- [ ] **Step 1: Extend the component test for drag affordances and no inline controls**

```ts
it("marks editable stages as draggable reorder targets without inline buttons", () => {
  const html = renderToStaticMarkup(<StructuredValueStreamNode data={editableValueStream} />);
  expect(html).toContain('draggable="true"');
  expect(html).toContain("data-stage-drop-target");
  expect(html).not.toContain("Move stage left");
  expect(html).not.toContain("Move stage right");
});
```

- [ ] **Step 2: Keep the server-action test focused on resequencing behavior**

Add or preserve an assertion like:

```ts
expect(prisma.eaViewElement.updateMany).toHaveBeenCalled();
expect(prisma.eaConformanceIssue.deleteMany).toHaveBeenCalled();
```

Run: `pnpm --filter web test -- components/ea/StructuredValueStreamNode.test.tsx lib/actions/ea.test.ts`  
Expected: the new drag-affordance assertions fail until the component is updated

- [ ] **Step 3: Implement drag-and-drop in the structured node using the existing move callback**

Implementation requirements:
- Keep `onMoveStructuredChild` as the only mutation path
- Track the dragged stage view-element id in local component state
- Add before/after drop targets between stages and at the stream edges
- On drop, call:

```ts
await data.onMoveStructuredChild?.({
  childViewElementId: draggedStageId,
  targetOrderIndex: dropIndex,
});
```

- Remove the existing `Left` and `Right` button markup completely
- Keep the editable behavior gated by:

```ts
!data.isReadOnly && typeof data.onMoveStructuredChild === "function"
```

- [ ] **Step 4: Keep `EaCanvas` wiring simple**

Implementation requirements:
- Do not add a second mutation API
- If needed, widen the callback type in `apps/web/lib/ea-types.ts` only enough to support drag/drop semantics
- Keep `moveStructuredViewElement` in `apps/web/components/ea/EaCanvas.tsx` as the server action endpoint
- Avoid changing `apps/web/lib/actions/ea.ts` unless drag/drop exposes a real server-side gap

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter web test -- components/ea/StructuredValueStreamNode.test.tsx lib/actions/ea.test.ts lib/ea-structure.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/ea/StructuredValueStreamNode.tsx apps/web/components/ea/EaCanvas.tsx apps/web/lib/ea-types.ts apps/web/components/ea/StructuredValueStreamNode.test.tsx apps/web/lib/actions/ea.test.ts apps/web/lib/ea-structure.test.ts
git commit -m "feat: add drag reorder for value stream stages"
```

## Chunk 3: Projection Metadata and Verification

### Task 4: Persist minimal layout-role metadata for future contextual lanes

**Files:**
- Modify: `packages/db/src/reference-model-projection.ts`
- Modify: `packages/db/src/reference-model-projection.test.ts`
- Modify: `apps/web/lib/ea-data.ts`
- Modify: `apps/web/lib/ea-types.ts`

- [ ] **Step 1: Write the failing projection test for layout-role metadata**

Add expectations that the created or updated projected elements include stable metadata, for example:

```ts
expect(mockPrisma.eaElement.create).toHaveBeenCalledWith(
  expect.objectContaining({
    data: expect.objectContaining({
      properties: expect.objectContaining({
        projection: expect.objectContaining({
          layoutRole: "stream_band",
        }),
      }),
    }),
  }),
);
```

For stages, assert `layoutRole: "stream_stage"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dpf/db test -- src/reference-model-projection.test.ts`  
Expected: FAIL because the current projection metadata has no layout role

- [ ] **Step 3: Add the minimal metadata and serialization**

Implementation requirements:
- In `packages/db/src/reference-model-projection.ts`, extend `buildProjectionMetadata(...)` to include a stable `layoutRole`
- Map:
  - `value_stream` -> `stream_band`
  - `value_stream_stage` -> `stream_stage`
- In `apps/web/lib/ea-types.ts`, add an optional field:

```ts
layoutRole?: "stream_band" | "stream_stage" | "context_in" | "context_out" | "stage_support" | "shared_support" | null;
```

- In `apps/web/lib/ea-data.ts`, read `ve.element.properties?.projection?.layoutRole` and serialize it when present
- Keep this backward-compatible so existing views without metadata still render

- [ ] **Step 4: Run projection and web data tests**

Run: `pnpm --filter @dpf/db test -- src/reference-model-projection.test.ts`  
Expected: PASS

Run: `pnpm --filter web test -- lib/reference-model-data.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/reference-model-projection.ts packages/db/src/reference-model-projection.test.ts apps/web/lib/ea-data.ts apps/web/lib/ea-types.ts apps/web/lib/reference-model-data.test.ts
git commit -m "feat: persist value stream layout metadata"
```

### Task 5: Full verification and browser sanity check

**Files:**
- No new files
- Verify all modified files from previous tasks

- [ ] **Step 1: Run package-level automated verification**

Run:

```bash
pnpm --filter @dpf/db test -- src/reference-model-projection.test.ts
pnpm --filter web test -- components/ea/value-stream-layout.test.ts components/ea/StructuredValueStreamNode.test.tsx lib/ea-structure.test.ts lib/actions/ea.test.ts lib/reference-model-data.test.ts
pnpm --filter @dpf/db typecheck
pnpm --filter web typecheck
pnpm --filter web build
```

Expected:
- all targeted tests PASS
- both typechecks PASS
- web build PASS

- [ ] **Step 2: Run a manual browser sanity pass on the projected IT4IT value-stream view**

Manual checklist:
- open the projected IT4IT value-stream view in the EA modeler
- confirm the parent stream band expands for streams with more stages
- confirm stage chevrons render inside the parent band
- confirm there are no inline `Left` / `Right` stage buttons
- confirm dragging a stage resequences it and the band resizes after reload
- confirm internal stage-to-stage edges remain hidden
- confirm external relationships to the parent stream still render normally

- [ ] **Step 3: Commit the finished branch state**

```bash
git status --short
git add apps/web/components/ea/StructuredValueStreamNode.tsx apps/web/components/ea/StructuredValueStreamNode.test.tsx apps/web/components/ea/value-stream-layout.ts apps/web/components/ea/value-stream-layout.test.ts apps/web/components/ea/EaCanvas.tsx apps/web/lib/ea-types.ts apps/web/lib/ea-data.ts apps/web/lib/actions/ea.test.ts apps/web/lib/ea-structure.test.ts packages/db/src/reference-model-projection.ts packages/db/src/reference-model-projection.test.ts
git commit -m "feat: refine EA value stream projection layout"
```

---

## Notes

- Keep the implementation DRY and resist adding a generic layout engine in this slice.
- Do not rework structural conformance or hidden-edge logic beyond what the new drag reorder interaction actually needs.
- If contextual support lanes are not yet populated by the current IT4IT projection, keep the `layoutRole` plumbing in place and leave the richer lane rendering for the next slice rather than inventing placeholder nodes.
- Use `className="nodrag nopan"` on nested stage drag/drop affordances so React Flow does not treat stage reorder as whole-node dragging.

