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

#### §6.2 ReviewReadinessStrip — **Implemented** (`apps/web/components/build/ReviewReadinessStrip.tsx`)

> **Correction (substrate verification):** the first draft below assumed a roster of named reviewers, each with its own persisted `source` + completion state (`build.reviewIterations[latest].reviews[].source`). **That field does not exist, and that data is not persisted.** The build review system runs two reviewers + an advisory architecture lens and **`mergeReviews()` collapses them into a single `ReviewResult`** ([build-reviewers.ts](../../../apps/web/lib/integrate/build-reviewers.ts)); individual reviewer identity is gone by the time the row is stored. There is also no "reviewer list" in `WorkflowStageInspector` to replace. Rendering named cards would mean **fabricating reviewer names/states in the UI** — a violation of the evidence-is-the-report rule. The original sketch is retained here only as the rejected design:
>
> ~~`[EA Architect ✓] [Security ✓] [API Governance ●] [Code Reviewer ✓] [Test Coverage ●] [Accessibility ○]`~~

**What shipped instead:** a strip of state-coded **review-lens** chips, each backed by a field that is actually stored on the row. Added to `WorkflowStageInspector` between "What Happened" and "Next Approval", gated to `phase === "review"`. Lens derivation is a pure, unit-tested function ([review-lenses.ts](../../../apps/web/lib/build/review-lenses.ts)):

| Lens | Source field | States |
|------|-------------|--------|
| Checklist review | `planReview ?? designReview` → `decision`, `issues[].severity`, `iteration.round`/`oscillating`, `parseError` | pass · fail · pending |
| Architecture (advisory) | `ReviewResult.architectureAdvisory` (omitted if absent) | advisory |
| Code review | `taskResults[].codeReview.decision` rolled up (omitted if no tasks) | pass · fail |
| UX checks | `uxTestResults[]` (omitted if none) | pass · fail |
| Verification | `verificationOut` (typecheck + tests) | pass · fail · pending |
| Acceptance | `acceptanceMet[]` (omitted if none) | pass · partial |

Checklist + Verification are the always-on spine (render even when pending); the other four are omitted entirely when their backing artifact is absent, so **no chip ever shows without evidence**. State is conveyed by colour **and** glyph **and** text (WCAG 1.4.1); each chip carries an `aria-label` of `"<lens>: <state> — <detail>"`. The section header shows an `N/M cleared · K blocking` roll-up. DPF token-only.

#### §6.2a Graduation: per-reviewer verdicts — **Implemented** (server-side persistence)

The "heavier alternative" flagged above shipped: individual reviewer verdicts are now **persisted**, so the merged Checklist chip graduates into **one chip per named reviewer**. Substrate verification ([build-reviewers.ts](../../../apps/web/lib/integrate/build-reviewers.ts), [mcp-tools.ts](../../../apps/web/lib/mcp-tools.ts) review tools) established the **complete, real roster** — there is no security/governance/accessibility reviewer as a distinct agent:

| Reviewer (`source`) | Label | Role | Gates? |
|---|---|---|---|
| `reviewer-1` | Primary review | reviewer | yes (via merge) |
| `reviewer-2` | Independent review (focus: security, edge cases, a11y / task completeness) | reviewer | yes (via merge) |
| `architect` | Architecture | architect | no — advisory |

Mechanism (no migration — JSON column, like `architectureAdvisory`):

1. `collectReviewerVerdicts(r1, r2, archReview)` captures each reviewer's `{ source, label, role, decision, issueCounts, parseError? }` **before** `mergeReviews()` collapses them — the same `r1`/`r2`/`archReview` the deliberation trail already consumes, so verdicts and the deliberation branches name reviewers identically.
2. The MCP `reviewDesignDoc` / `reviewBuildPlan` tools nest the array on `ReviewResult.reviewers` at the existing persist sites.
3. `deriveReviewLenses` expands `reviewers[]` into per-reviewer chips when present (architect → always `advisory`; a `parseError` verdict → `pending`/"unavailable", never a false pass), and **falls back** to the merged Checklist + Architecture lenses for rows reviewed before this shipped.

Verification of the full path (review runs → `reviewers[]` persisted → named chips render) is deferred to a live Build Studio install per the operator's standing constraint; unit coverage (`collectReviewerVerdicts`, graduation, fallback) is in place.

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
- ~~`ReviewerStatusGrid` in `WorkflowStageInspector.tsx`~~ — **done** (§6.2), reshaped to `ReviewReadinessStrip` after substrate verification showed the per-reviewer roster is not persisted: `ReviewReadinessStrip.tsx` + `lib/build/review-lenses.ts`, driven by stored review evidence.

All three follow-on surfaces from §6 are now implemented. The spec is fully realized.
