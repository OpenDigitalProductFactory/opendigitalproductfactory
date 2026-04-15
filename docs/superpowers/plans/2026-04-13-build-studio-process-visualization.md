# Build Studio Process Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Build Studio's linear phase indicator with a make.com-style live process graph showing phases, parallel task groups, specialist roles, and animated status — all derived from data that already exists.

**Architecture:** Pure graph builder function (`process-graph-builder.ts`) transforms `FeatureBuildRow` → ReactFlow nodes+edges. `ProcessGraph.tsx` renders the ReactFlow canvas with custom node/edge types. `BuildStudio.tsx` wires the existing `build-progress-update` event to re-render the graph via `setActiveBuild`. Phase 2 unlocks the two remaining EA items that are still dormant: new view creation and traversal execution UI. BPMN rendering already works through `EaElementNode`'s internal dispatch and does not need a `NODE_TYPES` registry change.

**Spec:** `docs/superpowers/specs/2026-04-13-build-studio-process-visualization.md`

**Tech Stack:** @xyflow/react v12.10.1 (already installed), TypeScript strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `moduleResolution: "bundler"`), CSS keyframe animations (no JS timers for animation), theme-aware CSS variables (light/dark/branding token compatible via `var(--dpf-*)` tokens).

---

## Codebase Context

**Read these files before starting:**

- `apps/web/lib/explore/feature-build-types.ts` — `BuildPhase`, `FeatureBuildRow`, `PHASE_COLOURS`, `PHASE_LABELS`, `VISIBLE_PHASES`
- `apps/web/lib/integrate/task-dependency-graph.ts` — `buildDependencyGraph()`, `ExecutionPhase`, `AssignedTask`, `SpecialistRole`
- `apps/web/lib/integrate/build-exec-types.ts` — `BuildExecStep`, `STEP_ORDER`, `STEP_LABELS`
- `apps/web/components/build/BuildStudio.tsx` — the three update channels, `activeBuild` state
- `apps/web/components/build/PhaseIndicator.tsx` — what we're replacing
- `apps/web/components/ea/EaCanvas.tsx` — ReactFlow pattern to follow (NODE_TYPES, EDGE_TYPES, zoom, minimap)
- `apps/web/components/ea/EaElementNode.tsx` — custom node pattern (handles, hover, data shape)
- `apps/web/components/ea/EaRelationshipEdge.tsx` — custom edge pattern

**TypeScript rules:**

- `noUncheckedIndexedAccess: true` — `Record<K, V>[key]` returns `V | undefined`. Always use `?? fallback`.
- `exactOptionalPropertyTypes: true` — use `!= null` not `!== undefined` for optional fields.
- No `.js` extensions on local imports.
- Server actions in `apps/web/lib/actions/` must have `"use server"` at top.

**Theme rules:**

- Do not hardcode hex colors in any new UI component. Use semantic CSS variables.
- For process graph role/phase colors, add dedicated `--pg-*` variables in the shared theme layer and pass those CSS variable strings through node data.
- `text-white` is allowed only on solid accent/error/success badges and buttons.

**Test command:** `pnpm --filter @dpf/web test` (run from `d:/DPF`)
**TypeScript check:** `cd apps/web && pnpm tsc --noEmit 2>&1 | head -30`

---

## Phase 1A — Graph Builder (Pure Logic, TDD)

### Task 1: `process-graph-builder.ts` — core types and phase graph builder

**Files:**

- Create: `apps/web/lib/build/process-graph-builder.ts`
- Create: `apps/web/lib/build/process-graph-builder.test.ts`

**Context:** This is a pure function file — no React, no DB, no side effects. It takes `FeatureBuildRow` and returns `{ nodes: Node[], edges: Edge[] }` for ReactFlow. The Phase Graph (Level 1) shows Ideate → Plan → Build → Review → Ship as large nodes. Status derives from `build.phase` and `build.phaseHandoffs`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/build/process-graph-builder.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildPhaseGraph,
  buildTaskGraph,
  getPhaseNodeStatus,
  getTaskNodeStatus,
  normalizeBuildSnapshot,
  type GraphOutput,
  type NormalizedBuildProcessSnapshot,
} from "./process-graph-builder";
import type { FeatureBuildRow } from "@/lib/explore/feature-build-types";

// Minimal FeatureBuildRow stub
function makeRow(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "1",
    buildId: "FB-TEST",
    title: "Test Build",
    description: null,
    portfolioId: null,
    brief: null,
    plan: null,
    phase: "plan",
    sandboxId: null,
    sandboxPort: null,
    diffSummary: null,
    diffPatch: null,
    codingProvider: null,
    threadId: null,
    digitalProductId: null,
    product: null,
    createdById: "u1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    designDoc: null,
    designReview: null,
    buildPlan: null,
    planReview: null,
    taskResults: null,
    verificationOut: null,
    acceptanceMet: null,
    uxTestResults: null,
    accountableEmployeeId: null,
    claimedByAgentId: null,
    claimedAt: null,
    claimStatus: null,
    buildExecState: null,
    phaseHandoffs: null,
    ...overrides,
  };
}

describe("getPhaseNodeStatus", () => {
  it("returns done for phases before the current phase", () => {
    const row = makeRow({ phase: "build" });
    expect(getPhaseNodeStatus("ideate", row)).toBe("done");
    expect(getPhaseNodeStatus("plan", row)).toBe("done");
  });

  it("returns running for the current phase", () => {
    const row = makeRow({ phase: "build" });
    expect(getPhaseNodeStatus("build", row)).toBe("running");
  });

  it("returns pending for phases after the current phase", () => {
    const row = makeRow({ phase: "build" });
    expect(getPhaseNodeStatus("review", row)).toBe("pending");
    expect(getPhaseNodeStatus("ship", row)).toBe("pending");
  });

  it("returns done for all visible phases when complete", () => {
    const row = makeRow({ phase: "complete" });
    expect(getPhaseNodeStatus("ideate", row)).toBe("done");
    expect(getPhaseNodeStatus("ship", row)).toBe("done");
  });

  it("returns error for the active phase when build has failed", () => {
    const row = makeRow({ phase: "failed", phaseHandoffs: [
      { fromPhase: "ideate", toPhase: "plan", fromAgentId: "a1", toAgentId: "a2",
        summary: "", evidenceDigest: {}, createdAt: new Date() },
    ] });
    // ideate has a handoff → done; plan was never handed off → error (it was active when failed)
    expect(getPhaseNodeStatus("ideate", row)).toBe("done");
    expect(getPhaseNodeStatus("plan", row)).toBe("error");
  });
});

describe("buildPhaseGraph", () => {
  it("returns 5 phase nodes and 4 edges", () => {
    const row = makeRow({ phase: "plan" });
    const { nodes, edges } = buildPhaseGraph(row);
    expect(nodes).toHaveLength(5);
    expect(edges).toHaveLength(4);
  });

  it("positions nodes left-to-right with 280px spacing", () => {
    const row = makeRow({ phase: "ideate" });
    const { nodes } = buildPhaseGraph(row);
    const ideate = nodes.find((n) => n.id === "phase-ideate");
    const plan = nodes.find((n) => n.id === "phase-plan");
    expect(ideate).toBeDefined();
    expect(plan).toBeDefined();
    expect((plan!.position.x) - (ideate!.position.x)).toBe(280);
  });

  it("node data includes status, color, label, and icon", () => {
    const row = makeRow({ phase: "build" });
    const { nodes } = buildPhaseGraph(row);
    const buildNode = nodes.find((n) => n.id === "phase-build");
    expect(buildNode?.data.status).toBe("running");
    expect(buildNode?.data.color).toBe("var(--pg-phase-build)");
    expect(buildNode?.data.label).toBe("Build");
    expect(typeof buildNode?.data.icon).toBe("string");
  });

  it("edge source/target reference correct node ids", () => {
    const row = makeRow({ phase: "ideate" });
    const { edges } = buildPhaseGraph(row);
    expect(edges[0]?.source).toBe("phase-ideate");
    expect(edges[0]?.target).toBe("phase-plan");
  });
});

// Helpers to build the actual runtime taskResults shape stored by build-orchestrator.ts.
// FeatureBuildRow.taskResults is typed as TaskResult[] | null in TypeScript, but the
// orchestrator stores a DIFFERENT shape: { tasks: [{title, specialist, outcome, durationMs}], ... }.
// The graph builder must read the runtime shape, not the stale TypeScript type.
function makeTaskResults(tasks: Array<{ title: string; outcome: string }>) {
  return {
    completedTasks: tasks.filter(t => t.outcome === "DONE").length,
    totalTasks: tasks.length,
    timedOut: false,
    tasks: tasks.map(t => ({ title: t.title, specialist: "software-engineer", outcome: t.outcome, durationMs: 0 })),
    timestamp: new Date().toISOString(),
  } as unknown as import("@/lib/explore/feature-build-types").FeatureBuildRow["taskResults"];
}

// Helper to create a snapshot for testing
function makeSnapshot(
  row: FeatureBuildRow,
  activeTaskTitles: Set<string> = new Set(),
): NormalizedBuildProcessSnapshot {
  return normalizeBuildSnapshot(row, activeTaskTitles);
}

describe("getTaskNodeStatus", () => {
  it("returns pending when taskResults is null", () => {
    const row = makeRow({ taskResults: null });
    const snap = makeSnapshot(row);
    expect(getTaskNodeStatus("Add schema", row, snap)).toBe("pending");
  });

  it("returns done when title matches and outcome is DONE", () => {
    const row = makeRow({ taskResults: makeTaskResults([{ title: "Add schema", outcome: "DONE" }]) });
    const snap = makeSnapshot(row);
    expect(getTaskNodeStatus("Add schema", row, snap)).toBe("done");
  });

  it("returns done when outcome is DONE_WITH_CONCERNS", () => {
    const row = makeRow({ taskResults: makeTaskResults([{ title: "Add schema", outcome: "DONE_WITH_CONCERNS" }]) });
    const snap = makeSnapshot(row);
    expect(getTaskNodeStatus("Add schema", row, snap)).toBe("done");
  });

  it("returns error when title matches and outcome is not a DONE variant", () => {
    const row = makeRow({
      phase: "build",
      taskResults: makeTaskResults([{ title: "Add API route", outcome: "FAILED" }]),
    });
    const snap = makeSnapshot(row);
    expect(getTaskNodeStatus("Add API route", row, snap)).toBe("error");
  });

  it("returns running when activeTaskTitles contains the task, phase is build, and task has no result", () => {
    const row = makeRow({
      phase: "build",
      taskResults: makeTaskResults([{ title: "Add schema", outcome: "DONE" }]),
    });
    const snap = makeSnapshot(row, new Set(["Add API route"]));
    expect(getTaskNodeStatus("Add API route", row, snap)).toBe("running");
  });

  it("supports multiple parallel tasks running simultaneously", () => {
    const row = makeRow({
      phase: "build",
      taskResults: makeTaskResults([{ title: "Add schema", outcome: "DONE" }]),
    });
    const snap = makeSnapshot(row, new Set(["Add API route", "Add frontend page"]));
    expect(getTaskNodeStatus("Add API route", row, snap)).toBe("running");
    expect(getTaskNodeStatus("Add frontend page", row, snap)).toBe("running");
    expect(getTaskNodeStatus("Add schema", row, snap)).toBe("done"); // already completed
  });

  it("returns pending when phase is not build and task has no result", () => {
    const row = makeRow({ phase: "plan", taskResults: null });
    const snap = makeSnapshot(row);
    expect(getTaskNodeStatus("Add schema", row, snap)).toBe("pending");
  });
});

describe("buildTaskGraph", () => {
  it("returns empty nodes and edges when buildPlan is null", () => {
    const row = makeRow({ buildPlan: null });
    const snap = makeSnapshot(row);
    const { nodes, edges } = buildTaskGraph(row, snap);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it("generates task nodes for a sequential plan", () => {
    const row = makeRow({
      phase: "build",
      buildPlan: {
        fileStructure: [
          { path: "packages/db/prisma/schema.prisma", action: "modify", purpose: "add table" },
          { path: "apps/web/app/api/foo/route.ts", action: "create", purpose: "api route" },
        ],
        tasks: [
          { title: "Add schema", testFirst: "", implement: "", verify: "" },
          { title: "Add API route", testFirst: "", implement: "", verify: "" },
        ],
      },
    });
    const snap = makeSnapshot(row);
    const { nodes } = buildTaskGraph(row, snap);
    // Should have at least 2 task nodes (plus QA) — no fork/join for sequential
    const taskNodes = nodes.filter((n) => n.type === "processTask");
    expect(taskNodes.length).toBeGreaterThanOrEqual(2);
  });

  it("generates fork/join nodes for parallel phases", () => {
    // Two tasks that touch different files at same priority level → parallel
    const row = makeRow({
      phase: "build",
      buildPlan: {
        fileStructure: [
          { path: "apps/web/app/api/foo/route.ts", action: "create", purpose: "api A" },
          { path: "apps/web/app/api/bar/route.ts", action: "create", purpose: "api B" },
        ],
        tasks: [
          { title: "Add foo API", testFirst: "", implement: "", verify: "" },
          { title: "Add bar API", testFirst: "", implement: "", verify: "" },
        ],
      },
    });
    const snap = makeSnapshot(row);
    const { nodes } = buildTaskGraph(row, snap);
    const forkJoinNodes = nodes.filter((n) => n.type === "processForkJoin");
    expect(forkJoinNodes.length).toBeGreaterThanOrEqual(2); // at least one fork + one join
  });

  it("task nodes include actor provenance from the snapshot", () => {
    const row = makeRow({
      phase: "build",
      buildPlan: {
        fileStructure: [
          { path: "packages/db/prisma/schema.prisma", action: "modify", purpose: "add table" },
        ],
        tasks: [
          { title: "Add schema", testFirst: "", implement: "", verify: "" },
        ],
      },
    });
    const snap = makeSnapshot(row);
    const { nodes } = buildTaskGraph(row, snap);
    const taskNode = nodes.find((n) => n.type === "processTask");
    expect(taskNode?.data.actorKind).toBe("ai_coworker");
    expect(typeof taskNode?.data.actorLabel).toBe("string");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd d:/DPF && pnpm --filter @dpf/web test lib/build/process-graph-builder 2>&1 | tail -20
```

Expected: `Cannot find module` or similar — file doesn't exist yet.

- [ ] **Step 3: Implement `process-graph-builder.ts`**

Create `apps/web/lib/build/process-graph-builder.ts`:

```typescript
// apps/web/lib/build/process-graph-builder.ts
// Pure function: FeatureBuildRow → ReactFlow { nodes, edges }
// No React. No DB. No side effects. Fully testable.

import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { PHASE_COLOURS, PHASE_LABELS, VISIBLE_PHASES } from "@/lib/explore/feature-build-types";
import type { BuildPhase, FeatureBuildRow } from "@/lib/explore/feature-build-types";
import { buildDependencyGraph } from "@/lib/integrate/task-dependency-graph";
import type { SpecialistRole } from "@/lib/integrate/task-dependency-graph";

// ── Constants ─────────────────────────────────────────────────────────────────

export const PHASE_ICONS: Record<BuildPhase, string> = {
  ideate:   "◈",
  plan:     "▤",
  build:    "⚙",
  review:   "◎",
  ship:     "▶",
  complete: "✓",
  failed:   "✗",
};

export const ROLE_COLOURS: Record<SpecialistRole, string> = {
  "data-architect":    "var(--pg-role-data-architect)",
  "software-engineer": "var(--pg-role-software-engineer)",
  "frontend-engineer": "var(--pg-role-frontend-engineer)",
  "qa-engineer":       "var(--pg-role-qa-engineer)",
};

export const ROLE_ICONS: Record<SpecialistRole, string> = {
  "data-architect":    "◈",
  "software-engineer": "⌨",
  "frontend-engineer": "◻",
  "qa-engineer":       "✓",
};

// Phase order for status derivation
const PHASE_ORDER_INDEX: Record<BuildPhase, number> = {
  ideate:   0,
  plan:     1,
  build:    2,
  review:   3,
  ship:     4,
  complete: 5,
  failed:   99,
};

export type NodeStatus = "pending" | "running" | "done" | "error";

export type GraphOutput = {
  nodes: Node[];
  edges: Edge[];
};

// ── Phase Status ──────────────────────────────────────────────────────────────

/**
 * Derive the status of a single phase node from the build row.
 * - done: phase index < current phase index (or build is complete)
 * - running: phase === build.phase (and not failed/complete)
 * - error: build.phase === "failed" and this phase was the last active one
 * - pending: phase index > current phase index
 */
export function getPhaseNodeStatus(phase: BuildPhase, build: FeatureBuildRow): NodeStatus {
  const currentPhase = build.phase;

  if (currentPhase === "complete") return "done";

  const phaseIdx = PHASE_ORDER_INDEX[phase] ?? 99;
  const currentIdx = PHASE_ORDER_INDEX[currentPhase] ?? 99;

  if (currentPhase === "failed") {
    // Phases with a handoff record are done; the last active phase (no handoff out) is error
    const handoffs = build.phaseHandoffs ?? [];
    const hasHandoffOut = handoffs.some((h) => h.fromPhase === phase);
    if (hasHandoffOut) return "done";
    // The phase that was active when failure happened = the last phase without a handoff out
    // Among visible phases before "failed", find the latest one without a handoff
    const allHandedOffPhases = new Set(handoffs.map((h) => h.fromPhase));
    const visibleIdx = VISIBLE_PHASES.indexOf(phase);
    if (visibleIdx < 0) return "pending";
    // This phase is the error phase if all phases before it have handoffs and it does not
    const allPriorDone = VISIBLE_PHASES.slice(0, visibleIdx).every(
      (p) => allHandedOffPhases.has(p),
    );
    if (allPriorDone && !allHandedOffPhases.has(phase)) return "error";
    return "pending";
  }

  if (phaseIdx < currentIdx) return "done";
  if (phaseIdx === currentIdx) return "running";
  return "pending";
}

// ── Phase Graph (Level 1) ─────────────────────────────────────────────────────

const PHASE_NODE_WIDTH = 200;
const PHASE_NODE_HEIGHT = 90;
const PHASE_H_SPACING = 280; // center-to-center

export function buildPhaseGraph(
  build: FeatureBuildRow,
  snapshot?: NormalizedBuildProcessSnapshot,
): GraphOutput {
  const nodes: Node[] = VISIBLE_PHASES.map((phase, i) => {
    const status = getPhaseNodeStatus(phase, build);
    const color = PHASE_COLOURS[phase] ?? "var(--dpf-muted)";
    const label = PHASE_LABELS[phase] ?? phase;
    const icon = PHASE_ICONS[phase] ?? "•";

    // Actor provenance from the normalized snapshot
    const phaseActor = snapshot?.phaseActors.get(phase);
    const agentLabel = phaseActor?.label ?? null;
    const actorKind = phaseActor?.kind ?? null;

    // Duration: from the handoff that started this phase (toPhase === phase) to the one that ended it
    const handoffs = build.phaseHandoffs ?? [];
    const inHandoff = handoffs.find((h) => h.toPhase === phase);
    const outHandoff = handoffs.find((h) => h.fromPhase === phase);
    let durationLabel: string | null = null;
    if (inHandoff && outHandoff) {
      const ms = new Date(outHandoff.createdAt).getTime() - new Date(inHandoff.createdAt).getTime();
      durationLabel = ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
    }

    return {
      id: `phase-${phase}`,
      type: "processPhase",
      position: { x: i * PHASE_H_SPACING, y: 0 },
      data: { phase, status, color, label, icon, agentLabel, actorKind, durationLabel },
      draggable: false,
      selectable: true,
    };
  });

  const edges: Edge[] = VISIBLE_PHASES.slice(0, -1).map((phase, i) => {
    const nextPhase = VISIBLE_PHASES[i + 1];
    if (!nextPhase) throw new Error("unreachable");
    const sourceStatus = getPhaseNodeStatus(phase, build);
    return {
      id: `phase-edge-${phase}-${nextPhase}`,
      source: `phase-${phase}`,
      target: `phase-${nextPhase}`,
      type: "animatedFlow",
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { sourceStatus, color: PHASE_COLOURS[phase] ?? "var(--dpf-muted)" },
    };
  });

  return { nodes, edges };
}

// ── Normalization Layer ──────────────────────────────────────────────────────
//
// Spec requirement: introduce a normalization step between raw FeatureBuildRow
// and the graph builder. This isolates the UI from the DB storage shape and
// provides a stable contract for tests.
//
// IMPORTANT: FeatureBuildRow.taskResults is typed as TaskResult[] | null in TypeScript,
// but build-orchestrator.ts stores a DIFFERENT JSON shape at runtime. The normalization
// layer handles this mismatch — graph builder code never touches raw taskResults.

export type ProcessActorKind = "ai_coworker" | "system" | "human_hitl" | "review_gate";

export type NormalizedStoredTaskResult = {
  title: string;
  specialist: string;
  outcome: string; // "DONE" | "DONE_WITH_CONCERNS" | "FAILED" | other error strings
  durationMs: number;
};

export type NormalizedBuildProcessSnapshot = {
  storedTaskResults: Map<string, NormalizedStoredTaskResult>;
  activeTaskTitles: Set<string>;
  taskActors: Map<string, { kind: ProcessActorKind; label: string }>;
  phaseActors: Map<BuildPhase, { kind: ProcessActorKind; label: string }>;
};

// ── Specialist → human-readable label mapping ───────────────────────────────

const SPECIALIST_LABELS: Record<string, string> = {
  "data-architect":    "Data Architect",
  "software-engineer": "Software Engineer",
  "frontend-engineer": "Frontend Engineer",
  "qa-engineer":       "QA Engineer",
};

// ── Raw taskResults parsing (private) ───────────────────────────────────────

type StoredTaskEntry = {
  title: string;
  specialist: string;
  outcome: string;
  durationMs: number;
};

type StoredTaskResults = {
  completedTasks: number;
  totalTasks: number;
  timedOut: boolean;
  tasks: StoredTaskEntry[];
  timestamp: string;
};

function parseTaskResults(raw: unknown): StoredTaskResults | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj["tasks"])) return null;
  return obj as unknown as StoredTaskResults;
}

// ── Build the normalized snapshot ───────────────────────────────────────────

/**
 * Normalize a FeatureBuildRow + transient relay state into a graph-ready snapshot.
 *
 * @param build             - current FeatureBuildRow from DB/SSE refetch
 * @param activeTaskTitles  - Set of task titles from orchestrator:task_dispatched events
 *                            that have not yet been resolved by task_complete or DB refetch.
 *                            Supports multiple parallel running tasks.
 */
export function normalizeBuildSnapshot(
  build: FeatureBuildRow,
  activeTaskTitles: Set<string>,
): NormalizedBuildProcessSnapshot {
  // 1. Parse stored task results into a Map<title, result>
  const stored = parseTaskResults(build.taskResults as unknown);
  const storedTaskResults = new Map<string, NormalizedStoredTaskResult>();
  if (stored) {
    for (const t of stored.tasks) {
      storedTaskResults.set(t.title, {
        title: t.title,
        specialist: t.specialist,
        outcome: t.outcome,
        durationMs: t.durationMs,
      });
    }
  }

  // 2. Build task actor map — dependency graph tasks are always ai_coworker
  const taskActors = new Map<string, { kind: ProcessActorKind; label: string }>();
  if (build.buildPlan) {
    const { fileStructure, tasks } = build.buildPlan;
    const phases = buildDependencyGraph(fileStructure, tasks);
    for (const phase of phases) {
      for (const task of phase.tasks) {
        taskActors.set(task.title, {
          kind: "ai_coworker",
          label: SPECIALIST_LABELS[task.specialist] ?? task.specialist,
        });
      }
    }
  }

  // 3. Build phase actor map from handoffs
  const phaseActors = new Map<BuildPhase, { kind: ProcessActorKind; label: string }>();
  const handoffs = build.phaseHandoffs ?? [];
  for (const h of handoffs) {
    // Phases worked on by agents are ai_coworker; the fromAgentId tells us who
    const phase = h.fromPhase as BuildPhase;
    phaseActors.set(phase, {
      kind: "ai_coworker",
      label: h.fromAgentId ?? "AI Coworker",
    });
  }
  // The currently running phase: if no handoff record yet, it's the active phase
  if (build.phase !== "complete" && build.phase !== "failed") {
    if (!phaseActors.has(build.phase)) {
      // Active phase with no handoff yet — check if there's a toPhase handoff
      const inboundHandoff = handoffs.find((h) => h.toPhase === build.phase);
      phaseActors.set(build.phase, {
        kind: "ai_coworker",
        label: inboundHandoff?.toAgentId ?? "AI Coworker",
      });
    }
  }

  return { storedTaskResults, activeTaskTitles, taskActors, phaseActors };
}

const DONE_OUTCOMES = new Set(["DONE", "DONE_WITH_CONCERNS"]);

// ── Task Status ───────────────────────────────────────────────────────────────

/**
 * Derive the status of a task node from the normalized snapshot.
 * Matches by title (NOT by index — the orchestrator stores by title).
 *
 * @param taskTitle - the task's title from buildDependencyGraph output
 * @param build     - the current FeatureBuildRow (for phase check)
 * @param snapshot  - the normalized snapshot from normalizeBuildSnapshot()
 */
export function getTaskNodeStatus(
  taskTitle: string,
  build: FeatureBuildRow,
  snapshot: NormalizedBuildProcessSnapshot,
): NodeStatus {
  const entry = snapshot.storedTaskResults.get(taskTitle);

  if (entry != null) {
    return DONE_OUTCOMES.has(entry.outcome) ? "done" : "error";
  }

  if (build.phase !== "build") return "pending";

  // Live signal: SSE relay told us this task is dispatched right now
  // Uses Set so multiple parallel tasks can show "running" simultaneously
  if (snapshot.activeTaskTitles.has(taskTitle)) return "running";

  return "pending";
}

// ── Task Graph (Level 2) ──────────────────────────────────────────────────────

const TASK_NODE_WIDTH = 200;
const TASK_NODE_HEIGHT = 72;
const FORK_JOIN_SIZE = 16;
const TASK_V_GAP = 16;
const PHASE_COL_SPACING = 120; // gap between phase columns (edge room)

export function buildTaskGraph(
  build: FeatureBuildRow,
  snapshot: NormalizedBuildProcessSnapshot,
): GraphOutput {
  if (!build.buildPlan) return { nodes: [], edges: [] };

  const { fileStructure, tasks } = build.buildPlan;
  const phases = buildDependencyGraph(fileStructure, tasks);

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  let colX = 0;
  let prevNodeId: string | null = null;
  let prevNodeStatus: NodeStatus | null = null;
  let prevNodeIsGroup = false; // whether previous output is a join node

  for (const phase of phases) {
    const phaseColor = ROLE_COLOURS[phase.tasks[0]?.specialist ?? "software-engineer"] ?? "var(--dpf-accent)";

    if (!phase.parallel) {
      // Sequential: one TaskNode per phase
      const task = phase.tasks[0];
      if (!task) { colX += TASK_NODE_WIDTH + PHASE_COL_SPACING; continue; }

      const nodeId = `task-${task.taskIndex}`;
      const status = getTaskNodeStatus(task.title, build, snapshot);
      const actor = snapshot.taskActors.get(task.title);
      const color = ROLE_COLOURS[task.specialist] ?? "var(--dpf-accent)";
      const icon = ROLE_ICONS[task.specialist] ?? "•";

      nodes.push({
        id: nodeId,
        type: "processTask",
        position: { x: colX, y: 0 },
        data: { task, status, color, icon, actorKind: actor?.kind ?? "ai_coworker", actorLabel: actor?.label ?? task.specialist },
        draggable: false,
        selectable: true,
      });

      if (prevNodeId) {
        const prevStatus = prevNodeIsGroup
          ? "done"
          : (prevNodeStatus ?? "pending");
        edges.push({
          id: `task-edge-${prevNodeId}-${nodeId}`,
          source: prevNodeId,
          target: nodeId,
          type: "animatedFlow",
          markerEnd: { type: MarkerType.ArrowClosed },
          data: { sourceStatus: prevStatus, color },
        });
      }

      prevNodeId = nodeId;
      prevNodeStatus = status;
      prevNodeIsGroup = false;
      colX += TASK_NODE_WIDTH + PHASE_COL_SPACING;

    } else {
      // Parallel: fork → [task0, task1, ...] → join
      const forkId = `fork-${phase.phaseIndex}`;
      const joinId = `join-${phase.phaseIndex}`;

      const totalHeight =
        phase.tasks.length * TASK_NODE_HEIGHT + (phase.tasks.length - 1) * TASK_V_GAP;
      const groupMidY = totalHeight / 2 - FORK_JOIN_SIZE / 2;

      // Fork node
      nodes.push({
        id: forkId,
        type: "processForkJoin",
        position: { x: colX, y: groupMidY },
        data: { color: phaseColor },
        draggable: false,
        selectable: false,
      });

      if (prevNodeId) {
        const prevNode = nodes.find((n) => n.id === prevNodeId);
        const prevTitle = prevNode ? (prevNode.data as { task: { title: string } }).task.title : "";
        const prevStatus: NodeStatus = prevNodeIsGroup
          ? "done"
          : getTaskNodeStatus(prevTitle, build, snapshot);
        edges.push({
          id: `edge-${prevNodeId}-${forkId}`,
          source: prevNodeId,
          target: forkId,
          type: "animatedFlow",
          markerEnd: { type: MarkerType.ArrowClosed },
          data: { sourceStatus: prevStatus, color: phaseColor },
        });
      }

      colX += FORK_JOIN_SIZE + 40;

      // Task nodes
      phase.tasks.forEach((task, i) => {
        const taskNodeId = `task-${task.taskIndex}`;
        const taskY = i * (TASK_NODE_HEIGHT + TASK_V_GAP);
        const status = getTaskNodeStatus(task.title, build, snapshot);
        const actor = snapshot.taskActors.get(task.title);
        const color = ROLE_COLOURS[task.specialist] ?? "var(--dpf-accent)";
        const icon = ROLE_ICONS[task.specialist] ?? "•";

        nodes.push({
          id: taskNodeId,
          type: "processTask",
          position: { x: colX, y: taskY },
          data: { task, status, color, icon, actorKind: actor?.kind ?? "ai_coworker", actorLabel: actor?.label ?? task.specialist },
          draggable: false,
          selectable: true,
        });

        edges.push({
          id: `edge-${forkId}-${taskNodeId}`,
          source: forkId,
          target: taskNodeId,
          type: "animatedFlow",
          markerEnd: { type: MarkerType.ArrowClosed },
          data: { sourceStatus: "done", color }, // fork itself is always "done" structurally
        });
      });

      colX += TASK_NODE_WIDTH + 40;

      // Join node
      const joinY = groupMidY;
      nodes.push({
        id: joinId,
        type: "processForkJoin",
        position: { x: colX, y: joinY },
        data: { color: phaseColor },
        draggable: false,
        selectable: false,
      });

      phase.tasks.forEach((task) => {
        const taskNodeId = `task-${task.taskIndex}`;
        const status = getTaskNodeStatus(task.title, build, snapshot);
        edges.push({
          id: `edge-${taskNodeId}-${joinId}`,
          source: taskNodeId,
          target: joinId,
          type: "animatedFlow",
          markerEnd: { type: MarkerType.ArrowClosed },
          data: { sourceStatus: status, color: phaseColor },
        });
      });

      prevNodeId = joinId;
      prevNodeStatus = "done";
      prevNodeIsGroup = true;
      colX += FORK_JOIN_SIZE + PHASE_COL_SPACING;
    }
  }

  return { nodes, edges };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd d:/DPF && pnpm --filter @dpf/web test lib/build/process-graph-builder 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: TypeScript check**

```bash
cd d:/DPF/apps/web && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
cd d:/DPF && git add apps/web/lib/build/ && git commit -m "feat(build): pure graph builder — FeatureBuildRow → ReactFlow nodes+edges"
```

---

## Phase 1B — CSS Animations

### Task 2: `process-graph.css` — keyframe animations

**Files:**

- Create: `apps/web/components/build/process-graph.css`

**Context:** All animations are CSS-only. React sets the class name or inline style based on `status`; CSS handles the visual effect. This keeps animation buttery smooth (compositor thread) and decoupled from React re-renders.

- [ ] **Step 1: Create the CSS file**

Create `apps/web/components/build/process-graph.css`:

```css
/* apps/web/components/build/process-graph.css
   Keyframe animations for the Build Studio process graph.
   Import once in ProcessGraph.tsx. */

/* ── Pulsing border ring (running nodes) ─────────────────────────────────── */
@keyframes pg-pulse-ring {
  0%   { box-shadow: 0 0 0 0px var(--pg-color-25); }
  50%  { box-shadow: 0 0 0 5px var(--pg-color-25); }
  100% { box-shadow: 0 0 0 0px var(--pg-color-25); }
}

.pg-node-running {
  animation: pg-pulse-ring 1.4s ease-in-out infinite;
}

/* ── Done flash (brief brightening when transitioning to done) ────────────── */
@keyframes pg-done-flash {
  0%   { opacity: 1; }
  30%  { opacity: 0.6; }
  100% { opacity: 1; }
}

.pg-node-done-flash {
  animation: pg-done-flash 0.4s ease-out forwards;
}

/* ── Error shake ─────────────────────────────────────────────────────────── */
@keyframes pg-error-shake {
  0%, 100% { transform: translateX(0); }
  20%      { transform: translateX(-3px); }
  40%      { transform: translateX(3px); }
  60%      { transform: translateX(-2px); }
  80%      { transform: translateX(2px); }
}

.pg-node-error-enter {
  animation: pg-error-shake 0.4s ease-out forwards;
}

/* ── Traveling edge dash (SVG, applied via style prop on <path>) ─────────── */
@keyframes pg-dash-travel {
  to { stroke-dashoffset: -36; }
}

/* Class applied to the <path> element inside AnimatedEdge when source is running */
.pg-edge-active path {
  animation: pg-dash-travel 0.9s linear infinite;
}
```

- [ ] **Step 2: Commit**

```bash
cd d:/DPF && git add apps/web/components/build/process-graph.css && git commit -m "feat(build): CSS keyframe animations for process graph nodes and edges"
```

---

## Phase 1C — Custom ReactFlow Components

### Task 3: `AnimatedEdge.tsx`

**Files:**

- Create: `apps/web/components/build/AnimatedEdge.tsx`

**Context:** Custom ReactFlow edge that renders a dashed SVG path. When `data.sourceStatus === "running"`, adds the `pg-edge-active` CSS class to animate the dashes. Edge color comes from `data.color`.

- [ ] **Step 1: Create `AnimatedEdge.tsx`**

```typescript
// apps/web/components/build/AnimatedEdge.tsx
"use client";

import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { NodeStatus } from "@/lib/build/process-graph-builder";

type AnimatedEdgeData = {
  sourceStatus: NodeStatus;
  color: string;
};

export function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  const edgeData = data as AnimatedEdgeData | undefined;
  const sourceStatus = edgeData?.sourceStatus ?? "pending";
  const color = edgeData?.color ?? "var(--dpf-border)";

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isActive = sourceStatus === "running";
  const isError = sourceStatus === "error";

  const strokeColor = isError
    ? "var(--dpf-error)"
    : isActive
      ? color
      : sourceStatus === "done"
        ? `color-mix(in srgb, ${color} 60%, var(--dpf-border))`
        : "var(--dpf-border)";

  const strokeWidth = isActive ? 3 : 2;

  return (
    <g className={isActive ? "pg-edge-active" : undefined}>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray: "8 4",
          strokeDashoffset: 0,
          transition: "stroke 0.3s ease",
        }}
      />
    </g>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd d:/DPF/apps/web && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
cd d:/DPF && git add apps/web/components/build/AnimatedEdge.tsx && git commit -m "feat(build): AnimatedEdge — stroke-dasharray with running state animation"
```

---

### Task 4: `PhaseNode.tsx`

**Files:**

- Create: `apps/web/components/build/PhaseNode.tsx`

**Context:** Large (200×90px) node for the Level 1 phase graph. Shows icon, phase name, agent label, duration. Pulsing ring when running. Status badge (✓ or ✗) when done/error. Uses `Handle` for ReactFlow connections.

- [ ] **Step 1: Create `PhaseNode.tsx`**

```typescript
// apps/web/components/build/PhaseNode.tsx
"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { NodeStatus } from "@/lib/build/process-graph-builder";

type PhaseNodeData = {
  phase: string;
  status: NodeStatus;
  color: string;
  label: string;
  icon: string;
  agentLabel: string | null;
  actorKind: "ai_coworker" | "system" | "human_hitl" | "review_gate" | null;
  durationLabel: string | null;
};

export function PhaseNode({ data, selected }: NodeProps) {
  const d = data as PhaseNodeData;
  const isRunning = d.status === "running";
  const isDone = d.status === "done";
  const isError = d.status === "error";
  const isPending = d.status === "pending";

  const borderColor = isError
    ? "var(--dpf-error)"
    : isPending
      ? "var(--dpf-border)"
      : d.color;

  const bgColor = isRunning
    ? `color-mix(in srgb, ${d.color} 12%, var(--dpf-surface-1))`
    : isDone
      ? `color-mix(in srgb, ${d.color} 10%, var(--dpf-surface-1))`
      : "var(--dpf-surface-1)";

  return (
    <div
      className={isRunning ? "pg-node-running" : undefined}
      style={{
        width: 200,
        height: 90,
        background: bgColor,
        border: `2px solid ${borderColor}`,
        borderRadius: 12,
        padding: "12px 14px",
        opacity: isPending ? 0.45 : 1,
        position: "relative",
        transition: "border-color 0.3s ease, background 0.3s ease, opacity 0.3s ease",
        // CSS custom property for pulse animation color
        ["--pg-color-25" as string]: `color-mix(in srgb, ${d.color} 25%, transparent)`,
        outline: selected ? `2px solid ${d.color}` : "none",
        outlineOffset: 2,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />

      {/* Status badge */}
      {(isDone || isError) && (
        <div
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: isDone ? "var(--dpf-success)" : "var(--dpf-error)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 700,
            color: "white",
            border: "2px solid var(--dpf-bg)",
          }}
        >
          {isDone ? "✓" : "✗"}
        </div>
      )}

      {/* Icon + Label row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 18, lineHeight: 1, color: isPending ? "var(--dpf-muted)" : d.color }}>
          {d.icon}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: isPending ? "var(--dpf-muted)" : "var(--dpf-text)",
          }}
        >
          {d.label}
        </span>
      </div>

      {/* Actor label + provenance badge */}
      {d.agentLabel != null ? (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {d.actorKind != null && (
            <span style={{
              fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 3,
              background: d.actorKind === "ai_coworker" ? "color-mix(in srgb, var(--dpf-accent) 18%, transparent)"
                : d.actorKind === "system" ? "color-mix(in srgb, var(--dpf-muted) 18%, transparent)"
                : "color-mix(in srgb, var(--dpf-warning) 18%, transparent)",
              color: d.actorKind === "ai_coworker" ? "var(--dpf-accent)"
                : d.actorKind === "system" ? "var(--dpf-muted)"
                : "var(--dpf-warning)",
              textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
            }}>
              {d.actorKind === "ai_coworker" ? "AI" : d.actorKind === "system" ? "SYS" : d.actorKind === "human_hitl" ? "HITL" : "GATE"}
            </span>
          )}
          <p style={{ fontSize: 10, color: "var(--dpf-muted)", margin: 0, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d.agentLabel}
          </p>
        </div>
      ) : (
        <p style={{ fontSize: 10, color: "var(--dpf-border)", margin: 0, lineHeight: 1.4 }}>
          {isPending ? "Waiting" : isRunning ? "Working..." : "—"}
        </p>
      )}

      {/* Duration */}
      {d.durationLabel != null && (
        <p style={{ fontSize: 9, color: d.color, margin: "4px 0 0", fontWeight: 600 }}>
          {d.durationLabel}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd d:/DPF/apps/web && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
cd d:/DPF && git add apps/web/components/build/PhaseNode.tsx && git commit -m "feat(build): PhaseNode — large phase node with pulse animation and status badge"
```

---

### Task 5: `TaskNode.tsx` and `ForkJoinNode.tsx`

**Files:**

- Create: `apps/web/components/build/TaskNode.tsx`
- Create: `apps/web/components/build/ForkJoinNode.tsx`

- [ ] **Step 1: Create `TaskNode.tsx`**

```typescript
// apps/web/components/build/TaskNode.tsx
"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { NodeStatus } from "@/lib/build/process-graph-builder";
import type { AssignedTask } from "@/lib/integrate/task-dependency-graph";

type TaskNodeData = {
  task: AssignedTask;
  status: NodeStatus;
  color: string;
  icon: string;
  actorKind: "ai_coworker" | "system" | "human_hitl" | "review_gate";
  actorLabel: string;
};

export function TaskNode({ data, selected }: NodeProps) {
  const d = data as TaskNodeData;
  const isRunning = d.status === "running";
  const isDone = d.status === "done";
  const isError = d.status === "error";
  const isPending = d.status === "pending";

  const borderColor = isError
    ? "var(--dpf-error)"
    : isPending
      ? "var(--dpf-border)"
      : d.color;

  return (
    <div
      className={isRunning ? "pg-node-running" : undefined}
      style={{
        width: 200,
        minHeight: 72,
        background: isRunning ? `color-mix(in srgb, ${d.color} 12%, var(--dpf-surface-1))` : "var(--dpf-surface-1)",
        border: `2px solid ${borderColor}`,
        borderRadius: 10,
        padding: "8px 10px",
        opacity: isPending ? 0.4 : 1,
        position: "relative",
        transition: "border-color 0.3s ease, opacity 0.3s ease",
        ["--pg-color-25" as string]: `color-mix(in srgb, ${d.color} 25%, transparent)`,
        outline: selected ? `2px solid ${d.color}` : "none",
        outlineOffset: 2,
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />

      {/* Status badge */}
      {(isDone || isError) && (
        <div
          style={{
            position: "absolute",
            top: -7,
            right: -7,
            width: 15,
            height: 15,
            borderRadius: "50%",
            background: isDone ? "var(--dpf-success)" : "var(--dpf-error)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 8,
            fontWeight: 700,
            color: "white",
            border: "2px solid var(--dpf-bg)",
          }}
        >
          {isDone ? "✓" : "✗"}
        </div>
      )}

      {/* Icon + title */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: d.color, flexShrink: 0, marginTop: 1 }}>
          {d.icon}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--dpf-text)",
            lineHeight: 1.35,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {d.task.title}
        </span>
      </div>

      {/* Actor provenance + specialist + file count */}
      <div style={{ fontSize: 9, color: "var(--dpf-muted)", display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{
          fontSize: 7, fontWeight: 700, padding: "0px 3px", borderRadius: 2,
          background: d.actorKind === "ai_coworker" ? "color-mix(in srgb, var(--dpf-accent) 18%, transparent)" : "color-mix(in srgb, var(--dpf-muted) 18%, transparent)",
          color: d.actorKind === "ai_coworker" ? "var(--dpf-accent)" : "var(--dpf-muted)",
          textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0,
        }}>
          {d.actorKind === "ai_coworker" ? "AI" : d.actorKind === "system" ? "SYS" : d.actorKind === "human_hitl" ? "HITL" : "GATE"}
        </span>
        <span style={{ color: d.color, fontWeight: 600 }}>
          {d.actorLabel}
        </span>
        <span>·</span>
        <span>{d.task.files.length} file{d.task.files.length !== 1 ? "s" : ""}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `ForkJoinNode.tsx`**

```typescript
// apps/web/components/build/ForkJoinNode.tsx
"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

type ForkJoinData = {
  color: string;
};

export function ForkJoinNode({ data }: NodeProps) {
  const d = data as ForkJoinData;

  return (
    <div
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: d.color,
        border: "2px solid var(--dpf-bg)",
        boxShadow: `0 0 0 2px ${d.color}`,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
    </div>
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd d:/DPF/apps/web && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
cd d:/DPF && git add apps/web/components/build/TaskNode.tsx apps/web/components/build/ForkJoinNode.tsx && git commit -m "feat(build): TaskNode and ForkJoinNode components for task dependency graph"
```

---

### Task 6: `TaskInspector.tsx`

**Files:**

- Create: `apps/web/components/build/TaskInspector.tsx`

**Context:** Slides in from the right when a `processTask` node is clicked. Shows task details, file list, and result output if available. 320px wide, `translateX` transition. Canvas dims 15% when open.

- [ ] **Step 1: Create `TaskInspector.tsx`**

```typescript
// apps/web/components/build/TaskInspector.tsx
"use client";

import type { AssignedTask } from "@/lib/integrate/task-dependency-graph";
import type { NodeStatus } from "@/lib/build/process-graph-builder";
import type { FeatureBuildRow } from "@/lib/explore/feature-build-types";

type Props = {
  task: AssignedTask | null;
  status: NodeStatus;
  color: string;
  icon: string;
  build: FeatureBuildRow;
  onClose: () => void;
};

// Matches actual orchestrator runtime shape (NOT the stale TaskResult[] TypeScript type)
type StoredTaskEntry = { title: string; specialist: string; outcome: string; durationMs: number };

function parseStoredTaskResults(raw: unknown): { tasks: StoredTaskEntry[] } | null {
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return Array.isArray(r["tasks"]) ? (raw as { tasks: StoredTaskEntry[] }) : null;
}

const DONE_OUTCOMES = new Set(["DONE", "DONE_WITH_CONCERNS"]);

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function TaskInspector({ task, status, color, icon, build, onClose }: Props) {
  if (!task) return null;

  const stored = parseStoredTaskResults(build.taskResults as unknown);
  const taskEntry = stored?.tasks.find((t) => t.title === task.title) ?? null;
  const isOpen = true;

  return (
    <>
      {/* Dim overlay */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "color-mix(in srgb, var(--dpf-text) 15%, transparent)",
          pointerEvents: "auto",
          zIndex: 10,
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 320,
          background: "var(--dpf-surface-1)",
          borderLeft: "1px solid var(--dpf-border)",
          zIndex: 11,
          display: "flex",
          flexDirection: "column",
          transform: isOpen ? "translateX(0)" : "translateX(320px)",
          transition: "transform 0.2s ease",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--dpf-border)", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 18, color, marginTop: 2 }}>{icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "var(--dpf-text)", margin: 0, lineHeight: 1.3 }}>
              {task.title}
            </p>
            <p style={{ fontSize: 10, color, margin: "4px 0 0", fontWeight: 600 }}>
              {task.specialist}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--dpf-muted)", cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Status */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--dpf-border)" }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 4,
              background:
                status === "done" ? "color-mix(in srgb, var(--dpf-success) 14%, transparent)" :
                status === "error" ? "color-mix(in srgb, var(--dpf-error) 14%, transparent)" :
                status === "running" ? `color-mix(in srgb, ${color} 14%, transparent)` :
                "var(--dpf-surface-2)",
              color:
                status === "done" ? "var(--dpf-success)" :
                status === "error" ? "var(--dpf-error)" :
                status === "running" ? color :
                "var(--dpf-muted)",
            }}
          >
            {status.toUpperCase()}
          </span>
        </div>

        {/* Files */}
        {task.files.length > 0 && (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--dpf-border)" }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 8px" }}>
              Files ({task.files.length})
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {task.files.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      padding: "1px 4px",
                      borderRadius: 2,
                      background: f.action === "create"
                        ? "color-mix(in srgb, var(--dpf-success) 14%, transparent)"
                        : "color-mix(in srgb, var(--dpf-warning) 14%, transparent)",
                      color: f.action === "create" ? "var(--dpf-success)" : "var(--dpf-warning)",
                      flexShrink: 0,
                      textTransform: "uppercase",
                    }}
                  >
                    {f.action}
                  </span>
                  <span style={{ fontSize: 9, color: "var(--dpf-muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.path}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Task description */}
        {task.task.implement && (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--dpf-border)" }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 6px" }}>
              What to build
            </p>
            <p style={{ fontSize: 11, color: "var(--dpf-text)", margin: 0, lineHeight: 1.5 }}>
              {task.task.implement}
            </p>
          </div>
        )}

        {/* Result output — shows outcome string + duration from orchestrator StoredTaskResults */}
        {taskEntry != null && (
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 6px" }}>
              Result
            </p>
            <div style={{
              fontSize: 9,
              fontFamily: "monospace",
              color: DONE_OUTCOMES.has(taskEntry.outcome) ? "var(--dpf-success)" : "var(--dpf-error)",
              background: "var(--dpf-surface-2)",
              borderRadius: 6,
              padding: "8px 10px",
              maxHeight: 200,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              {taskEntry.outcome}
              {taskEntry.durationMs > 0 && ` (${formatDuration(taskEntry.durationMs)})`}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd d:/DPF/apps/web && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
cd d:/DPF && git add apps/web/components/build/TaskInspector.tsx && git commit -m "feat(build): TaskInspector — slide-in panel with file list and result output"
```

---

## Phase 1D — ProcessGraph Canvas

### Task 7: `ProcessGraph.tsx`

**Files:**

- Create: `apps/web/components/build/ProcessGraph.tsx`

**Context:** The main ReactFlow canvas component. Receives `build: FeatureBuildRow` as a prop. Calls `buildPhaseGraph()` and (when build phase) `buildTaskGraph()`. Handles node click → opens `TaskInspector`. Imports `./process-graph.css` for animations. Pattern: mirror `EaCanvas.tsx` but simpler (read-only, no drag, no save).

- [ ] **Step 1: Create `ProcessGraph.tsx`**

```typescript
// apps/web/components/build/ProcessGraph.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  type Node, type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./process-graph.css";

import { buildPhaseGraph, buildTaskGraph, normalizeBuildSnapshot } from "@/lib/build/process-graph-builder";
import type { FeatureBuildRow } from "@/lib/explore/feature-build-types";
import type { AssignedTask } from "@/lib/integrate/task-dependency-graph";
import type { NodeStatus } from "@/lib/build/process-graph-builder";

import { PhaseNode } from "./PhaseNode";
import { TaskNode } from "./TaskNode";
import { ForkJoinNode } from "./ForkJoinNode";
import { AnimatedEdge } from "./AnimatedEdge";
import { TaskInspector } from "./TaskInspector";

const NODE_TYPES = {
  processPhase:    PhaseNode,
  processTask:     TaskNode,
  processForkJoin: ForkJoinNode,
};

const EDGE_TYPES = {
  animatedFlow: AnimatedEdge,
};

type SelectedTask = {
  task: AssignedTask;
  status: NodeStatus;
  color: string;
  icon: string;
};

type Props = {
  build: FeatureBuildRow;
  showTaskGraph?: boolean;
};

export function ProcessGraph({ build, showTaskGraph = true }: Props) {
  const [selectedTask, setSelectedTask] = useState<SelectedTask | null>(null);

  // Live running-task signal from SSE relay (orchestrator:task_dispatched events).
  // Uses a Set so multiple parallel tasks can show "running" simultaneously.
  // AgentCoworkerPanel relays these via build-progress-update CustomEvents after
  // Task 10 adds "orchestrator:task_dispatched" to RELAY_TYPES.
  const [activeTaskTitles, setActiveTaskTitles] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const data = (e as CustomEvent<{ type: string; taskTitle?: string }>).detail;
      if (data?.type === "orchestrator:task_dispatched" && data.taskTitle) {
        setActiveTaskTitles((prev) => new Set(prev).add(data.taskTitle!));
      }
      if (data?.type === "orchestrator:task_complete" && data.taskTitle) {
        setActiveTaskTitles((prev) => {
          const next = new Set(prev);
          next.delete(data.taskTitle!);
          return next;
        });
      }
      if (data?.type === "done") {
        // Build finished — clear all active titles
        setActiveTaskTitles(new Set());
      }
    };
    window.addEventListener("build-progress-update", handleUpdate);
    return () => window.removeEventListener("build-progress-update", handleUpdate);
  }, []);

  // Normalize raw build data + transient relay state into a graph-ready snapshot.
  // This is the single reconciliation point — graph builder never reads raw taskResults.
  const snapshot = useMemo(
    () => normalizeBuildSnapshot(build, activeTaskTitles),
    [build, activeTaskTitles],
  );

  // Compute graph from build data — recomputes on every build update or active task change
  const { phaseNodes, phaseEdges, taskNodes, taskEdges } = useMemo(() => {
    const { nodes: pn, edges: pe } = buildPhaseGraph(build, snapshot);

    const showTask =
      showTaskGraph &&
      build.buildPlan != null &&
      (build.phase === "build" || build.phase === "review" || build.phase === "ship" || build.phase === "complete");

    const { nodes: tn, edges: te } = showTask
      ? buildTaskGraph(build, snapshot)
      : { nodes: [], edges: [] };

    // Offset task graph below phase graph (160px gap)
    const offsetY = 130;
    const offsetTaskNodes = tn.map((n) => ({
      ...n,
      position: { x: n.position.x, y: n.position.y + offsetY },
    }));

    return {
      phaseNodes: pn,
      phaseEdges: pe,
      taskNodes: offsetTaskNodes,
      taskEdges: te,
    };
  }, [build, showTaskGraph, snapshot]);

  const allNodes = useMemo(() => [...phaseNodes, ...taskNodes], [phaseNodes, taskNodes]);
  const allEdges = useMemo(() => [...phaseEdges, ...taskEdges], [phaseEdges, taskEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(allNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(allEdges);

  useEffect(() => {
    setNodes(allNodes);
    setEdges(allEdges);
  }, [allNodes, allEdges, setNodes, setEdges]);

  const handleNodeClick: NodeMouseHandler = useCallback((_evt, node: Node) => {
    if (node.type !== "processTask") { setSelectedTask(null); return; }
    const d = node.data as { task: AssignedTask; status: NodeStatus; color: string; icon: string };
    setSelectedTask({ task: d.task, status: d.status, color: d.color, icon: d.icon });
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: "var(--dpf-bg)" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={() => setSelectedTask(null)}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnDrag
        zoomOnScroll
        minZoom={0.2}
        maxZoom={3}
      >
        <Background color="var(--dpf-border)" gap={24} size={1} />
        <Controls style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)" }} />
        <MiniMap
          nodeColor={(n) => {
            const d = n.data as { color?: string };
            return d.color ?? "var(--dpf-muted)";
          }}
          style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)" }}
        />
      </ReactFlow>

      {selectedTask != null && (
        <TaskInspector
          task={selectedTask.task}
          status={selectedTask.status}
          color={selectedTask.color}
          icon={selectedTask.icon}
          build={build}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}
```

**Important:** ReactFlow does not auto-sync when props change. The sync effect must re-seed when either the build payload or the live `activeTaskTitles` Set changes. Do not gate this effect only on `build.updatedAt`, or the running-task highlight will lag behind SSE events. The normalization layer (`normalizeBuildSnapshot`) is the single reconciliation point between DB state and transient relay events — never read `build.taskResults` directly in graph components.

```typescript
// Re-seed nodes/edges whenever the computed graph changes
useEffect(() => {
  setNodes(allNodes);
  setEdges(allEdges);
}, [allNodes, allEdges, setNodes, setEdges]);
```

- [ ] **Step 2: TypeScript check**

```bash
cd d:/DPF/apps/web && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
cd d:/DPF && git add apps/web/components/build/ProcessGraph.tsx && git commit -m "feat(build): ProcessGraph — ReactFlow canvas with phase + task graphs"
```

---

## Phase 1E — Wire into BuildStudio

### Task 8: Integrate ProcessGraph into BuildStudio

**Files:**

- Modify: `apps/web/components/build/BuildStudio.tsx`

**Context:** Add a "Graph" tab toggle to BuildStudio alongside the existing "preview" / "docs" tabs. When the graph tab is active, render `ProcessGraph` in the main content area and hide/collapse the PhaseIndicator (since the graph shows the same information at higher fidelity). Keep PhaseIndicator for when graph is not shown (mobile or collapsed).

- [ ] **Step 1: Read the current BuildStudio.tsx to understand tab state and layout**

Read `apps/web/components/build/BuildStudio.tsx` in full to understand the existing tab switch (`buildView` state, `"preview" | "docs"`) and where `PhaseIndicator` renders.

- [ ] **Step 2: Add "graph" to the view toggle**

Find the `buildView` state type and the toggle buttons. Add `"graph"` as a new option:

```typescript
// Change:
const [buildView, setBuildView] = useState<"preview" | "docs">("preview");
// To:
const [buildView, setBuildView] = useState<"preview" | "docs" | "graph">("graph");
```

Default to `"graph"` so users see it immediately on first load.

- [ ] **Step 3: Add the ProcessGraph import**

```typescript
import { ProcessGraph } from "./ProcessGraph";
```

- [ ] **Step 4: Add "Graph" tab button**

In the tab toggle UI (look for the `buildView === "preview"` / `"docs"` buttons), add a third button for `"graph"`. Follow the existing button style exactly — do not change anything about the other buttons.

- [ ] **Step 5: Add the ProcessGraph render block**

In the content area where `buildView === "preview"` renders `<SandboxPreview>` and `buildView === "docs"` renders something else, add:

```typescript
{buildView === "graph" && activeBuild && (
  <div style={{ height: "calc(100vh - 200px)", minHeight: 400 }}>
    <ProcessGraph build={activeBuild} />
  </div>
)}
```

- [ ] **Step 6: Conditionally hide PhaseIndicator when graph is active**

Find the `<PhaseIndicator>` render. Wrap it:

```typescript
{activeBuild && buildView !== "graph" && (
  <PhaseIndicator currentPhase={activeBuild.phase} />
)}
```

- [ ] **Step 7: TypeScript check**

```bash
cd d:/DPF/apps/web && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 8: Run tests**

```bash
cd d:/DPF && pnpm --filter @dpf/web test 2>&1 | tail -10
```

- [ ] **Step 9: Commit**

```bash
cd d:/DPF && git add apps/web/components/build/BuildStudio.tsx && git commit -m "feat(build): integrate ProcessGraph into BuildStudio with graph/preview/docs tabs"
```

---

## Phase 1F — Smoke Test

### Task 9: Manual smoke test

**No code changes. Verify the graph renders correctly in the browser.**

- [ ] **Step 1: Start the dev server**

```bash
cd d:/DPF && docker compose up -d && sleep 5
```

Then open `http://localhost:3000/build` in the browser.

- [ ] **Step 2: Check Phase Graph**

With any existing build open (or create a new one):

- The "Graph" tab should be selected by default
- Five phase nodes should be visible in a left-to-right line: Ideate → Plan → Build → Review → Ship
- The current phase node should have a colored border (not gray)
- Completed phases should have a green ✓ badge

- [ ] **Step 3: Check Task Graph**

With a build that has a `buildPlan` (one that has progressed past Plan phase):

- Below the phase nodes, task nodes should appear with role-colored borders
- Parallel tasks should have fork/join circles flanking them
- Specialist label and file count should be visible on each node

- [ ] **Step 4: Check animations**

With an active build (phase = "build"):

- The Build phase node should have a pulsing border ring (animates every ~1.4s)
- The edge from Plan → Build should animate (dashes travel left to right)
- When build updates (SSE event fires), nodes should update status without full page reload

- [ ] **Step 5: Check inspector**

Click any `TaskNode`:

- A 320px panel should slide in from the right
- Files list should be visible with create/modify badges
- Click the ✕ or the dim overlay to close

- [ ] **Step 6: Commit if any minor adjustments made**

```bash
cd d:/DPF && git add -p && git commit -m "fix(build): process graph smoke test adjustments"
```

---

## Phase 2 — EA Quick Unlocks

These are small, independent changes. Ship each as a separate commit.

---

### Task 10: Add `orchestrator:task_dispatched` to relay list in AgentCoworkerPanel

**Files:**

- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`

**Context:** `AgentCoworkerPanel` handles `orchestrator:task_dispatched` SSE events to update its own internal `buildTasks` state (line 163), but does NOT relay them to `BuildStudio` via the `build-progress-update` DOM event. The relay list at line 240 must include this event type so `ProcessGraph` can capture the live `taskTitle` for the running-node indicator. BPMN node rendering is already working via `EaElementNode`'s internal `neoLabel.startsWith("BPMN__")` dispatch — no `EaCanvas.tsx` NODE_TYPES change is needed.

- [ ] **Step 1: Read `AgentCoworkerPanel.tsx` around line 240 to confirm the exact RELAY_TYPES array**

- [ ] **Step 2: Add `"orchestrator:task_dispatched"` to RELAY_TYPES**

Find:

```typescript
const RELAY_TYPES = ["phase:change", "evidence:update", "sandbox:ready", "orchestrator:task_complete", "done"];
```

Replace with:

```typescript
const RELAY_TYPES = ["phase:change", "evidence:update", "sandbox:ready", "orchestrator:task_dispatched", "orchestrator:task_complete", "done"];
```

- [ ] **Step 3: TypeScript check**

```bash
cd d:/DPF/apps/web && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Run tests**

```bash
cd d:/DPF && pnpm --filter @dpf/web test 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
cd d:/DPF && git add apps/web/components/agent/AgentCoworkerPanel.tsx && git commit -m "feat(build): relay orchestrator:task_dispatched to ProcessGraph for live running-task indicator"
```

---

### Task 11: Enable New View Creation

**Files:**

- Modify: `apps/web/lib/actions/ea.ts`
- Modify: `apps/web/app/(shell)/ea/page.tsx`

**Context:** Extend the existing `createEaView()` server action and enable the disabled button with an inline creation form. Keep the action backward-compatible with the current `EaView` data model (`notationId`, `scopeType`, optional `scopeRef`, optional `viewpointId`) while also allowing the UI to call it by `notationSlug`. The action should return the new `id` so the client can redirect to `/ea/views/[id]`.

- [ ] **Step 1: Read `apps/web/lib/actions/ea.ts` top 30 lines to understand action patterns in this file**

- [ ] **Step 2: Extend the existing `createEaView` in `apps/web/lib/actions/ea.ts`**

Do not replace the current action with a narrower signature. Update `CreateEaViewInput` and `createEaView()` so the action accepts either `notationId` or `notationSlug`, keeps `scopeType` and `viewpointId` support, and returns `{ id: string }` for new callers:

```typescript
type CreateEaViewInput = {
  name: string;
  description?: string;
  notationId?: string;
  notationSlug?: string;
  layoutType: string;
  scopeType: string;
  scopeRef?: string;
  viewpointId?: string;
};

export async function createEaView(input: CreateEaViewInput): Promise<{ id: string } | { error: string }> {
  const { userId } = await requireManageEaModel();
  const { name, description, notationId, notationSlug, layoutType, scopeType, scopeRef, viewpointId } = input;
  if (!name.trim()) return { error: "Name is required" };

  const resolvedNotationId = notationId
    ?? (notationSlug
      ? (await prisma.eaNotation.findUnique({ where: { slug: notationSlug }, select: { id: true } }))?.id
      : null);
  if (!resolvedNotationId) return { error: "Notation is required" };

  const view = await prisma.eaView.create({
    data: {
      name: name.trim(),
      description: description?.trim() ?? null,
      notationId: resolvedNotationId,
      layoutType,
      scopeType,
      scopeRef: scopeRef ?? null,
      viewpointId: viewpointId ?? null,
      status: "draft",
      createdById: userId,
      canvasState: { viewport: { x: 0, y: 0, zoom: 1 }, nodes: {} },
    },
  });

  return { id: view.id };
}
```

`updateEaView` can continue using `Partial<CreateEaViewInput>` once the shared type is extended. No inline replacement is needed.

- [ ] **Step 3: Convert `ea/page.tsx` to a client component with inline form**

The page is currently a server component. To handle form state, convert it to a thin client wrapper or add a separate `CreateViewButton` client component. The simplest approach: add a `CreateViewButton.tsx` client component.

Create `apps/web/components/ea/CreateViewButton.tsx`:

```typescript
// apps/web/components/ea/CreateViewButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createEaView } from "@/lib/actions/ea";

const NOTATION_OPTIONS = [
  { value: "archimate4", label: "ArchiMate 4" },
  { value: "bpmn20", label: "BPMN 2.0" },
];

const LAYOUT_OPTIONS = [
  { value: "graph", label: "Graph" },
  { value: "swimlane", label: "Swimlane" },
];

export function CreateViewButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [notation, setNotation] = useState("archimate4");
  const [layout, setLayout] = useState("graph");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    const result = await createEaView({
      name,
      description: null,
      notationSlug: notation,
      layoutType: layout,
      scopeType: "custom",
    });
    setSaving(false);
    if ("error" in result) { setError(result.error); return; }
    router.push(`/ea/views/${result.id}`);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{ padding: "6px 14px", background: "var(--dpf-accent)", border: "none", borderRadius: 5, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
      >
        + New view
      </button>

      {open && (
        <div style={{ position: "fixed", inset: 0, background: "color-mix(in srgb, var(--dpf-text) 50%, transparent)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", borderRadius: 10, padding: 24, width: 360, maxWidth: "90vw" }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--dpf-text)", margin: "0 0 16px" }}>New EA View</h2>

            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 11, color: "var(--dpf-muted)", display: "block", marginBottom: 4 }}>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Build Studio Process Flow"
                style={{ width: "100%", padding: "7px 10px", background: "var(--dpf-surface-2)", border: "1px solid var(--dpf-border)", borderRadius: 5, color: "var(--dpf-text)", fontSize: 12, boxSizing: "border-box" }}
              />
            </label>

            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 11, color: "var(--dpf-muted)", display: "block", marginBottom: 4 }}>Notation</span>
              <select
                value={notation}
                onChange={(e) => setNotation(e.target.value)}
                style={{ width: "100%", padding: "7px 10px", background: "var(--dpf-surface-2)", border: "1px solid var(--dpf-border)", borderRadius: 5, color: "var(--dpf-text)", fontSize: 12 }}
              >
                {NOTATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "block", marginBottom: 16 }}>
              <span style={{ fontSize: 11, color: "var(--dpf-muted)", display: "block", marginBottom: 4 }}>Layout</span>
              <select
                value={layout}
                onChange={(e) => setLayout(e.target.value)}
                style={{ width: "100%", padding: "7px 10px", background: "var(--dpf-surface-2)", border: "1px solid var(--dpf-border)", borderRadius: 5, color: "var(--dpf-text)", fontSize: 12 }}
              >
                {LAYOUT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {error != null && <p style={{ fontSize: 11, color: "var(--dpf-error)", margin: "0 0 12px" }}>{error}</p>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => { setOpen(false); setError(null); setName(""); }}
                style={{ padding: "6px 14px", background: "transparent", border: "1px solid var(--dpf-border)", borderRadius: 5, color: "var(--dpf-muted)", fontSize: 12, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                style={{ padding: "6px 14px", background: "var(--dpf-accent)", border: "none", borderRadius: 5, color: "#fff", fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}
              >
                {saving ? "Creating..." : "Create view"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Replace disabled button in `ea/page.tsx`**

In `apps/web/app/(shell)/ea/page.tsx`, find the disabled `<button>` block:

```typescript
<button
  disabled
  style={{ ... }}
  title="New view creation coming soon"
>
  + New view
</button>
```

Replace with:

```typescript
import { CreateViewButton } from "@/components/ea/CreateViewButton";
// ...
<CreateViewButton />
```

- [ ] **Step 5: TypeScript check**

```bash
cd d:/DPF/apps/web && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Run tests**

```bash
cd d:/DPF && pnpm --filter @dpf/web test 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
cd d:/DPF && git add apps/web/lib/actions/ea.ts apps/web/components/ea/CreateViewButton.tsx apps/web/app/(shell)/ea/page.tsx && git commit -m "feat(ea): enable New View creation — modal form + createEaView server action"
```

---

### Task 12: Traversal Run Panel in Element Inspector

**Files:**

- Modify: `apps/web/components/ea/ElementInspector.tsx`
- Create: `apps/web/lib/actions/ea-traversal.ts`

**Context:** Add a "Run Traversal" collapsible section at the bottom of `ElementInspector`. On run, call an auth-gated server action wrapper around `runTraversalPattern()` and display the path result as a breadcrumb trail.

The `ElementInspector` component must receive a `notationSlug: string` prop from its parent. The current EA page flow does not expose `notation.slug` yet, only `notationId`, so thread this through explicitly:
- add `notation: { slug: true }` to `getEaView()`
- return `notationSlug` from the serialized view payload
- pass `view.notationSlug` from `EaViewPage` to `EaCanvas`
- pass `notationSlug` from `EaCanvas` to `ElementInspector`

Do not hardcode `"archimate4"` anywhere in this task.

- [ ] **Step 1: Read `ElementInspector.tsx` to understand its structure and props**

- [ ] **Step 2: Create the traversal server action wrapper**

Create `apps/web/lib/actions/ea-traversal.ts`:

```typescript
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { runTraversalPattern as _runTraversalPattern } from "@/lib/ea/traversal-executor";

async function requireEaTraversalAccess() {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_ea_model")) {
    throw new Error("Unauthorized");
  }
}

// Auth-gated: returns traversal patterns for the given notation slug.
// notationSlug comes from the current view (e.g. "archimate4" or "bpmn20") —
// do NOT hardcode it here.
export async function getTraversalPatterns(notationSlug: string) {
  await requireEaTraversalAccess();
  const notation = await prisma.eaNotation.findUnique({ where: { slug: notationSlug } });
  if (!notation) return [];
  return prisma.eaTraversalPattern.findMany({
    where: { notationId: notation.id },
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });
}

// Auth-gated re-export of the traversal executor.
export async function runTraversalPattern(
  ...args: Parameters<typeof _runTraversalPattern>
) {
  await requireEaTraversalAccess();
  return _runTraversalPattern(...args);
}
```

- [ ] **Step 3: Add TraversalPanel to ElementInspector**

At the bottom of `ElementInspector.tsx`, add a collapsible "Traversal" section. The section shows:

1. A dropdown of pattern slugs (fetched once via `useEffect` from `getTraversalPatterns`)
2. A "Run" button
3. Result: a list of `pathStep.elementName → pathStep.relationshipType → ...`

The implementation is a client-side addition — `ElementInspector` is already `"use client"`.

**Before editing:** update the view data path first.
1. Modify `getEaView()` to select and return `notation.slug` as `notationSlug`
2. Pass `view.notationSlug` from `apps/web/app/(shell)/ea/views/[id]/page.tsx` into `EaCanvas`
3. Add `notationSlug: string` to `EaCanvas` props and pass it into `ElementInspector`

Add after the last section in the inspector:

```typescript
// At the top: add useState, useEffect, and import actions
import { getTraversalPatterns, runTraversalPattern } from "@/lib/actions/ea-traversal";

// In the component, add state:
const [traversalOpen, setTraversalOpen] = useState(false);
const [patterns, setPatterns] = useState<{ slug: string; name: string }[]>([]);
const [selectedPattern, setSelectedPattern] = useState("");
const [traversalResult, setTraversalResult] = useState<string[] | null>(null);
const [traversalRunning, setTraversalRunning] = useState(false);

// Load patterns when selected element changes.
// notationSlug is a prop on ElementInspector, passed from the parent that holds the current view.
// Reading it from props (not hardcoding) ensures BPMN views get BPMN patterns.
useEffect(() => {
  if (!selected) return;
  getTraversalPatterns(notationSlug).then((ps) => {
    setPatterns(ps);
    if (ps.length > 0 && ps[0]) setSelectedPattern(ps[0].slug);
  });
}, [selected?.elementId, notationSlug]);

// Handler:
async function handleRunTraversal() {
  if (!selected || !selectedPattern) return;
  setTraversalRunning(true);
  setTraversalResult(null);
  const result = await runTraversalPattern({
    patternSlug: selectedPattern,
    startElementIds: [selected.elementId],
  });
  setTraversalRunning(false);
  if (!result.ok || !result.data) {
    setTraversalResult([`Error: ${result.error ?? "unknown"}`]);
    return;
  }
  const pathStrings = result.data.paths.map((path) =>
    path.steps.map((s) => s.elementName).join(" → ")
  );
  setTraversalResult(pathStrings.length > 0 ? pathStrings : ["No paths found"]);
}

// JSX to add at the bottom of the inspector (before the closing </div>):
{patterns.length > 0 && (
  <div style={{ borderTop: "1px solid var(--dpf-border)", padding: "10px 14px" }}>
    <button
      onClick={() => setTraversalOpen((v) => !v)}
      style={{ background: "none", border: "none", color: "var(--dpf-muted)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 4 }}
    >
      {traversalOpen ? "▼" : "►"} Run Traversal
    </button>
    {traversalOpen && (
      <div style={{ marginTop: 8 }}>
        <select
          value={selectedPattern}
          onChange={(e) => setSelectedPattern(e.target.value)}
          style={{ width: "100%", padding: "5px 8px", background: "var(--dpf-surface-2)", border: "1px solid var(--dpf-border)", borderRadius: 4, color: "var(--dpf-text)", fontSize: 11, marginBottom: 6 }}
        >
          {patterns.map((p) => (
            <option key={p.slug} value={p.slug} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
              {p.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleRunTraversal}
          disabled={traversalRunning}
          style={{ padding: "4px 10px", background: "var(--dpf-accent)", border: "none", borderRadius: 4, color: "#fff", fontSize: 10, fontWeight: 600, cursor: traversalRunning ? "not-allowed" : "pointer", opacity: traversalRunning ? 0.6 : 1 }}
        >
          {traversalRunning ? "Running..." : "Run"}
        </button>
        {traversalResult != null && (
          <div style={{ marginTop: 8 }}>
            {traversalResult.map((path, i) => (
              <p key={i} style={{ fontSize: 10, color: "var(--dpf-text)", margin: "3px 0", fontFamily: "monospace" }}>
                {path}
              </p>
            ))}
          </div>
        )}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: TypeScript check**

```bash
cd d:/DPF/apps/web && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Run tests**

```bash
cd d:/DPF && pnpm --filter @dpf/web test 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
cd d:/DPF && git add apps/web/lib/actions/ea-traversal.ts apps/web/components/ea/ElementInspector.tsx && git commit -m "feat(ea): traversal run panel in ElementInspector — select pattern, run, view path results"
```

---

## Phase 3 — Final Verification

### Task 13: Full test and type check

- [ ] **Step 1: Run full test suite**

```bash
cd d:/DPF && pnpm --filter @dpf/web test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 2: TypeScript check**

```bash
cd d:/DPF/apps/web && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3: Update QA plan**

Add or update test cases in `tests/e2e/platform-qa-plan.md` for:
1. Build Studio graph tab renders and updates during a live build
2. EA New View modal creates both ArchiMate and BPMN views
3. EA traversal panel asks for a pattern and renders path output

- [ ] **Step 4: Manual smoke — EA New View**

1. Open `http://localhost:3000/ea`
2. Click "+ New view" → modal opens
3. Enter a name, select BPMN 2.0, click "Create view" → redirects to `/ea/views/[id]`
4. Canvas is empty (expected — no elements yet)
5. Element palette shows BPMN element types

- [ ] **Step 5: Manual smoke — Traversal panel**

1. Open any EA view with elements
2. Click an element → `ElementInspector` opens
3. Scroll to bottom → "Run Traversal" section appears if traversal patterns exist
4. Select a pattern and click "Run" → path results display as `A → B → C` strings

- [ ] **Step 6: Production build gate** (required — do not skip)

```bash
cd d:/DPF/apps/web && pnpm next build 2>&1 | tail -20
```

Expected: build completes with no errors. Fix any type errors or import issues before proceeding.

- [ ] **Step 7: Run affected QA phases**

Run the affected portions of `tests/e2e/platform-qa-plan.md` covering Build Studio, EA modeling, and AI coworker cross-cutting behavior if the relay wiring changes user-visible coworker progress.

- [ ] **Step 8: Push**

```bash
cd d:/DPF && git push
```

---

## Architecture Summary

```text
BuildStudio.tsx
  └── ProcessGraph.tsx (new)
       ├── process-graph-builder.ts (pure, no React)  ← builds nodes/edges from FeatureBuildRow
       ├── PhaseNode.tsx          ← Level 1: Ideate/Plan/Build/Review/Ship
       ├── TaskNode.tsx           ← Level 2: specialist task cards
       ├── ForkJoinNode.tsx       ← 16px circles for parallel task groups
       ├── AnimatedEdge.tsx       ← stroke-dasharray traveling animation
       ├── TaskInspector.tsx      ← 320px slide-in panel on task click
       └── process-graph.css      ← CSS keyframe animations

EaCanvas.tsx (modified)
  └── ElementInspector.tsx (modified) += traversal run panel + notationSlug prop

ea-data.ts (modified)
  └── getEaView() returns notationSlug for EA traversal UI

ea/page.tsx (modified)
  └── CreateViewButton.tsx (new)  ← modal form + createEaView action
```

**Update flow:**

```text
SSE event / DB poll
  → debouncedRefetch()
  → getFeatureBuild(buildId)
  → setActiveBuild(fresh)   (in BuildStudio)
  → ProcessGraph receives new build prop
  → useMemo recomputes graph from build + activeTaskTitle
  → setNodes/setEdges with recomputed graph
  → React re-renders only changed nodes (status → CSS class change)
  → CSS animation starts/stops based on class
```

No new npm packages. No DB schema changes. No new API routes. All animation is CSS (compositor thread, no JS timers).
