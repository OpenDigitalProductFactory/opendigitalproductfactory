# Business OS Command Center Implementation Plan

| Field | Value |
|-------|-------|
| Status | **Executed.** First slice shipped in commit `74d98668`. Plan retained as the durable record of decisions, file structure, and verification steps. |
| Spec | [`2026-05-15-business-os-command-center-design.md`](../specs/2026-05-15-business-os-command-center-design.md) |
| Surface | `/workspace` → [BusinessCommandCenter](../../../apps/web/components/workspace/BusinessCommandCenter.tsx) over [loadWorkspaceCommandCenter](../../../apps/web/lib/workspace/command-center.ts) |

> **For agentic workers (re-running or extending this plan):** Use the `superpowers:executing-plans` skill (or `superpowers:subagent-driven-development` when subagents are explicitly available). Steps use checkbox (`- [ ]`) syntax for tracking. Since the first slice has shipped, treat each task as a re-runnable verification gate rather than a from-scratch implementation step.

**Goal:** Redesign `/workspace` into a Business Operating System command center that shows cross-business state, human plus AI work in motion, and six-C readiness without adding new schema.

**Architecture:** Extract the existing workspace page data gathering into a pure server projection helper, derive six-C readiness from current DPF records, and render a compact command-center component above the existing workspace sections. Keep AI Operations as the drill-down, not a duplicate surface.

**Tech Stack:** Next.js 16 App Router, React server components, Prisma via `@dpf/db`, Vitest, Testing Library where needed, DPF CSS custom properties.

---

## Constraints

- Work in an isolated worktree and do not touch unrelated root changes.
- Use TDD: write failing tests before production code.
- No Prisma migrations in this slice.
- No new route. The primary surface is `apps/web/app/(shell)/workspace/page.tsx`.
- No hardcoded gray/white/black/hex colors in new UI. Use `var(--dpf-*)`.
- Keep `/platform/ai/operations-map` as the AI diagnostic drill-down.
- Run `pnpm --filter web typecheck` before final handoff.
- For UI work, exercise `/workspace` against the running portal after login.

## File Structure

**Create**

- `apps/web/lib/workspace/command-center.ts`
  - Server-side DTO types and projection helpers for the command center.
  - Pure derivation functions for six-C readiness.
  - Prisma-backed loader function for the page.
- `apps/web/lib/workspace/command-center.test.ts`
  - Unit tests for readiness derivation, empty states, confidence/containment routing, and command strip prioritization.
- `apps/web/components/workspace/BusinessCommandCenter.tsx`
  - Presentational component for command strip, operating snapshot, six-C readiness matrix, and work-in-motion strip.
- `apps/web/components/workspace/BusinessCommandCenter.test.tsx`
  - Render tests for the component with a minimal DTO.

**Modify**

- `apps/web/app/(shell)/workspace/page.tsx`
  - Replace inline metric fetching with `loadWorkspaceCommandCenter`.
  - Render `BusinessCommandCenter` before existing workspace sections.
  - Keep `WorkspaceTiles`, `WorkspaceCalendar`, and `ActivityFeed` below the command center.
- `apps/web/components/workspace/ActivityFeed.tsx`
  - Only if required to remove hardcoded status-color leakage on the touched path.

## Chunk 1: Projection Contract

### Task 1: Define Six-C DTO Behavior

**Files:**
- Create: `apps/web/lib/workspace/command-center.test.ts`
- Create: `apps/web/lib/workspace/command-center.ts`

- [ ] **Step 1: Write the failing readiness derivation tests**

Create tests for:

```ts
import { describe, expect, it } from "vitest";
import { deriveReadinessCell, deriveContainmentState } from "./command-center";

describe("workspace command center readiness", () => {
  it("marks confidence as attention when evidence is stale or missing", () => {
    const cell = deriveReadinessCell("confidence", {
      hasFreshEvidence: false,
      hasActiveConnection: true,
      hasActor: true,
      hasCadence: true,
      hasContainment: true,
    });
    expect(cell.state).toBe("attention");
    expect(cell.key).toBe("confidence");
    expect(cell.label).toBeTruthy();
  });

  it("marks containment as blocked when an action-capable signal lacks approval or route scope", () => {
    expect(
      deriveContainmentState({
        hasSideEffectAction: true,
        hasApprovalPath: false,
        hasRouteScope: true,
      }),
    ).toBe("blocked");
  });

  it("emits unknown rather than synthesizing a default for missing-signal cells", () => {
    expect(deriveReadinessCell("cadence", {}).state).toBe("unknown");
  });
});
```

These tests exercise every field of the `ReadinessCell` DTO (`key`, `state`, `label`) and pin the spec's "emit `unknown` rather than default" rule from §"Readiness State Taxonomy".

- [ ] **Step 2: Run the tests to verify RED**

Run:

```powershell
pnpm --filter web exec vitest run lib/workspace/command-center.test.ts
```

Expected: FAIL because `command-center.ts` does not exist.

- [ ] **Step 3: Add minimal DTOs and pure derivation functions**

In `command-center.ts`, add:

```ts
export type SixCKey =
  | "context"
  | "connections"
  | "capabilities"
  | "cadence"
  | "confidence"
  | "containment";

export type ReadinessState = "good" | "attention" | "blocked" | "unknown";

export type ReadinessSignalInput = {
  hasFreshEvidence?: boolean;
  hasActiveConnection?: boolean;
  hasActor?: boolean;
  hasCadence?: boolean;
  hasContainment?: boolean;
};

export type ReadinessCell = {
  key: SixCKey;
  state: ReadinessState;
  label: string;
  href?: string;
};
```

Implement the smallest rule set:

- `context`: `good` when `hasFreshEvidence`, else `attention`.
- `connections`: `good` when `hasActiveConnection`, else `attention`.
- `capabilities`: `good` when `hasActor`, else `blocked`.
- `cadence`: `good` when `hasCadence`, else `unknown`.
- `confidence`: `good` when `hasFreshEvidence`, else `attention`.
- `containment`: `good` when `hasContainment`, else `blocked`.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
pnpm --filter web exec vitest run lib/workspace/command-center.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/workspace/command-center.ts apps/web/lib/workspace/command-center.test.ts
git commit -s -m "feat(workspace): add command center readiness model"
```

### Task 2: Add Workspace Projection Loader

**Files:**
- Modify: `apps/web/lib/workspace/command-center.ts`
- Modify: `apps/web/lib/workspace/command-center.test.ts`

- [ ] **Step 1: Write tests for the view DTO shape**

Add tests for a pure `buildWorkspaceCommandCenterView(input)` function. It should:

- sort command-strip items by severity
- include six readiness cells for every domain row
- include an AI work-in-motion item when active task runs exist
- include an empty state when no active work exists

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm --filter web exec vitest run lib/workspace/command-center.test.ts
```

Expected: FAIL because `buildWorkspaceCommandCenterView` is missing.

- [ ] **Step 3: Implement pure builder and loader shell**

Add DTOs:

```ts
export type CommandSeverity = "critical" | "warning" | "info";

export type CommandCenterItem = {
  id: string;
  label: string;
  description: string;
  severity: CommandSeverity;
  href: string;
};

export type BusinessDomainReadiness = {
  id: string;
  label: string;
  href: string;
  cells: ReadinessCell[];
};

export type WorkInMotionItem = {
  id: string;
  label: string;
  actor: string;
  status: string;
  href: string;
};

export type WorkspaceCommandCenterView = {
  commandStrip: CommandCenterItem[];
  snapshot: Array<{ label: string; value: string | number; href: string }>;
  readiness: BusinessDomainReadiness[];
  workInMotion: WorkInMotionItem[];
};
```

Add `loadWorkspaceCommandCenter(prisma, userContext)` as a thin async wrapper. Keep most derivation in pure helpers so tests do not need a database.

- [ ] **Step 4: Move current page metrics into the loader**

Move the existing counts from `page.tsx` into the loader in small groups:

- business inventory counts
- AI provider and agent counts
- backlog and build counts
- compliance counts
- finance counts
- coworker/task/proposal counts

Keep the existing calendar and activity-feed fetches in the page for now unless the test seam becomes cleaner by moving them.

- [ ] **Step 5: Run projection tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/workspace/command-center.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/workspace/command-center.ts apps/web/lib/workspace/command-center.test.ts
git commit -s -m "refactor(workspace): extract command center projection"
```

> Note: `page.tsx` is intentionally **not** staged here. Page integration happens in Task 4. Staging it now would either be a no-op (no changes in this task) or — worse, in a concurrent-session setup — would sweep in another worktree's unrelated edits. See the worktree-per-session and `git commit --only` discipline in [AGENTS.md](../../../AGENTS.md).

## Chunk 2: Command Center UI

### Task 3: Add Presentational Component Tests

**Files:**
- Create: `apps/web/components/workspace/BusinessCommandCenter.test.tsx`
- Create: `apps/web/components/workspace/BusinessCommandCenter.tsx`

- [ ] **Step 1: Write a render test**

Test that a fixture view renders:

- "Command Center"
- one command-strip item
- all six C labels
- one work-in-motion item
- the AI Operations Map link

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm --filter web exec vitest run components/workspace/BusinessCommandCenter.test.tsx
```

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement minimal component**

Build the component as a quiet operational dashboard:

- command strip at top
- compact snapshot row
- readiness matrix table
- work-in-motion strip
- drill links to source routes

Use fixed responsive layout constraints:

- `grid`
- `minmax(0, 1fr)`
- table cells with stable min widths
- no font-size scaling with viewport width
- no card-inside-card nesting

Use DPF tokens only:

- `text-[var(--dpf-text)]`
- `text-[var(--dpf-muted)]`
- `bg-[var(--dpf-surface-1)]`
- `bg-[var(--dpf-surface-2)]`
- `border-[var(--dpf-border)]`

- [ ] **Step 4: Run component test**

Run:

```powershell
pnpm --filter web exec vitest run components/workspace/BusinessCommandCenter.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Search for prohibited color classes in the new component**

Run:

```powershell
rg -n "text-gray-|bg-gray-|border-gray-|text-white|text-black|#[0-9a-fA-F]{3,6}" apps/web/components/workspace/BusinessCommandCenter.tsx
```

Expected: no matches. All colors must come from `var(--dpf-*)` tokens; `text-white`/`text-black`/`text-gray-*` are not allowed in this component.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/components/workspace/BusinessCommandCenter.tsx apps/web/components/workspace/BusinessCommandCenter.test.tsx
git commit -s -m "feat(workspace): render business command center"
```

### Task 4: Integrate Into `/workspace`

**Files:**
- Modify: `apps/web/app/(shell)/workspace/page.tsx`
- Modify: `apps/web/app/(shell)/workspace/page.test.tsx`

- [ ] **Step 1: Extend page tests**

`apps/web/app/(shell)/workspace/page.test.tsx` already exists as a narrow smoke test. Add a single assertion that the page module can be imported without throwing (this catches the most common server-component breakage from loader refactors). Do not attempt full server-component rendering — coverage for command-center behavior lives in `command-center.test.ts` and `BusinessCommandCenter.test.tsx`.

- [ ] **Step 2: Verify the test runs**

Run:

```powershell
pnpm --filter web exec vitest run 'app/(shell)/workspace/page.test.tsx'
```

Expected: PASS. (The intent of this step is to confirm the import-time smoke test exercises the new loader path. If it fails, the loader's transitive imports are the most likely cause — fix before continuing.)

- [ ] **Step 3: Render `BusinessCommandCenter` above existing sections**

In `page.tsx`:

- call `loadWorkspaceCommandCenter`
- render `<BusinessCommandCenter view={commandCenter} />` after the page title
- keep `AttentionStrip`, existing workspace sections, calendar, and activity feed below until product review validates removal or consolidation
- remove duplicated inline metrics that moved to the loader

- [ ] **Step 4: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/workspace/command-center.test.ts components/workspace/BusinessCommandCenter.test.tsx 'app/(shell)/workspace/page.test.tsx'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add 'apps/web/app/(shell)/workspace/page.tsx' 'apps/web/app/(shell)/workspace/page.test.tsx'
git commit -s -m "feat(workspace): make home a business command center"
```

## Chunk 3: Polish And Verification

### Task 5: Clean Touched UI Styling

**Files:**
- Modify: `apps/web/components/workspace/ActivityFeed.tsx` only if touched or if the command-center path imports hardcoded color state from it.

- [ ] **Step 1: Search touched workspace files for hardcoded theme violations**

Run:

```powershell
rg -n "text-gray-|bg-gray-|border-gray-|text-white|text-black|#[0-9a-fA-F]{3,6}" 'apps/web/app/(shell)/workspace' apps/web/components/workspace apps/web/lib/workspace
```

Expected: no matches in new/touched code. Existing unrelated status colors in `activity-feed-data.ts` can be logged as separate cleanup if not touched.

- [ ] **Step 2: If needed, write a focused test or snapshot for tokenized status rendering**

Only do this if `ActivityFeed.tsx` changes. Do not broaden scope into all historical status-color cleanup.

- [ ] **Step 3: Commit any styling cleanup**

```powershell
git add apps/web/components/workspace/ActivityFeed.tsx
git commit -s -m "fix(workspace): align activity feed styling with theme tokens"
```

Skip this commit if no styling cleanup was needed.

### Task 6: Full Verification

**Files:**
- No source edits unless verification exposes a bug.

- [ ] **Step 1: Run focused tests**

```powershell
pnpm --filter web exec vitest run lib/workspace/command-center.test.ts components/workspace/BusinessCommandCenter.test.tsx 'app/(shell)/workspace/page.test.tsx'
```

Expected: PASS.

- [ ] **Step 2: Run web typecheck**

```powershell
pnpm --filter web typecheck
```

Expected: PASS. Fix any errors before continuing.

- [ ] **Step 3: Run production build**

```powershell
pnpm --filter web build
```

Expected: PASS, or document pre-existing unrelated failure with exact output and fix if feasible.

- [ ] **Step 4: UX verification**

Use the production-served portal per `AGENTS.md`:

1. Read `ADMIN_PASSWORD` from repo-root `.env`.
2. Open the configured `AUTH_URL` or `APP_URL`.
3. Login as `admin@dpf.local`.
4. Visit `/workspace`.
5. Verify first viewport shows:
   - command strip
   - operating snapshot
   - six-C readiness matrix
   - human plus AI work in motion
   - links to AI Operations Map and source routes
6. Check mobile and desktop widths for overlap.
7. Check browser console for runtime errors.

- [ ] **Step 5: Commit verification fixes**

Only if fixes were required:

```powershell
git add <changed-files>
git commit -s -m "fix(workspace): stabilize command center verification"
```

## Completion Checklist

Procedural:

- [ ] Design spec exists at [`docs/superpowers/specs/2026-05-15-business-os-command-center-design.md`](../specs/2026-05-15-business-os-command-center-design.md)
- [ ] Implementation plan exists at [`docs/superpowers/plans/2026-05-15-business-os-command-center.md`](2026-05-15-business-os-command-center.md)
- [ ] First implementation slice has no schema migration
- [ ] Tests pass (`command-center.test.ts`, `BusinessCommandCenter.test.tsx`, `page.test.tsx`)
- [ ] Typecheck passes (`pnpm --filter web typecheck`)
- [ ] Production build passes or a pre-existing blocker is documented
- [ ] `/workspace` verified in browser
- [ ] Branch has only command-center files staged/committed

Spec acceptance — each item maps to a numbered bullet in the spec's "First Implementation Slice" section:

- [ ] `/workspace` first viewport renders Command Strip, Operating Snapshot, Six-C Readiness Matrix, and Human plus AI Work In Motion
- [ ] Every displayed signal links to a source route or explicitly emits the `unknown` readiness state (per spec §"Readiness State Taxonomy")
- [ ] Confidence and containment cells render for AI-driven or automation-driven signals
- [ ] AI Operations Map is linked from the surface, not duplicated
- [ ] Only `var(--dpf-*)` styling tokens are used in new components (verified by the rg sweep in Task 5 Step 1)
- [ ] Unit tests cover six-C derivation for all four states (`good`, `attention`, `blocked`, `unknown`) including empty-state behavior
