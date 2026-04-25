// apps/web/lib/build/process-graph-builder.ts
// Pure function module: FeatureBuildRow -> ReactFlow { nodes, edges }
// No DB, no React, no side effects.

import type {
  BuildPhase,
  FeatureBuildRow,
} from "@/lib/explore/feature-build-types";
import type { BuildFlowState } from "@/lib/build-flow-state";
import {
  PHASE_LABELS,
  VISIBLE_PHASES,
} from "@/lib/explore/feature-build-types";
import {
  describePromoteFork,
  describeUpstreamFork,
  type ReleaseDecisionTone,
} from "@/lib/build/release-decision";
import {
  buildDependencyGraph,
  type AssignedTask,
  type ExecutionPhase,
  type SpecialistRole,
} from "@/lib/integrate/task-dependency-graph";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Unicode icons for each build phase */
export const PHASE_ICONS: Record<BuildPhase, string> = {
  ideate:   "◈",
  plan:     "▤",
  build:    "⚙",
  review:   "◎",
  ship:     "▶",
  complete: "✓",
  failed:   "✗",
};

/** CSS variable colours for specialist roles (used in task nodes) */
export const ROLE_COLOURS: Record<SpecialistRole, string> = {
  "data-architect": "var(--pg-role-data-architect)",
  "software-engineer": "var(--pg-role-software-engineer)",
  "frontend-engineer": "var(--pg-role-frontend-engineer)",
  "qa-engineer": "var(--pg-role-qa-engineer)",
};

/** Unicode icons for specialist roles */
export const ROLE_ICONS: Record<SpecialistRole, string> = {
  "data-architect":    "◈",
  "software-engineer": "⌨",
  "frontend-engineer": "◻",
  "qa-engineer":       "✓",
};

/** Map each BuildPhase to its ordinal index for comparison */
const PHASE_ORDER: BuildPhase[] = [
  "ideate", "plan", "build", "review", "ship", "complete", "failed",
];

const PHASE_ORDER_INDEX: Record<string, number> = {};
for (let i = 0; i < PHASE_ORDER.length; i++) {
  const p = PHASE_ORDER[i];
  if (p != null) {
    PHASE_ORDER_INDEX[p] = i;
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type NodeStatus = "pending" | "running" | "done" | "error";

export type ProcessActorKind = "ai_coworker" | "system" | "human_hitl" | "review_gate";

export type PhaseNodeData = {
  label: string;
  status: NodeStatus;
  color: string;
  icon: string;
  phase: BuildPhase;
  deliberationLabel?: string;
  deliberationState?: string;
};

export type TaskNodeData = {
  label: string;
  status: NodeStatus;
  specialist: SpecialistRole;
  roleColor: string;
  roleIcon: string;
  actorKind: ProcessActorKind;
  actorLabel: string;
  taskIndex: number;
};

export type ReleaseForkNodeData = {
  label: string;
  status: NodeStatus;
  tone: ReleaseDecisionTone;
  statusLabel: string;
  detail: string;
  href?: string;
  forkKind: "upstream" | "promote";
};

export type PhaseProcessNode = {
  id: string;
  type: "processPhase";
  position: { x: number; y: number };
  data: PhaseNodeData;
};

export type TaskProcessNode = {
  id: string;
  type: "processTask";
  position: { x: number; y: number };
  data: TaskNodeData;
};

export type ForkJoinProcessNode = {
  id: string;
  type: "processForkJoin";
  position: { x: number; y: number };
  data: PhaseNodeData;
};

export type ReleaseForkProcessNode = {
  id: string;
  type: "processReleaseFork";
  position: { x: number; y: number };
  data: ReleaseForkNodeData;
};

export type ProcessNode = PhaseProcessNode | TaskProcessNode | ForkJoinProcessNode | ReleaseForkProcessNode;

export type ProcessEdge = {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
};

export type GraphOutput = {
  nodes: ProcessNode[];
  edges: ProcessEdge[];
};

/** A single task result after normalization from the runtime shape */
export type NormalizedStoredTaskResult = {
  title: string;
  specialist: string;
  outcome: string;
  durationMs: number;
};

/** Snapshot of build process state, normalized for graph building */
export type NormalizedBuildProcessSnapshot = {
  /** Map of task title -> normalized result */
  storedTaskResults: Map<string, NormalizedStoredTaskResult>;
  /** Set of currently active task titles (supports parallel tasks) */
  activeTaskTitles: Set<string>;
  /** Map of task title -> actor info */
  taskActors: Map<string, { kind: ProcessActorKind; label: string }>;
  /** Map of phase -> actor info */
  phaseActors: Map<BuildPhase, { kind: ProcessActorKind; label: string }>;
};

// ─── Phase Status ───────────────────────────────────────────────────────────

/**
 * Determine the display status of a visible phase given the build state.
 *
 * Logic:
 * - If the build is "complete", all visible phases are "done".
 * - If the build is "failed", phases before the failure point are "done",
 *   the failing phase is "error", and later phases are "pending".
 * - Otherwise, phases before the current phase are "done", the current
 *   phase is "running", and later phases are "pending".
 */
export function getPhaseNodeStatus(
  phase: BuildPhase,
  build: FeatureBuildRow,
): NodeStatus {
  const currentPhase = build.phase;

  // "complete" means everything is done
  if (currentPhase === "complete") {
    return "done";
  }

  // "failed" means we need to figure out which phase failed
  if (currentPhase === "failed") {
    return getFailedPhaseStatus(phase, build);
  }

  const phaseIdx = PHASE_ORDER_INDEX[phase] ?? 0;
  const currentIdx = PHASE_ORDER_INDEX[currentPhase] ?? 0;

  if (phaseIdx < currentIdx) return "done";
  if (phaseIdx === currentIdx) return "running";
  return "pending";
}

/**
 * When a build has failed, determine which phase was the last completed
 * handoff and mark the next phase as error.
 */
function getFailedPhaseStatus(
  phase: BuildPhase,
  build: FeatureBuildRow,
): NodeStatus {
  const handoffs = build.phaseHandoffs;
  if (handoffs == null || handoffs.length === 0) {
    // No handoffs — failure happened in the first phase
    if (phase === "ideate") return "error";
    return "pending";
  }

  // Find the last phase that was successfully handed off TO
  let lastHandedToIdx = -1;
  for (const h of handoffs) {
    const toIdx = PHASE_ORDER_INDEX[h.toPhase] ?? -1;
    if (toIdx > lastHandedToIdx) {
      lastHandedToIdx = toIdx;
    }
  }

  const phaseIdx = PHASE_ORDER_INDEX[phase] ?? 0;

  // Phases before the last handoff target are done
  if (phaseIdx < lastHandedToIdx) return "done";
  // The last handoff target phase is where the failure happened
  if (phaseIdx === lastHandedToIdx) return "error";
  return "pending";
}

// ─── Phase Graph ────────────────────────────────────────────────────────────

const PHASE_X_SPACING = 280;
const PHASE_Y = 0;
const RELEASE_FORK_Y = 120;
const RELEASE_FORK_OFFSET = 140;

/**
 * Build a ReactFlow graph of the 5 visible build phases.
 * Nodes are positioned left-to-right with PHASE_X_SPACING between them.
 */
export function buildPhaseGraph(build: FeatureBuildRow, flowState?: BuildFlowState | null): GraphOutput {
  const nodes: ProcessNode[] = [];
  const edges: ProcessEdge[] = [];

  for (let i = 0; i < VISIBLE_PHASES.length; i++) {
    const phase = VISIBLE_PHASES[i]!;
    const status = getPhaseNodeStatus(phase, build);
    const label = PHASE_LABELS[phase] ?? phase;
    const icon = PHASE_ICONS[phase] ?? "circle";
    const phaseSummary = phase in (build.deliberationSummary ?? {})
      ? build.deliberationSummary?.[phase as keyof NonNullable<FeatureBuildRow["deliberationSummary"]>] ?? null
      : null;

    // Use a neutral hex color per-status for graph display
    const color = statusToColor(status);

    nodes.push({
      id: `phase-${phase}`,
      type: "processPhase",
      position: { x: i * PHASE_X_SPACING, y: PHASE_Y },
      data: {
        label,
        status,
        color,
        icon,
        phase,
        deliberationLabel: phaseSummary
          ? phaseSummary.patternSlug === "debate"
            ? "Debate"
            : "Peer Review"
          : undefined,
        deliberationState: phaseSummary?.consensusState,
      },
    });

    // Edge from previous phase to this one
    if (i > 0) {
      const prevPhase = VISIBLE_PHASES[i - 1]!;
      edges.push({
        id: `edge-phase-${prevPhase}-${phase}`,
        source: `phase-${prevPhase}`,
        target: `phase-${phase}`,
        animated: status === "running",
      });
    }
  }

  if (flowState && shouldShowReleaseForks(flowState)) {
    const shipX = (VISIBLE_PHASES.length - 1) * PHASE_X_SPACING;
    const upstream = describeUpstreamFork(flowState.upstream);
    const promote = describePromoteFork(flowState.promote);

    nodes.push({
      id: "release-upstream",
      type: "processReleaseFork",
      position: { x: shipX - RELEASE_FORK_OFFSET, y: RELEASE_FORK_Y },
      data: {
        label: upstream.title,
        status: nodeStatusFromForkTone(upstream.tone),
        tone: upstream.tone,
        statusLabel: upstream.statusLabel,
        detail: upstream.detail,
        href: upstream.href,
        forkKind: "upstream",
      },
    });

    nodes.push({
      id: "release-promote",
      type: "processReleaseFork",
      position: { x: shipX + RELEASE_FORK_OFFSET, y: RELEASE_FORK_Y },
      data: {
        label: promote.title,
        status: nodeStatusFromForkTone(promote.tone),
        tone: promote.tone,
        statusLabel: promote.statusLabel,
        detail: promote.detail,
        forkKind: "promote",
      },
    });

    edges.push({
      id: "edge-phase-ship-release-upstream",
      source: "phase-ship",
      target: "release-upstream",
      animated: flowState.upstream.state === "in_progress",
    });
    edges.push({
      id: "edge-phase-ship-release-promote",
      source: "phase-ship",
      target: "release-promote",
      animated: flowState.promote.state === "in_progress",
    });
  }

  return { nodes, edges };
}

function shouldShowReleaseForks(flowState: BuildFlowState): boolean {
  return flowState.upstream.state !== "pending" || flowState.promote.state !== "pending";
}

function nodeStatusFromForkTone(tone: ReleaseDecisionTone): NodeStatus {
  switch (tone) {
    case "success":
      return "done";
    case "danger":
      return "error";
    case "info":
    case "warning":
      return "running";
    case "neutral":
    default:
      return "pending";
  }
}

function statusToColor(status: NodeStatus): string {
  switch (status) {
    case "done": return "#4ade80";
    case "running": return "#38bdf8";
    case "error": return "#f87171";
    case "pending":
    default: return "#6b7280";
  }
}

// ─── Normalization ──────────────────────────────────────────────────────────

/**
 * Parse the runtime taskResults shape (which differs from the TypeScript type)
 * and build a normalized snapshot for graph building.
 *
 * Runtime shape:
 * { completedTasks, totalTasks, timedOut, tasks: Array<{title, specialist, outcome, durationMs}>, timestamp }
 *
 * TypeScript type says TaskResult[] | null but the orchestrator stores the above.
 */
export function normalizeBuildSnapshot(
  build: FeatureBuildRow,
  activeTaskTitles: Set<string> = new Set(),
): NormalizedBuildProcessSnapshot {
  const storedTaskResults = new Map<string, NormalizedStoredTaskResult>();
  const taskActors = new Map<string, { kind: ProcessActorKind; label: string }>();

  if (build.taskResults != null) {
    const raw = build.taskResults as unknown;

    if (raw != null && typeof raw === "object" && "tasks" in raw) {
      // Runtime shape: { tasks: Array<{title, specialist, outcome, durationMs}> }
      const runtimeResult = raw as {
        tasks?: Array<{
          title: string;
          specialist: string;
          outcome: string;
          durationMs: number;
        }>;
      };

      if (Array.isArray(runtimeResult.tasks)) {
        for (const t of runtimeResult.tasks) {
          storedTaskResults.set(t.title, {
            title: t.title,
            specialist: t.specialist,
            outcome: t.outcome,
            durationMs: t.durationMs,
          });
          taskActors.set(t.title, {
            kind: "ai_coworker",
            label: formatSpecialistLabel(t.specialist),
          });
        }
      }
    } else if (Array.isArray(raw)) {
      // TypeScript type shape fallback: TaskResult[]
      for (const t of raw as Array<{ title?: string; taskIndex?: number }>) {
        const title = t.title ?? `Task ${t.taskIndex ?? 0}`;
        storedTaskResults.set(title, {
          title,
          specialist: "software-engineer",
          outcome: "DONE",
          durationMs: 0,
        });
        taskActors.set(title, { kind: "ai_coworker", label: "Software Engineer" });
      }
    }
  }

  // Build phase actor map from handoffs
  const phaseActors = new Map<BuildPhase, { kind: ProcessActorKind; label: string }>();
  const handoffs = build.phaseHandoffs ?? [];
  for (const h of handoffs) {
    const phase = h.fromPhase as BuildPhase;
    phaseActors.set(phase, {
      kind: "ai_coworker",
      label: h.fromAgentId ?? "AI Coworker",
    });
  }
  // Active phase with no handoff yet
  if (build.phase !== "complete" && build.phase !== "failed") {
    if (!phaseActors.has(build.phase)) {
      const inbound = handoffs.find((h) => h.toPhase === build.phase);
      phaseActors.set(build.phase, {
        kind: "ai_coworker",
        label: inbound?.toAgentId ?? "AI Coworker",
      });
    }
  }

  return { storedTaskResults, activeTaskTitles, taskActors, phaseActors };
}

function formatSpecialistLabel(specialist: string): string {
  return specialist
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ─── Task Status ────────────────────────────────────────────────────────────

const DONE_OUTCOMES = new Set(["DONE", "DONE_WITH_CONCERNS"]);

/**
 * Determine the display status of a single task from the normalized snapshot.
 * Matches by title (NOT by index — the orchestrator stores by title).
 *
 * Priority:
 * 1. If task has a stored result with DONE/DONE_WITH_CONCERNS outcome -> "done"
 * 2. If task has a stored result with other outcome -> "error"
 * 3. If build.phase !== "build" -> "pending" (tasks only run during build)
 * 4. If task is in activeTaskTitles Set -> "running"
 * 5. Otherwise -> "pending"
 */
export function getTaskNodeStatus(
  taskTitle: string,
  build: FeatureBuildRow,
  snapshot: NormalizedBuildProcessSnapshot,
): NodeStatus {
  // Check stored results first — a completed task is never "running"
  const result = snapshot.storedTaskResults.get(taskTitle);
  if (result != null) {
    return DONE_OUTCOMES.has(result.outcome) ? "done" : "error";
  }

  // Tasks only run during the build phase
  if (build.phase !== "build") return "pending";

  // Live signal: SSE relay told us this task is dispatched right now
  if (snapshot.activeTaskTitles.has(taskTitle)) return "running";

  return "pending";
}

// ─── Task Graph ─────────────────────────────────────────────────────────────

const TASK_X_START = 40;
const TASK_X_SPACING = 260;
const TASK_Y_START = 40;
const TASK_Y_SPACING = 100;
const FORK_JOIN_Y_OFFSET = 40;

/**
 * Build a ReactFlow graph of the build plan tasks.
 * Uses buildDependencyGraph() to determine execution phases and parallelism.
 *
 * Layout:
 * - Each execution phase is a column (x axis)
 * - Parallel tasks within a phase are stacked vertically (y axis)
 * - Fork/join nodes are added for parallel phases
 */
export function buildTaskGraph(
  build: FeatureBuildRow,
  snapshot: NormalizedBuildProcessSnapshot,
): GraphOutput {
  if (build.buildPlan == null) {
    return { nodes: [], edges: [] };
  }

  const { fileStructure, tasks } = build.buildPlan;
  if (!tasks || tasks.length === 0) {
    return { nodes: [], edges: [] };
  }

  const execPhases = buildDependencyGraph(fileStructure, tasks);
  const nodes: ProcessNode[] = [];
  const edges: ProcessEdge[] = [];

  let prevNodeIds: string[] = [];

  for (let phaseIdx = 0; phaseIdx < execPhases.length; phaseIdx++) {
    const execPhase = execPhases[phaseIdx]!;
    const x = TASK_X_START + phaseIdx * TASK_X_SPACING;

    if (execPhase.parallel && execPhase.tasks.length > 1) {
      // Fork/join for parallel tasks
      const forkId = `fork-${phaseIdx}`;
      const joinId = `join-${phaseIdx}`;

      nodes.push({
        id: forkId,
        type: "processForkJoin",
        position: { x: x - 40, y: TASK_Y_START },
        data: { label: "fork", status: "pending", color: "#6b7280", icon: "split", phase: "build" as BuildPhase },
      });

      // Edges from previous nodes to fork
      for (const prevId of prevNodeIds) {
        edges.push({
          id: `edge-${prevId}-${forkId}`,
          source: prevId,
          target: forkId,
        });
      }

      const taskNodeIds: string[] = [];

      for (let taskIdx = 0; taskIdx < execPhase.tasks.length; taskIdx++) {
        const assignedTask = execPhase.tasks[taskIdx]!;
        const nodeId = `task-${execPhase.phaseIndex}-${taskIdx}`;
        const status = getTaskNodeStatus(assignedTask.title, build, snapshot);
        const actor = snapshot.taskActors.get(assignedTask.title) ?? {
          kind: "ai_coworker" as ProcessActorKind,
          label: formatSpecialistLabel(assignedTask.specialist),
        };

        nodes.push({
          id: nodeId,
          type: "processTask",
          position: {
            x,
            y: TASK_Y_START + taskIdx * TASK_Y_SPACING,
          },
          data: {
            label: assignedTask.title,
            status,
            specialist: assignedTask.specialist,
            roleColor: ROLE_COLOURS[assignedTask.specialist],
            roleIcon: ROLE_ICONS[assignedTask.specialist],
            actorKind: actor.kind,
            actorLabel: actor.label,
            taskIndex: assignedTask.taskIndex,
          },
        });

        // Edge from fork to task
        edges.push({
          id: `edge-${forkId}-${nodeId}`,
          source: forkId,
          target: nodeId,
          animated: status === "running",
        });

        taskNodeIds.push(nodeId);
      }

      // Join node
      const joinY =
        TASK_Y_START +
        ((execPhase.tasks.length - 1) * TASK_Y_SPACING) / 2;

      nodes.push({
        id: joinId,
        type: "processForkJoin",
        position: { x: x + TASK_X_SPACING - 40, y: joinY },
        data: { label: "join", status: "pending", color: "#6b7280", icon: "merge", phase: "build" as BuildPhase },
      });

      // Edges from tasks to join
      for (const taskNodeId of taskNodeIds) {
        edges.push({
          id: `edge-${taskNodeId}-${joinId}`,
          source: taskNodeId,
          target: joinId,
        });
      }

      prevNodeIds = [joinId];
    } else {
      // Sequential: single task in this phase
      const taskNodeIds: string[] = [];

      for (let taskIdx = 0; taskIdx < execPhase.tasks.length; taskIdx++) {
        const assignedTask = execPhase.tasks[taskIdx]!;
        const nodeId = `task-${execPhase.phaseIndex}-${taskIdx}`;
        const status = getTaskNodeStatus(assignedTask.title, build, snapshot);
        const actor = snapshot.taskActors.get(assignedTask.title) ?? {
          kind: "ai_coworker" as ProcessActorKind,
          label: formatSpecialistLabel(assignedTask.specialist),
        };

        nodes.push({
          id: nodeId,
          type: "processTask",
          position: {
            x,
            y: TASK_Y_START + taskIdx * TASK_Y_SPACING,
          },
          data: {
            label: assignedTask.title,
            status,
            specialist: assignedTask.specialist,
            roleColor: ROLE_COLOURS[assignedTask.specialist],
            roleIcon: ROLE_ICONS[assignedTask.specialist],
            actorKind: actor.kind,
            actorLabel: actor.label,
            taskIndex: assignedTask.taskIndex,
          },
        });

        // Edges from previous nodes to this task
        for (const prevId of prevNodeIds) {
          edges.push({
            id: `edge-${prevId}-${nodeId}`,
            source: prevId,
            target: nodeId,
            animated: status === "running",
          });
        }

        taskNodeIds.push(nodeId);
      }

      prevNodeIds = taskNodeIds;
    }
  }

  return { nodes, edges };
}
