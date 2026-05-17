# Business Capability Map Nested Analytics Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/portfolio/architecture` into a nested L1/L2/L3 Business Capability Map work surface with overlay modes, compact evidence chips, and a selected-capability detail panel.

**Architecture:** Keep `BusinessCapability` as the stable business architecture construct and keep operational records as trace targets. Add tested read-model helpers for evidence summaries, overlay states, and deterministic map rows before changing the UI. Then refactor the current map component into smaller client-side map, control, tile, and detail components while preserving the existing server actions and schema.

**Tech Stack:** Next.js 16 app routes, React 19, Prisma 7 read model, Vitest, DPF theme tokens, `lucide-react`, existing Business Capability schema and server actions.

---

## Backlog And Scope

- Active backlog item: `BI-03AD102F` ("Nested Business Capability Map implementation").
- Approved spec: `docs/superpowers/specs/2026-05-17-business-capability-map-nested-analytics-design.md`.
- Do not add schema in this slice.
- Do not conflate `BusinessCapability` and `TaxonomyNode`.
- Reserve refactoring effort for typed read-model helpers and component boundaries.

## File Map

- Modify: `apps/web/lib/business-capabilities/types.ts`
  - Add `CapabilityOverlayMode`, overlay labels, evidence types, and status-aware trace types.
- Modify: `apps/web/lib/business-capabilities/data.ts`
  - Add backlog status to trace records.
  - Add `buildCapabilityEvidenceSummary`, `deriveCapabilityOverlayState`, and `buildCapabilityMapRows`.
  - Return `mapRows` and overlay metadata from `getBusinessCapabilityMapData`.
- Modify: `apps/web/lib/business-capabilities/data.test.ts`
  - Add tests for evidence counts, active backlog count, planning state, IT4IT state, and deterministic row grouping.
- Modify: `apps/web/components/portfolio/architecture/BusinessCapabilityMap.tsx`
  - Convert from flat cards to nested map shell and wire the new client component.
- Create: `apps/web/components/portfolio/architecture/BusinessCapabilityMapClient.tsx`
  - Own overlay selection, IT4IT filtering, selected capability state, and selected detail panel state.
- Create: `apps/web/components/portfolio/architecture/CapabilityMapTiles.tsx`
  - Render L1 bands, L2 tiles, L3 nested tiles, maturity labels, and compact evidence chips.
- Create: `apps/web/components/portfolio/architecture/CapabilityDetailPanel.tsx`
  - Render selected capability maturity, rationale, IT4IT alignment, trace groups, relationship labels, notes, and planning prompts.
- Modify: `apps/web/components/portfolio/architecture/BusinessCapabilityForms.tsx`
  - Keep existing forms working; only adjust if layout composition requires moving forms below or beside the map.
- Modify: `apps/web/app/(shell)/portfolio/architecture/page.tsx`
  - Pass `mapRows` and other new read-model fields into the map surface.
- Verify: `apps/web/lib/business-capabilities/data.test.ts`
  - Primary unit verification for the read model.

## Chunk 1: Read-Model Tests And Types

### Task 1: Add Overlay And Evidence Types

**Files:**
- Modify: `apps/web/lib/business-capabilities/types.ts`
- Modify: `apps/web/lib/business-capabilities/data.ts`
- Test: `apps/web/lib/business-capabilities/data.test.ts`

- [ ] **Step 1: Add failing tests for evidence summaries**

Add assertions to `data.test.ts` using the existing `rows` fixture plus backlog and architecture links:

```ts
const summary = buildCapabilityEvidenceSummary(capability);
expect(summary.taxonomyCount).toBe(1);
expect(summary.productCount).toBe(1);
expect(summary.backlogCount).toBe(2);
expect(summary.activeBacklogCount).toBe(1);
expect(summary.architectureCount).toBe(1);
expect(summary.hasOperationalEvidence).toBe(true);
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```powershell
pnpm --filter web test -- lib/business-capabilities/data.test.ts
```

Expected: fail because `buildCapabilityEvidenceSummary` is not implemented.

- [ ] **Step 3: Add type contracts**

In `types.ts`, add:

```ts
export const CAPABILITY_OVERLAY_MODES = [
  { value: "maturity", label: "Maturity Gap" },
  { value: "coverage", label: "Operational Coverage" },
  { value: "planning", label: "Planning Impact" },
  { value: "it4it", label: "IT4IT Alignment" },
] as const;

export type CapabilityOverlayMode = (typeof CAPABILITY_OVERLAY_MODES)[number]["value"];
export type CapabilityOverlayTone = "aligned" | "watch" | "gap" | "neutral" | "covered" | "active";
export type BacklogTraceStatus = "triaging" | "open" | "in-progress" | "done" | "deferred" | null;
```

- [ ] **Step 4: Extend trace record shape**

In `data.ts`, add an optional `status` field to `BusinessCapabilityTraceRecord`:

```ts
status?: BacklogTraceStatus;
```

- [ ] **Step 5: Implement evidence summary**

Add:

```ts
export type CapabilityEvidenceSummary = {
  taxonomyCount: number;
  productCount: number;
  backlogCount: number;
  activeBacklogCount: number;
  architectureCount: number;
  hasOperationalEvidence: boolean;
};
```

Then implement `buildCapabilityEvidenceSummary(node)` by reading `node.traceGroups`.

- [ ] **Step 6: Run the targeted test and confirm it passes**

Run:

```powershell
pnpm --filter web test -- lib/business-capabilities/data.test.ts
```

Expected: pass.

## Chunk 2: Overlay State And Map Rows

### Task 2: Add Deterministic Overlay Helpers

**Files:**
- Modify: `apps/web/lib/business-capabilities/data.ts`
- Test: `apps/web/lib/business-capabilities/data.test.ts`

- [ ] **Step 1: Add failing tests for overlay state**

Cover these cases:

- maturity mode returns existing maturity band and current/target label.
- coverage mode returns `covered` when operational evidence exists and `gap` when it does not.
- planning mode returns `active` for active backlog work, `gap` for maturity gap without active work, and `aligned` for no active gap.
- IT4IT mode returns a neutral or covered state with value-stream labels.

- [ ] **Step 2: Add failing test for `buildCapabilityMapRows`**

Test that root capabilities are returned in deterministic rows and that the first implementation is an identity row pass:

```ts
const rows = buildCapabilityMapRows(tree);
expect(rows).toEqual([{ id: "row-1", families: tree }]);
```

- [ ] **Step 3: Run the targeted test and confirm failure**

Run:

```powershell
pnpm --filter web test -- lib/business-capabilities/data.test.ts
```

Expected: fail on missing helpers.

- [ ] **Step 4: Implement overlay state**

Add:

```ts
export type CapabilityOverlayState = {
  tone: CapabilityOverlayTone;
  label: string;
  shortLabel: string;
  description: string;
  sortWeight: number;
};
```

Implement:

```ts
export function deriveCapabilityOverlayState(
  node: BusinessCapabilityNode,
  mode: CapabilityOverlayMode,
): CapabilityOverlayState
```

- [ ] **Step 5: Implement required row seam**

Add:

```ts
export type BusinessCapabilityMapRow = {
  id: string;
  families: BusinessCapabilityNode[];
};

export function buildCapabilityMapRows(tree: BusinessCapabilityNode[]): BusinessCapabilityMapRow[] {
  return tree.length === 0 ? [] : [{ id: "row-1", families: tree }];
}
```

The row helper is intentionally simple in this slice. It creates the tested seam for later density-aware row grouping.

- [ ] **Step 6: Enrich backlog trace status**

In `toTraceRecord`, select and map `backlogItem.status`. In `getBusinessCapabilityMapData`, update the Prisma include:

```ts
backlogItem: { select: { itemId: true, title: true, status: true } },
```

- [ ] **Step 7: Return `mapRows`**

In `getBusinessCapabilityMapData`, build the tree once, then return:

```ts
const tree = buildCapabilityTree(records);
return {
  records,
  tree,
  mapRows: buildCapabilityMapRows(tree),
  summary: summarizeCapabilityMap(records),
  ...
};
```

- [ ] **Step 8: Run the targeted test**

Run:

```powershell
pnpm --filter web test -- lib/business-capabilities/data.test.ts
```

Expected: pass.

## Chunk 3: Nested Map Component Split

### Task 3: Build The Client Map Shell

**Files:**
- Modify: `apps/web/components/portfolio/architecture/BusinessCapabilityMap.tsx`
- Create: `apps/web/components/portfolio/architecture/BusinessCapabilityMapClient.tsx`
- Create: `apps/web/components/portfolio/architecture/CapabilityMapTiles.tsx`
- Modify: `apps/web/app/(shell)/portfolio/architecture/page.tsx`

- [ ] **Step 1: Create `BusinessCapabilityMapClient.tsx`**

Start with `"use client"`. It accepts:

```ts
type BusinessCapabilityMapClientProps = {
  mapRows: BusinessCapabilityMapRow[];
  summary: BusinessCapabilitySummary;
};
```

Hold state for:

```ts
const [overlayMode, setOverlayMode] = useState<CapabilityOverlayMode>("maturity");
const [selectedCapabilityId, setSelectedCapabilityId] = useState<string | null>(null);
```

- [ ] **Step 2: Move summary metrics into the client shell**

Preserve the current six metrics, but make the control bar visually primary after the header. Use DPF tokens only.

- [ ] **Step 3: Add overlay segmented controls**

Render `CAPABILITY_OVERLAY_MODES` as buttons with `aria-pressed`.

- [ ] **Step 4: Create `CapabilityMapTiles.tsx`**

Implement pure presentational components:

- `CapabilityMapCanvas`
- `CapabilityFamilyBand`
- `CapabilityTile`
- `CapabilitySubCapabilityTile`
- `EvidenceChips`

Inputs should include `overlayMode`, `selectedCapabilityId`, and `onSelectCapability`.

- [ ] **Step 5: Convert `BusinessCapabilityMap.tsx` to server wrapper**

Keep empty state and summary prop wiring, but delegate interactive rendering to `BusinessCapabilityMapClient`.

- [ ] **Step 6: Update page prop wiring**

In `page.tsx`, pass `data.mapRows` into `BusinessCapabilityMap`.

- [ ] **Step 7: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: pass after imports and props are corrected.

## Chunk 4: Detail Panel

### Task 4: Add Selected-Capability Drill-Down

**Files:**
- Modify: `apps/web/components/portfolio/architecture/BusinessCapabilityMapClient.tsx`
- Create: `apps/web/components/portfolio/architecture/CapabilityDetailPanel.tsx`
- Modify: `apps/web/components/portfolio/architecture/CapabilityMapTiles.tsx`

- [ ] **Step 1: Add capability flattening helper in client shell**

Use `useMemo` to flatten `mapRows` into a list for selected lookup. Keep this helper local to the client component unless tests prove it belongs in `data.ts`.

- [ ] **Step 2: Create `CapabilityDetailPanel.tsx`**

Render:

- selected capability name, level, maturity current/target, and overlay state.
- maturity rationale.
- IT4IT value-stream chips.
- trace groups for taxonomy, products, backlog, and architecture.
- planning prompts:
  - "Target state"
  - "Supports today"
  - "Active or planned work"
  - "Unsupported gap"

- [ ] **Step 3: Add full trace links only in the panel**

Use existing `href` fields where present. For links without href, render readable text. Do not reintroduce full trace lists inside tiles.

- [ ] **Step 4: Add selected state to tiles**

Tiles must be buttons or keyboard-reachable elements with:

```tsx
aria-pressed={selectedCapabilityId === capability.id}
```

- [ ] **Step 5: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: pass.

## Chunk 5: Layout, Visual Polish, And Verification

### Task 5: Finish Nested Layout And Validate UX

**Files:**
- Modify: `apps/web/components/portfolio/architecture/CapabilityMapTiles.tsx`
- Modify: `apps/web/components/portfolio/architecture/BusinessCapabilityMapClient.tsx`
- Modify: `apps/web/components/portfolio/architecture/BusinessCapabilityForms.tsx` if layout needs a lower authoring section.
- Verify: browser route `/portfolio/architecture`

- [ ] **Step 1: Replace card-like family sections with nested bands**

L1 bands should look like containers holding L2 tiles. L2 tiles should visibly hold L3 sub-capabilities. Use stable responsive grid constraints.

- [ ] **Step 2: Add compact evidence chips**

Use icons from `lucide-react` for taxonomy, products, backlog, and architecture. Chips show counts only, plus active backlog count when relevant.

- [ ] **Step 3: Add overlay tone styling helper**

Use semantic tokens only:

```ts
const overlayToneVars = {
  aligned: "var(--dpf-success)",
  watch: "var(--dpf-warning)",
  gap: "var(--dpf-error)",
  neutral: "var(--dpf-muted)",
  covered: "var(--dpf-accent)",
  active: "var(--dpf-info, var(--dpf-accent))",
} as const;
```

Use `color-mix` with theme variables for backgrounds. Do not hardcode hex colors.

- [ ] **Step 4: Ensure mobile behavior**

At narrow width, stack L1 bands vertically, keep L2 tiles readable, and collapse long L3 lists behind a count if needed.

- [ ] **Step 5: Run targeted unit tests**

Run:

```powershell
pnpm --filter web test -- lib/business-capabilities/data.test.ts
```

Expected: pass.

- [ ] **Step 6: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: pass.

- [ ] **Step 7: Run production build**

Run:

```powershell
pnpm --filter web build
```

Expected: pass.

- [ ] **Step 8: UX verify**

Use the installed runtime if available. If `/portfolio/architecture` redirects, log in with `admin@dpf.local` and the repo-root `.env` `ADMIN_PASSWORD`. Capture desktop and mobile screenshots that show:

- nested L1/L2/L3 map layout.
- overlay selector.
- selected capability detail panel.
- evidence chips and trace groups.

- [ ] **Step 9: Commit and push**

Run:

```powershell
git status --short
git add apps/web/lib/business-capabilities apps/web/components/portfolio/architecture apps/web/app/(shell)/portfolio/architecture/page.tsx docs/superpowers/specs/2026-05-17-business-capability-map-nested-analytics-design.md docs/superpowers/plans/2026-05-17-business-capability-map-nested-analytics.md
git commit -s -m "feat: refine business capability map analytics"
git push -u origin feat/business-capability-map-nested-analytics
```

Expected: pushed branch ready for PR only after build and UX verification pass.

## Completion Criteria

- Spec review changes are preserved.
- `BI-03AD102F` has evidence recorded.
- Nested map renders from `BusinessCapability` hierarchy.
- Overlay modes work without schema changes.
- Backlog status is included in read model for planning impact.
- Full trace details move from crowded tiles into the selected detail panel.
- Tests, typecheck, production build, and UX verification pass.
