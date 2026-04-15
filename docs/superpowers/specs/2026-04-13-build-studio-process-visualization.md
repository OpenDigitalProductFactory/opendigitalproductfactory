# Build Studio Process Visualization — Design Spec

**Date:** 2026-04-13
**Status:** Ready for planning
**Epic:** EA / Architecture Tool

---

## Problem

The Build Studio's `PhaseIndicator` shows five numbered circles connected by lines. It tells you *which phase* the build is in. It does not show:

- Which tasks are running right now (and which agent is doing the work)
- Which tasks run in parallel vs sequentially
- What finished and what it produced
- The causal chain: schema first, then API, then frontend, then QA
- Whether the active work is being done by an AI coworker, platform automation, or a human-in-the-loop gate

The data to answer all of these questions already exists in the codebase. `buildDependencyGraph()` computes parallel/sequential execution phases. `FeatureBuildRow.taskResults` tracks per-task completion. `phaseHandoffs` records the agent handoff chain. None of it is visualized.

The result: users experience the build as a black box. A spinning indicator. Trust without understanding.

---

## Goal

Replace the primitive phase indicator with a **make.com-style live process graph** that shows the build pipeline as a spatial canvas — phases as nodes, actors as provenance-aware labels, dependencies as animated edges. The canvas updates in real-time as agents complete tasks. Users see causality, not just progress.

Separately, unlock three dormant EA modeling features that are built but disabled (BPMN node rendering, new view creation, traversal execution UI).

---

## Design Vocabulary

### Inspiration

- **make.com**: Signal discipline (icon-only nodes), flowing edge animation (stroke-dasharray), slides-in inspector, horizontal = sequential / branching = routing
- **GitHub Actions**: Fork-join circles for parallelism, column layout encodes execution order
- **n8n**: Per-node status badges (checkmark count, error dot), no content obscured by spinners

### The Core Metaphor

> The canvas shows the system state, not the user's request.

Each node represents a unit of work an AI specialist performs. When the Data Architect is writing the schema, that node pulses. When done, the glow travels along the edge to the Software Engineer node. The user watches work happen, not a progress bar fill.

---

## Two-Level Graph Architecture

### Level 1 — Phase Graph (always visible)

Shows the 5 phases as large nodes with left-to-right flow:

```
[Ideate] ──► [Plan] ──► [Build] ──► [Review] ──► [Ship]
```

Each `PhaseNode` (200×90px) shows:
- Phase name + emoji icon
- Active actor label + provenance badge (`AI coworker`, `System`, or `HITL gate`)
- Status badge (pending / running / done / failed)
- Duration when complete (from handoff timestamps)

Status states:
- **Pending**: 40% opacity, `var(--dpf-border)` border, no animation
- **Running**: Phase-color pulsing border ring (`box-shadow` keyframe animation), animated incoming edge
- **Done**: Solid phase-color border, green ✓ badge (top-right, 16px circle)
- **Failed**: Red (`#f87171`) border, red ✗ badge, red incoming edge

Derives phase status from `FeatureBuildRow.phase` + `phaseHandoffs`:
- A phase is **done** if a handoff exists with that phase as `fromPhase`
- A phase is **running** if it equals `build.phase`
- A phase is **failed** if `build.phase === "failed"` and it is the last visible phase without an outbound handoff
- A phase is **pending** otherwise

**This replaces `PhaseIndicator`** as the primary progress UI in Build Studio.

### Level 2 — Task Graph (visible when Build phase is active or complete)

Rendered as an expandable panel below the Phase Graph, or as a zoom-in region within the Build node. Shows the dependency graph produced by `buildDependencyGraph(build.buildPlan.fileStructure, build.buildPlan.tasks)`.

Layout rules:
- Each `ExecutionPhase` → one column, columns spaced 120px apart (left-to-right)
- `parallel: false` → single `TaskNode` in the column
- `parallel: true` → fork circle → N stacked `TaskNode`s (16px gap) → join circle

`TaskNode` (200×72px) shows:
- Specialist role icon (left, 16px) + task title (11px semibold, 2-line max)
- Specialist badge: role name + file count (10px, muted, bottom)
- Status badge (top-right): spinner keyframe when running, ✓ green when done, ✗ red when error
- Border: role color (see constants below)

`ForkJoinNode`: 16px circle, no label, role color of the phase. Connects with the same animated edges.

**Task status — actual runtime data shape:**

The Prisma column `taskResults` is `Json?`. The orchestrator (`build-orchestrator.ts`) stores:

```typescript
type StoredTaskResults = {
  completedTasks: number;
  totalTasks: number;
  timedOut: boolean;
  tasks: Array<{ title: string; specialist: string; outcome: string; durationMs: number }>;
  timestamp: string;
};
```

`outcome` values: `"DONE"` | `"DONE_WITH_CONCERNS"` | `"FAILED"` | other error strings.

**Normalization layer (required):**

Do not let `ProcessGraph` or the graph builder read the raw `taskResults` JSON shape directly. Introduce a small normalization step that converts `FeatureBuildRow` + transient relay events into a graph-ready snapshot:

```typescript
type ProcessActorKind = "ai_coworker" | "system" | "human_hitl" | "review_gate";

type NormalizedStoredTaskResult = {
  title: string;
  specialist: string;
  outcome: string;
  durationMs: number;
};

type NormalizedBuildProcessSnapshot = {
  storedTaskResults: Map<string, NormalizedStoredTaskResult>;
  activeTaskTitles: Set<string>;
  taskActors: Map<string, { kind: ProcessActorKind; label: string }>;
  phaseActors: Map<BuildPhase, { kind: ProcessActorKind; label: string }>;
};
```

Normalization rules:

1. Read raw `build.taskResults` as the stored object shape from the orchestrator and convert `tasks[]` into `Map<title, NormalizedStoredTaskResult>`.
2. Maintain transient `activeTaskTitles` from relay events so multiple parallel tasks can render as running at the same time.
3. Assign actor provenance explicitly:
   - Dependency-graph task nodes are `ai_coworker`; label from the specialist role (`Data Architect`, `Software Engineer`, etc.)
   - Exec step strip is `system`
   - Human checkpoints are `human_hitl` only when sourced from an explicit user action record
   - When the process is waiting for review/approval but the actor identity is not explicit in the current payload, render `review_gate` with label `Review gate` rather than fabricating a human name

What normalization gives us:

- A stable UI contract even if the DB storage shape changes again
- One place to reconcile DB snapshots with live relay events
- A reliable way to show AI coworker work versus system automation versus HITL gates
- Cleaner tests for the graph builder, because it can operate on one normalized snapshot instead of mixed raw payloads

**Status derivation (match by `title`, not `taskIndex`):**

- **done**: `normalized.storedTaskResults.get(task.title)` exists AND `outcome === "DONE" || outcome === "DONE_WITH_CONCERNS"`
- **error**: normalized match found AND outcome is neither DONE variant
- **running**: `build.phase === "build"` AND no normalized stored result exists AND `normalized.activeTaskTitles.has(task.title)`
- **pending**: `build.phase !== "build"` or task has unsatisfied predecessors

**Live "running" status — relay path fix required:**

`AgentCoworkerPanel.tsx` emits `orchestrator:task_dispatched` to its internal `buildTasks` state (line 163) but does NOT relay it via `build-progress-update` to `BuildStudio`. The relay list (line 240) is: `["phase:change", "evidence:update", "sandbox:ready", "orchestrator:task_complete", "done"]`.

Fix: add `"orchestrator:task_dispatched"` to the relay list. `ProcessGraph` then listens for `build-progress-update` events directly, extracts `taskTitle` from `orchestrator:task_dispatched` payloads, and stores it in `activeTaskTitles`. Remove titles from that set on `orchestrator:task_complete`, `done`, or full DB refetch. This lets multiple parallel task nodes render as "running" before the DB snapshot updates.

### Level 3 — Exec Step Strip (sub-micro, inside Build node context)

Compact horizontal strip showing `BuildExecStep` infra progress. `STEP_ORDER` has 8 entries including `pending` and `complete`/`failed` terminal states. Show only the 6 visible infra steps: `sandbox_created → workspace_initialized → db_ready → deps_installed → code_generated → tests_run`. Uses `build.buildExecState.step` for current position — 6 dots. Remains as a detail row within the Build phase context (not the main canvas).

---

## Node & Edge Specifications

### Role Colors

```typescript
const ROLE_COLOURS: Record<SpecialistRole, string> = {
  "data-architect":   "#38bdf8",  // plan blue
  "software-engineer":"#4ade80",  // ship green
  "frontend-engineer":"#a78bfa",  // ideate purple
  "qa-engineer":      "#fbbf24",  // build amber
};
```

### Role Icons (text emoji, no external assets)

```typescript
const ROLE_ICONS: Record<SpecialistRole, string> = {
  "data-architect":    "◈",
  "software-engineer": "⌨",
  "frontend-engineer": "◻",
  "qa-engineer":       "✓",
};
```

### Phase Icons

```typescript
const PHASE_ICONS: Record<BuildPhase, string> = {
  ideate:   "◈",
  plan:     "▤",
  build:    "⚙",
  review:   "◎",
  ship:     "▶",
  complete: "✓",
  failed:   "✗",
};
```

### Edge Design

Custom ReactFlow edge type `animatedFlow`:
- SVG `<path>` with `stroke-dasharray="8 4"` 
- CSS animation `@keyframes dash { to { stroke-dashoffset: -36; } }` at 1s linear infinite
- Color: `var(--dpf-border)` when pending, role/phase color when running, phase color at 60% when done
- Stroke width: 2px base, 3px when source node is running
- Red when target node has error
- Arrow marker at target end (built-in ReactFlow `MarkerType.ArrowClosed`)

### Status Colors

Use the established platform pattern from `DelegationChainView.tsx` — CSS variable with hardcoded fallback:

- Done badge: `var(--dpf-success, #22c55e)`
- Error badge: `var(--dpf-error, #ef4444)`
- Running ring: role/phase color constant (data-vocabulary, not a theme color — same pattern as `PHASE_COLOURS`)
- Structural colors (borders, backgrounds, overlays): always `var(--dpf-*)` with no fallback

Role and phase identity colors (`ROLE_COLOURS`, `PHASE_COLOURS`) are data-vocabulary constants, not theme colors. They follow the same pattern as the existing `PHASE_COLOURS` in `feature-build-types.ts` and require no CSS-variable wrapping.

### Inspector Panel

`TaskInspector` (320px, slides in from right, `translateX` transition 200ms):

- Header: role icon + task title + status badge
- Files list: each `PlanFileEntry` as a row with `action` badge (create/modify) + truncated path
- Task details: `task.implement` description
- If done: `outcome` label + `durationMs` formatted as human time (from `StoredTaskResults`)
- If error: outcome string as error message
- Canvas dims 15% (`pointer-events: none` overlay at 0.15 opacity) when panel open

---

## Animation Implementation (CSS, no JS)

All animations are CSS keyframes, not JS intervals. ReactFlow node data carries the `status` string; the CSS class (or inline `style`) derives from it. React re-renders update the class; CSS handles the visual transition.

```css
/* Pulsing border ring — applied to running nodes */
@keyframes pulse-ring {
  0%   { box-shadow: 0 0 0 0 color; }
  50%  { box-shadow: 0 0 0 4px color-at-25%-opacity; }
  100% { box-shadow: 0 0 0 0 color; }
}

/* Traveling edge dash */
@keyframes dash-travel {
  to { stroke-dashoffset: -36; }
}
```

Both are defined in a `process-graph.css` file imported by `ProcessGraph.tsx`.

---

## Integration with Existing Update Channels

`BuildStudio.tsx` already has three update channels:
1. `build-progress-update` DOM CustomEvent (primary, instant)
2. SSE thread fallback
3. DB polling fallback

All three call `debouncedRefetch()` → `getFeatureBuild(buildId)` → `setActiveBuild(fresh)`.

The `ProcessGraph` receives `build: FeatureBuildRow` as a prop. When `BuildStudio` calls `setActiveBuild(fresh)`, React re-renders `ProcessGraph` with the new build. Before building nodes and edges, `ProcessGraph` normalizes the raw build payload plus transient relay state into `NormalizedBuildProcessSnapshot`. The graph builder consumes that normalized snapshot, not the raw `taskResults` payload directly.

**One relay path change is required** (see EA Quick Unlocks 2A): `AgentCoworkerPanel` must add `"orchestrator:task_dispatched"` to its `RELAY_TYPES` list so that `ProcessGraph` can capture live running-task state for the normalized snapshot.

---

## EA Quick Unlocks (Phase 2)

These ship independently as small changes, not coupled to the Process Graph work.

### 2A — Relay `orchestrator:task_dispatched`

`AgentCoworkerPanel.tsx` line 240 lists `RELAY_TYPES` for events forwarded as `build-progress-update` DOM events. `orchestrator:task_dispatched` is handled internally (updates `buildTasks` state) but is **not** relayed to `BuildStudio`. Add it to `RELAY_TYPES`. `ProcessGraph` then reads the `detail.taskTitle` from `build-progress-update` events and updates `activeTaskTitles` in the normalized snapshot.

### 2B — New View Creation

`ea/page.tsx` has two locations that need the button:

1. The button row above the view grid (currently has a disabled `<button>`)
2. The empty-state branch (line 104-106: "No views yet. Views will appear here once...") — currently has no button at all

Both locations should render `<CreateViewButton />`.

`createEaView` already exists in `ea.ts` but with the wrong signature (`notationId`, returns `void`). Replace it with a version that accepts `notationSlug`, runs the notation lookup internally, and returns `{ id: string } | { error: string }`. The notation select should use slug `"archimate4"` and `"bpmn20"` (not `"bpmn2"` — that is not a seeded slug; the seeded BPMN notation is `bpmn20` per `seed-ea-cross-notation.ts`).

`updateEaView` references the deleted `CreateEaViewInput` type — replace its parameter with an inline type.

### 2C — Run Traversal Panel

Add a collapsible "Run Traversal" section to `ElementInspector.tsx`. Requires a new server action wrapper `apps/web/lib/actions/ea-traversal.ts` that:

1. Calls `requireManageEaModel()` before any data access (matches auth pattern in `ea.ts`)
2. Wraps `prisma.eaTraversalPattern.findMany()` filtered by the **view's** notation slug (not hardcoded `"archimate4"`)
3. Re-exports `runTraversalPattern` with the same auth gate

Results rendered as a path list: element name → relationship type → element name.

---

## What Does NOT Change

- `PhaseIndicator.tsx` kept as a compact fallback for mobile or when graph is collapsed
- All existing EA canvas functionality (drag, drop, connect, save, zoom, minimap)
- `buildDependencyGraph()` — no changes to the pure function
- No DB schema changes for Build Studio Phase 1
- `FeatureBuildRow` does not need new persisted fields for Phase 1; the graph uses an internal normalization layer instead
- No new npm packages
- `EaCanvas.tsx` NODE_TYPES — no change needed; BPMN rendering is already handled inside `EaElementNode` via `neoLabel.startsWith("BPMN__")` dispatch (confirmed in `EaElementNode.tsx:84`)

---

## Success Criteria

1. Build Studio shows a left-to-right phase graph replacing the circular stepper
2. During Build phase, task dependency graph is visible with specialist-colored nodes
3. Nodes animate (pulse ring) when running, transition to static done/error state
4. Edges animate (traveling dash) when source is running, static when done
5. Clicking a task node slides in an inspector panel showing task details, files, and outcome
6. Task "running" status updates live when `orchestrator:task_dispatched` fires, including parallel tasks
7. "+ New View" button in EA is enabled in both the view grid header AND the empty-state branch
8. New view creation accepts `archimate4` and `bpmn20` notation slugs correctly
9. Traversal panel in ElementInspector is auth-gated via `requireManageEaModel()`
10. Process graph distinguishes `AI coworker`, `System`, and `HITL gate` actors without inventing human identities not present in the data
11. All changes pass `pnpm tsc --noEmit` and existing test suite
12. Production build succeeds: `cd apps/web && pnpm next build` (required gate before claiming done)
