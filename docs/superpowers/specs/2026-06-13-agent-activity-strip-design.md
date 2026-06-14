# Build Studio: AgentActivityStrip — Ambient Task-Level Progress Visibility

**Status:** Approved  
**Date:** 2026-06-13  
**Epic:** EP-BUILD-001 (Build Studio)  
**Scope:** New `AgentActivityStrip` component surfacing real-time agent-level task progress during the Build phase; fleet density bar augmentation; follow-on `ReviewerStatusGrid` shape.  
**Dependencies:** EP-BUILD-001 (Build Studio — implemented), `buildDependencyGraph` (`apps/web/lib/integrate/task-dependency-graph.ts`), `build-progress-update` CustomEvent (emitted by `AgentCoworkerPanel`), `FeatureBuildRow.taskResults` + `buildPlan`

---

## Problem Statement

Build Studio already exposes two visibility layers during an active build:

1. **Phase bar** (StepTracker / PhaseIndicator) — coarse: which of 5 phases.
2. **ProcessGraph** (ReactFlow DAG) — fine: every task node, but requires active navigation (pan, zoom, click).

The gap is an **ambient middle layer**: something readable at a glance without navigation that answers "how many things are running right now, are they making progress, and is anything stuck?"

During the Build phase the orchestrator dispatches 20–50 parallel tasks in dependency waves. Today the operator sees a progress ring (X/Y tasks) and a quiet-agent warning that fires only after a 5-minute stall. There is no compact real-time signal that distinguishes "8 agents pulsing, fast progress" from "0 agents running, stall in progress."

---

## Goals

1. Show every build-phase task as a compact colored cell — done/running/queued/failed — organized by dependency wave.
2. Running cells animate (pulse glow) so motion = momentum; absence of motion = stall.
3. Wave grouping exposes dependency order without requiring the operator to read the ProcessGraph.
4. Zero new server-side plumbing: the component consumes the existing `build-progress-update` CustomEvent and `FeatureBuildRow.taskResults`.
5. Each cell is hoverable (task title tooltip) and click-delegates into the existing task inspector.
6. Renders only when `build.phase === "build"` and `buildPlan.tasks.length >= 5`; hidden otherwise.

## Non-Goals

- Replacing ProcessGraph — the full DAG remains accessible via click-through.
- Showing tasks for phases other than Build (plan tasks, review iterations, ship steps).
- Persistent server-side event recording (CustomEvents are ephemeral; taskResults is the durable signal).
- Fleet density bar and ReviewerStatusGrid (shaped in §6; follow-on slices after this lands).

---

## Research & Benchmarking

**Claude Code Workflow UI** (reference screenshot, 2026-06-13): Compact header chip showing "WorkflowName · N Agents · elapsed" plus a flat grid of 6–8px colored squares. Color distribution (blue vs grey) reads as a health ratio without active focus. This is the direct analogue for the Build phase strip.

**GitHub Actions job matrix**: Grid of job cells per run, colored by status. Established pattern for "many parallel things, one glance."

**Linear cycle boards**: Compact swimlane with per-assignee dot clusters. Closer to the reviewer card pattern (§6.2) than the anonymous grid.

**Adopted from Claude Code UI**: flat grid, square cells, pulsing-color for active, wave/group dividers for structure.  
**Adapted for DPF**: wave labels from `buildDependencyGraph` specialist assignment; hover tooltip with task title; click-delegates into existing `TaskInspector`; respects `--dpf-*` tokens for theme/branding.  
**Rejected**: labelled swim-lanes per specialist (too wide for the space); sparkline timeline (adds temporal axis complexity not needed here).

---

## Design

### §1. Component: `AgentActivityStrip`

**File:** `apps/web/components/build/AgentActivityStrip.tsx`

```
┌─ Agent Activity ─────────────── 23 / 47 tasks · 5 running · 3m 22s ─ [Build Phase] ─┐
│  Wave 1 · Foundation     │  Wave 2 · Components              │  Wave 3 · Testing      │
│  ████████████  (12/12)   │  ████████●●●●●░░░░░░░  (8d 5r 7q) │  ░░░░░░░░░░░░░  (0/15) │
└──────────────────────────────────────────────────────────────────────────────────────┘
  ■ Done  ● Running  ○ Queued  ✕ Failed            Hover for task name · click to inspect
```

Cells: 9×9px, 2px gap, `border-radius: 1.5px`.  
Wave separator: 1px vertical rule `var(--dpf-border)`, 8px margin.  
Header: surface-2 bg, `border-b var(--dpf-border)`.  
Footer: legend + right-aligned hint.

### §2. Cell State Rules

| Priority | Condition | State |
|----------|-----------|-------|
| 1 | `taskResults` has entry for this title AND `testResult.passed === false` | `failed` |
| 2 | `taskResults` has entry for this title (any pass value) | `done` |
| 3 | `activeTaskTitles` Set contains this title | `running` |
| 4 | (none of the above) | `queued` |

`activeTaskTitles` is a local React state populated by:
- `orchestrator:task_dispatched` → add to set
- `orchestrator:task_complete` → remove from set
- `done` → clear set

Filter by `detail.buildId === build.buildId` to prevent cross-build contamination.

### §3. Wave Derivation

```ts
const execPhases = buildDependencyGraph(
  build.buildPlan?.fileStructure,
  build.buildPlan?.tasks ?? [],
);
// Each ExecutionPhase → one WaveGroup
// wave label from specialist of first task in phase:
//   data-architect → "Foundation"
//   software-engineer → "Core Logic"
//   frontend-engineer → "UI Components"
//   qa-engineer → "Testing"
```

`buildDependencyGraph` always appends a QA phase; the strip shows all phases including it.

### §4. Render Gate

```tsx
if (
  build.phase !== "build" ||
  !build.buildPlan?.tasks?.length ||
  build.buildPlan.tasks.length < 5
) return null;
```

### §5. Integration Point in `BuildStudio.tsx`

Insert **after `<AssuranceRow … />` (line 751)** and **before the instruction text div (line 759)**:

```tsx
import { AgentActivityStrip } from "./AgentActivityStrip";

// inside the JSX, after AssuranceRow:
<AgentActivityStrip build={activeBuild} />
```

No other props needed — the component derives everything from `build` and the CustomEvent stream.

### §6. Follow-on Surfaces (shaped here, implemented as separate slices)

#### §6.1 Fleet Density Bar — **Implemented** (`apps/web/components/build/FleetDensityBar.tsx`)

Augment each fleet row's `PhaseMiniRail` with a compact completion-density bar to the right:

```tsx
// In BuildListItem.tsx, immediately after <PhaseMiniRail … />:
{build.phase === "build" && (
  <FleetDensityBar taskResults={build.taskResults} buildPlan={build.buildPlan} />
)}
```

**Divergence from the first draft ("5×5px cells"):** a literal per-task cell grid (20–50 cells) overflows the ≤32px fleet row. The implemented form is a fixed-width (44px) proportional bar that stays bounded regardless of task count while preserving the density-at-a-glance signal. Exact counts live in the tooltip + `aria-label` (`"Tasks: 12 of 47 done, 1 failed"`). The full per-task grid remains available in the main panel via `AgentActivityStrip`.

**Segments:** done (`--dpf-success`) / failed (`--dpf-error`) / remaining (muted track). Fleet rows refresh on the list refetch cycle and do **not** subscribe to `build-progress-update` (subscribing every row would be wasteful), so "running" is not distinguished — it folds into "remaining". The component returns `null` unless `buildPlan.tasks.length > 0`, so the outer `phase === "build"` gate is the only call-site condition.

Data: `FeatureBuildRow.taskResults` (done/failed, deduped by title — last result wins, matching `AgentActivityStrip`'s `resultByTitle` reduction) vs `buildPlan.tasks.length` (denominator, widened to `max(total, done+failed)` so segments never exceed 100%).

#### §6.2 ReviewerStatusGrid

During `review` phase, replace the reviewer list in `WorkflowStageInspector` with named state-coded cards (same `--dpf-*` visual language, larger granularity since reviewer count is 5–8 and identity matters):

```
[EA Architect ✓] [Security ✓] [API Governance ●] [Code Reviewer ✓] [Test Coverage ●] [Accessibility ○]
```

Data: `build.reviewIterations[latest].reviews[].source` (agent display name) + review completion state.

### §7. Animation

Add to `apps/web/app/globals.css`:

```css
@keyframes dpf-cell-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 color-mix(in srgb, var(--dpf-accent) 50%, transparent); }
  55%       { opacity: 0.65; box-shadow: 0 0 0 3px color-mix(in srgb, var(--dpf-accent) 0%, transparent); }
}
```

Applied to running cells via `style={{ animation: "dpf-cell-pulse 1.4s ease-in-out infinite" }}`.

---

## Implementation Plan

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/components/build/AgentActivityStrip.tsx` | Create — full component |
| 2 | `apps/web/app/globals.css` | Add `@keyframes dpf-cell-pulse` |
| 3 | `apps/web/components/build/BuildStudio.tsx` | Import + render `<AgentActivityStrip build={activeBuild} />` after AssuranceRow |
| 4 | `apps/web/components/build/AgentActivityStrip.test.tsx` | Unit tests: wave derivation, cell state priority, render gate |

Follow-on (separate PRs):
- ~~`FleetDensityBar` in `BuildListItem.tsx`~~ — **done** (§6.1): `FleetDensityBar.tsx` + `FleetDensityBar.test.tsx`, wired into the fleet row.
- `ReviewerStatusGrid` in `WorkflowStageInspector.tsx`
