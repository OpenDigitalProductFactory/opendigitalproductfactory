# EA Stage Endpoints and Drag Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make value-stream stages real visible canvas nodes with four-sided handles and reliable node-based movement, while keeping the parent value-stream band as the structured container and sequence owner.

**Architecture:** Replace the current “stages rendered inside the parent node DOM” projection with a structured grouped projection: the parent value stream stays visible as a band node, child stages also stay visible as stage nodes, and layout code positions the stages inside the band deterministically. This keeps the existing parent/child/order semantics and hidden internal `flows_to` behavior while enabling normal stage connections and removing dependence on native HTML drag ghosts.

**Tech Stack:** Next.js 16, React 18, TypeScript, Vitest, React Flow (`@xyflow/react`)

---

## File Structure

**Projection and layout**
- Modify: `apps/web/components/ea/EaCanvas.tsx`
  - Stop collapsing stage children entirely into the parent node. Build a visible structured projection containing both the band node and the child stage nodes, plus deterministic node positions.
- Modify: `apps/web/lib/ea-structure.ts`
  - Add helpers for structured grouped visibility and stage-parent lookup without breaking hidden internal edge filtering.
- Modify: `apps/web/lib/ea-structure.test.ts`
  - Prove stages remain visible projected nodes and internal stage-sequence edges stay hidden.

**Node rendering**
- Modify: `apps/web/components/ea/EaElementNode.tsx`
  - Keep normal four-sided handles for stage nodes and only use the special band renderer for the parent value-stream node.
- Modify: `apps/web/components/ea/StructuredValueStreamNode.tsx`
  - Simplify it into a parent band/container renderer only. Remove HTML-embedded child stage rendering and drag logic.
- Modify: `apps/web/components/ea/StructuredValueStreamNode.test.tsx`
  - Update tests to assert parent-band-only rendering.
- Create: `apps/web/components/ea/ValueStreamStageNode.tsx`
  - Stage-specific chevron node with all four handles and normal node behavior.
- Create: `apps/web/components/ea/ValueStreamStageNode.test.tsx`
  - Prove stages render as chevron nodes with visible handle structure.

**Shared geometry**
- Modify: `apps/web/components/ea/value-stream-layout.ts`
  - Add group layout helpers that calculate parent band bounds plus child stage positions.
- Modify: `apps/web/components/ea/value-stream-layout.test.ts`
  - Prove stage positions land inside the parent band and the parent width derives from child geometry.

**Canvas interaction and action coverage**
- Modify: `apps/web/lib/actions/ea.test.ts`
  - Keep proving resequencing still uses `moveStructuredViewElement` and add any new order-resolution expectations if node-based reorder math changes.
- Create or modify: `apps/web/components/ea/EaCanvas.test.tsx` if a focused unit seam is practical; otherwise prefer pure helper tests and existing action tests.

---

## Chunk 1: Visible Structured Projection

### Task 1: Add failing projection tests for visible stage nodes

**Files:**
- Modify: `apps/web/lib/ea-structure.test.ts`
- Modify: `apps/web/lib/ea-structure.ts`

- [ ] **Step 1: Write the failing test**

Add a test proving a structured value stream returns both:
- the parent stream as visible
- the child stages as visible projected nodes

Minimal test sketch:

```ts
it("keeps structured stage nodes visible while preserving parent-child grouping", () => {
  const elements = [
    {
      viewElementId: "stream-1",
      elementId: "el-stream-1",
      elementTypeSlug: "value_stream",
      parentViewElementId: null,
      orderIndex: null,
      rendererHint: "nested_chevron_sequence",
    },
    {
      viewElementId: "stage-1",
      elementId: "el-stage-1",
      elementTypeSlug: "value_stream_stage",
      parentViewElementId: "stream-1",
      orderIndex: 0,
      rendererHint: null,
    },
  ];

  const structured = buildStructuredViewElements(elements);
  const visible = listStructuredVisibleViewElementIds(structured);

  expect(visible).toEqual(["stream-1", "stage-1"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- lib/ea-structure.test.ts`  
Expected: FAIL because no helper exists yet for visible structured node flattening

- [ ] **Step 3: Implement the minimal projection helper**

In `apps/web/lib/ea-structure.ts`:
- keep `buildStructuredViewElements(...)`
- keep `filterStructuredEdges(...)`
- add a helper like:

```ts
export function listStructuredVisibleViewElementIds(
  structuredRoots: StructuredViewElement[],
): string[] {
  const result: string[] = [];
  const visit = (node: StructuredViewElement) => {
    result.push(node.viewElementId);
    node.childViewElements.forEach(visit);
  };
  structuredRoots.forEach(visit);
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- lib/ea-structure.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/ea-structure.ts apps/web/lib/ea-structure.test.ts
git commit -m "test: expose structured stage nodes in projection helpers"
```

### Task 2: Change `EaCanvas` to keep child stages visible

**Files:**
- Modify: `apps/web/components/ea/EaCanvas.tsx`
- Modify: `apps/web/lib/ea-structure.ts`
- Test: `apps/web/lib/ea-structure.test.ts`

- [ ] **Step 1: Add a failing test or focused assertion for visible stage projection**

If an `EaCanvas` unit test seam is not practical, extend `ea-structure` tests to assert flattening order for:
- parent stream first
- then child stages in order

- [ ] **Step 2: Run test to verify it fails or remains red from missing consumer behavior**

Run: `pnpm --filter web test -- lib/ea-structure.test.ts`  
Expected: RED until `EaCanvas` consumes the new flattening behavior

- [ ] **Step 3: Update `EaCanvas` projection building**

Current problem:
- `visibleElements` is currently only `structuredRoots.map(hydrateStructuredElement)`
- child stages are attached as `childViewElements` but not rendered as nodes

Refactor `buildStructuredProjection(...)` in `apps/web/components/ea/EaCanvas.tsx` so it returns:
- structured roots for hidden-edge logic
- a flattened visible element list containing both parent streams and child stages
- preserved `childViewElements` on the parent stream for layout calculations if needed

Implementation sketch:

```ts
function flattenStructuredElements(elements: SerializedViewElement[]): SerializedViewElement[] {
  const result: SerializedViewElement[] = [];
  const visit = (element: SerializedViewElement) => {
    result.push(element);
    (element.childViewElements ?? []).forEach(visit);
  };
  elements.forEach(visit);
  return result;
}
```

Then use the flattened visible list to build nodes.

- [ ] **Step 4: Run focused regression tests**

Run: `pnpm --filter web test -- lib/ea-structure.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ea/EaCanvas.tsx apps/web/lib/ea-structure.ts apps/web/lib/ea-structure.test.ts
git commit -m "feat: keep value stream stages visible in canvas projection"
```

## Chunk 2: Parent Band Node and Real Stage Nodes

### Task 3: Split parent-band rendering from stage-node rendering

**Files:**
- Modify: `apps/web/components/ea/EaElementNode.tsx`
- Modify: `apps/web/components/ea/StructuredValueStreamNode.tsx`
- Modify: `apps/web/components/ea/StructuredValueStreamNode.test.tsx`
- Create: `apps/web/components/ea/ValueStreamStageNode.tsx`
- Create: `apps/web/components/ea/ValueStreamStageNode.test.tsx`

- [ ] **Step 1: Write failing tests**

1. Parent band test:
```ts
it("renders only the stream band shell and no embedded child stage markup", () => {
  const html = renderToStaticMarkup(<StructuredValueStreamNode data={stream} />);
  expect(html).toContain("data-value-stream-band");
  expect(html).not.toContain("value-stream-stage");
});
```

2. Stage node test:
```ts
it("renders a stage chevron node with four handles", () => {
  const html = renderToStaticMarkup(<ValueStreamStageNode data={stage} selected={false} />);
  expect(html).toContain("data-value-stream-stage-node");
  expect(html).toContain("data-stage-handle-top");
  expect(html).toContain("data-stage-handle-right");
  expect(html).toContain("data-stage-handle-bottom");
  expect(html).toContain("data-stage-handle-left");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- components/ea/StructuredValueStreamNode.test.tsx components/ea/ValueStreamStageNode.test.tsx`  
Expected: FAIL because the stage node component does not exist yet and the parent still embeds stages

- [ ] **Step 3: Implement the split renderer**

In `apps/web/components/ea/StructuredValueStreamNode.tsx`:
- remove embedded child-stage DOM rendering
- remove HTML drag/drop logic entirely
- keep:
  - compact header
  - parent band sizing shell
  - any parent-level warning display

In `apps/web/components/ea/ValueStreamStageNode.tsx`:
- render the chevron stage body
- add four handles
- expose stable test markers for the handles
- keep styling aligned with the current stage visual

In `apps/web/components/ea/EaElementNode.tsx`:
- if `rendererHint === "nested_chevron_sequence"` and the element type is `value_stream`, use `StructuredValueStreamNode`
- if the element type is `value_stream_stage`, render `ValueStreamStageNode`
- otherwise keep existing generic node behavior

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter web test -- components/ea/StructuredValueStreamNode.test.tsx components/ea/ValueStreamStageNode.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ea/EaElementNode.tsx apps/web/components/ea/StructuredValueStreamNode.tsx apps/web/components/ea/StructuredValueStreamNode.test.tsx apps/web/components/ea/ValueStreamStageNode.tsx apps/web/components/ea/ValueStreamStageNode.test.tsx
git commit -m "feat: render value stream stages as real nodes"
```

## Chunk 3: Structured Group Layout and Stage Movement

### Task 4: Add layout helpers for parent band bounds and child stage positions

**Files:**
- Modify: `apps/web/components/ea/value-stream-layout.ts`
- Modify: `apps/web/components/ea/value-stream-layout.test.ts`
- Modify: `apps/web/components/ea/EaCanvas.tsx`

- [ ] **Step 1: Write the failing layout test**

Add a test proving:
- parent band width derives from stage geometry
- stage positions land inside the band

Sketch:

```ts
it("positions stage nodes inside the parent value stream band", () => {
  const layout = buildValueStreamGroupLayout({
    stageLabels: ["Plan", "Build"],
    origin: { x: 0, y: 0 },
  });

  expect(layout.band.width).toBeGreaterThan(0);
  expect(layout.stages[0]?.x).toBeGreaterThan(layout.band.x);
  expect(layout.stages[1]?.x).toBeGreaterThan(layout.stages[0]!.x);
  expect(layout.stages[1]!.x + layout.stages[1]!.width).toBeLessThan(layout.band.x + layout.band.width);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- components/ea/value-stream-layout.test.ts`  
Expected: FAIL because no grouped layout helper exists yet

- [ ] **Step 3: Implement the minimal grouped layout helper**

In `apps/web/components/ea/value-stream-layout.ts`, add a helper like:

```ts
export function buildValueStreamGroupLayout(input: {
  stageLabels: string[];
  origin: { x: number; y: number };
}) {
  // derive stage widths
  // compute band width/height
  // compute stage x/y positions centered within band
}
```

In `apps/web/components/ea/EaCanvas.tsx`:
- when a visible element is a parent `value_stream`, derive its band position
- when a visible element is a child `value_stream_stage`, assign its node position from the group layout instead of the generic grid
- keep saved `canvasState` positions for non-structured nodes
- keep structured stages deterministic from order unless a later design explicitly adds free placement

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter web test -- components/ea/value-stream-layout.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ea/value-stream-layout.ts apps/web/components/ea/value-stream-layout.test.ts apps/web/components/ea/EaCanvas.tsx
git commit -m "feat: position stage nodes inside value stream band"
```

### Task 5: Keep resequencing semantics while moving away from HTML drag ghosts

**Files:**
- Modify: `apps/web/lib/actions/ea.test.ts`
- Modify: `apps/web/components/ea/EaCanvas.tsx`

- [ ] **Step 1: Write or extend the failing resequence test**

Keep a focused expectation around the existing server action:

```ts
await moveStructuredViewElement({
  viewElementId: "stage-ve-2",
  targetParentViewElementId: "stream-ve-1",
  targetOrderIndex: 0,
});

expect(prisma.eaViewElement.updateMany).toHaveBeenCalled();
```

If the node-based interaction changes how `targetOrderIndex` is derived, add a small pure helper test for the resolved insertion index.

- [ ] **Step 2: Run test to verify it fails only if new client reorder math is missing**

Run: `pnpm --filter web test -- lib/actions/ea.test.ts`  
Expected: either still green or red only for the new ordering helper

- [ ] **Step 3: Implement node-based reorder behavior**

Do not reintroduce HTML drag ghosts.

Recommended minimal path:
- add client-side reorder intent based on stage-node move/drop relative to sibling x positions
- resolve a target order index
- call the existing `moveStructuredViewElement` action

If React Flow node drag integration is too deep for the first slice, use a stage-node-specific reorder affordance that still preserves node shape and avoids browser `dataTransfer`.

Constraint:
- no regression to “stages are not real nodes”
- no regression to hidden internal `flows_to` edges

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter web test -- lib/actions/ea.test.ts lib/ea-structure.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ea/EaCanvas.tsx apps/web/lib/actions/ea.test.ts apps/web/lib/ea-structure.test.ts
git commit -m "fix: preserve stage semantics during reorder"
```

## Chunk 4: Full Verification

### Task 6: Run full verification and browser sanity check

**Files:**
- Verify all modified files from previous tasks

- [ ] **Step 1: Run automated verification**

Run:

```bash
pnpm --filter web test -- components/ea/value-stream-layout.test.ts components/ea/StructuredValueStreamNode.test.tsx components/ea/ValueStreamStageNode.test.tsx lib/ea-structure.test.ts lib/actions/ea.test.ts
pnpm --filter web typecheck
$env:DATABASE_URL='postgresql://dpf:dpf_dev@localhost:5432/dpf'; pnpm --filter web build
```

Expected:
- all targeted tests PASS
- typecheck PASS
- build PASS

- [ ] **Step 2: Run manual browser verification**

Manual checklist:
- open the projected value-stream view
- confirm each stage is a visible node in the canvas
- confirm stage handles are available on all four sides
- draw a connection directly to a stage
- confirm internal stage-sequence edges are still hidden
- move/reorder a stage and confirm the interaction preserves the stage shape
- confirm the parent band still sizes itself correctly around the stage set

- [ ] **Step 3: Commit final polish if needed**

```bash
git status --short
git add apps/web/components/ea/EaCanvas.tsx apps/web/components/ea/EaElementNode.tsx apps/web/components/ea/StructuredValueStreamNode.tsx apps/web/components/ea/StructuredValueStreamNode.test.tsx apps/web/components/ea/ValueStreamStageNode.tsx apps/web/components/ea/ValueStreamStageNode.test.tsx apps/web/components/ea/value-stream-layout.ts apps/web/components/ea/value-stream-layout.test.ts apps/web/lib/ea-structure.ts apps/web/lib/ea-structure.test.ts apps/web/lib/actions/ea.test.ts
git commit -m "fix: enable stage connections in value streams"
```

If no files changed during verification, skip this commit.

