# EA Value Stream Layout Tweaks Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the value-stream band header, prevent right-edge stage clipping, and preserve the stage chevron shape during drag-and-drop reorder.

**Architecture:** Keep the existing structured value-stream node and resequencing callback, but refine the layout helper and renderer. The width fix lives in `value-stream-layout.ts`, the compact header and custom drag ghost live in `StructuredValueStreamNode.tsx`, and the tests stay focused on deterministic markup plus helper behavior.

**Tech Stack:** Next.js 16, React 18, TypeScript, Vitest, React Flow (`@xyflow/react`)

---

## File Structure

- Modify: `apps/web/components/ea/value-stream-layout.ts`
  - Add explicit right-edge clearance and expose compact-header sizing constants if needed.
- Modify: `apps/web/components/ea/value-stream-layout.test.ts`
  - Prove band width includes end clearance and still scales with stage count.
- Modify: `apps/web/components/ea/StructuredValueStreamNode.tsx`
  - Compact the header into a horizontal row and add a custom drag image for stage dragging.
- Modify: `apps/web/components/ea/StructuredValueStreamNode.test.tsx`
  - Assert compact header markup, no inline controls, and retained drag affordances.

---

## Chunk 1: Width Math and Compact Header

### Task 1: Expand band width math for right-edge clearance

**Files:**
- Modify: `apps/web/components/ea/value-stream-layout.test.ts`
- Modify: `apps/web/components/ea/value-stream-layout.ts`

- [ ] **Step 1: Write the failing width-clearance test**

```ts
it("adds explicit end clearance so the final stage does not clip", () => {
  const layout = buildValueStreamLayout(["Plan", "Build", "Run"]);
  const rawStageSpan =
    layout.stageWidths.reduce((sum, width) => sum + width, 0) +
    layout.stageGap * 2 +
    layout.bandInsetLeft +
    layout.bandInsetRight;

  expect(layout.bandWidth).toBeGreaterThan(rawStageSpan);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- components/ea/value-stream-layout.test.ts`  
Expected: FAIL because `bandWidth` currently equals the raw span with no extra clearance

- [ ] **Step 3: Implement the minimal width fix**

Update `apps/web/components/ea/value-stream-layout.ts`:

```ts
const BAND_END_CLEARANCE = 36;

export function buildValueStreamLayout(labels: string[]) {
  const stageWidths = labels.map(estimateStageWidth);
  const bandWidth =
    BAND_INSET_LEFT +
    BAND_INSET_RIGHT +
    BAND_END_CLEARANCE +
    stageWidths.reduce((sum, width) => sum + width, 0) +
    Math.max(labels.length - 1, 0) * STAGE_GAP;

  return {
    stageWidths,
    stageGap: STAGE_GAP,
    bandInsetLeft: BAND_INSET_LEFT,
    bandInsetRight: BAND_INSET_RIGHT,
    bandEndClearance: BAND_END_CLEARANCE,
    bandWidth,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- components/ea/value-stream-layout.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ea/value-stream-layout.ts apps/web/components/ea/value-stream-layout.test.ts
git commit -m "fix: add value stream band end clearance"
```

### Task 2: Compact the header into a horizontal row

**Files:**
- Modify: `apps/web/components/ea/StructuredValueStreamNode.test.tsx`
- Modify: `apps/web/components/ea/StructuredValueStreamNode.tsx`

- [ ] **Step 1: Write the failing compact-header test**

Add assertions like:

```ts
expect(html).toContain("data-value-stream-header");
expect(html).toContain("data-value-stream-title-block");
expect(html).toContain("data-value-stream-meta-block");
```

And remove any test assumptions that depend on the older stacked header spacing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- components/ea/StructuredValueStreamNode.test.tsx`  
Expected: FAIL because the component does not render the new compact-header markers

- [ ] **Step 3: Implement the compact header**

Update `apps/web/components/ea/StructuredValueStreamNode.tsx`:
- add a single top header row with:
  - `data-value-stream-header`
  - left title group `data-value-stream-title-block`
  - right metadata group `data-value-stream-meta-block`
- move lifecycle text into the right-side block
- place the warning pill in the same right-side area when present
- reduce overall vertical padding so the band becomes flatter

Minimal layout sketch:

```tsx
<div data-value-stream-header style={{ display: "flex", justifyContent: "space-between", gap: 18 }}>
  <div data-value-stream-title-block>...</div>
  <div data-value-stream-meta-block>...</div>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- components/ea/StructuredValueStreamNode.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ea/StructuredValueStreamNode.tsx apps/web/components/ea/StructuredValueStreamNode.test.tsx
git commit -m "feat: compact value stream header layout"
```

## Chunk 2: Chevron-Preserving Drag Preview

### Task 3: Add a custom drag image for stages

**Files:**
- Modify: `apps/web/components/ea/StructuredValueStreamNode.test.tsx`
- Modify: `apps/web/components/ea/StructuredValueStreamNode.tsx`

- [ ] **Step 1: Add a failing test for the drag-preview hook point**

Because jsdom will not verify the native ghost image, assert the renderer exposes a stable drag-preview marker:

```ts
expect(html).toContain("data-stage-drag-preview");
expect(html).toContain('draggable="true"');
```

The marker can be a template or hidden preview element used by the drag helper.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- components/ea/StructuredValueStreamNode.test.tsx`  
Expected: FAIL because no drag-preview marker/helper exists yet

- [ ] **Step 3: Implement the custom drag image**

In `apps/web/components/ea/StructuredValueStreamNode.tsx`:
- create a helper that builds an off-screen chevron preview element on drag start
- populate it with:
  - stage number
  - stage name
  - lifecycle text
- style it to match the live chevron closely
- call:

```ts
event.dataTransfer.setDragImage(previewElement, previewWidth / 2, previewHeight / 2);
```

- remove the preview element on drag end
- keep the live stage shape unchanged in the band while dragging
- add a stable hidden/template marker such as `data-stage-drag-preview` for regression coverage

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- components/ea/StructuredValueStreamNode.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ea/StructuredValueStreamNode.tsx apps/web/components/ea/StructuredValueStreamNode.test.tsx
git commit -m "fix: preserve chevron shape during stage drag"
```

## Chunk 3: Verification

### Task 4: Full verification and browser sanity pass

**Files:**
- Verify previously modified files only

- [ ] **Step 1: Run automated verification**

Run:

```bash
pnpm --filter web test -- components/ea/value-stream-layout.test.ts components/ea/StructuredValueStreamNode.test.tsx
pnpm --filter web typecheck
$env:DATABASE_URL='postgresql://dpf:dpf_dev@localhost:5432/dpf'; pnpm --filter web build
```

Expected:
- targeted tests PASS
- typecheck PASS
- build PASS

- [ ] **Step 2: Run a manual browser verification**

Manual checklist:
- start the app from local `main` or this feature branch worktree
- open the value-stream view
- confirm the header uses the top-right space instead of extra stacked rows
- confirm the band is flatter vertically
- confirm the rightmost stage is fully visible
- drag a stage and verify the ghost remains chevron-shaped rather than a generic box
- drop a stage and verify resequencing still works

- [ ] **Step 3: Commit final polish if anything changed during verification**

```bash
git status --short
git add apps/web/components/ea/value-stream-layout.ts apps/web/components/ea/value-stream-layout.test.ts apps/web/components/ea/StructuredValueStreamNode.tsx apps/web/components/ea/StructuredValueStreamNode.test.tsx
git commit -m "fix: polish value stream layout tweaks"
```

If no files changed after verification, skip this commit.

