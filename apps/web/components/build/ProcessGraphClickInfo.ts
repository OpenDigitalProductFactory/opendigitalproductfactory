// apps/web/components/build/ProcessGraphClickInfo.ts
//
// Pure helpers that resolve ProcessGraph node-click context for the new
// BuildStudio shell. Split out from ProcessGraph.tsx so the lookup logic
// can be unit-tested without rendering React Flow.
//
// Used by ProcessGraph when an onNodeClick callback is provided by the
// parent (the new layout's BuildStudio shell). When no callback is
// provided, ProcessGraph keeps its legacy internal-inspector behavior.

import type { BuildPhase, FeatureBuildRow } from "@/lib/feature-build-types";
import type { AssignedTask } from "@/lib/build/task-dependency-graph";
import { buildDependencyGraph } from "@/lib/build/task-dependency-graph";

/** Discriminator for what kind of graph node was clicked. */
export type ProcessGraphNodeKind = "phase" | "task" | "forkJoin";

/** Click context surfaced to parents that opt-in via onNodeClick. */
export type ProcessGraphNodeClickInfo = {
  /** Stable React Flow node id. */
  nodeId: string;
  /** What kind of node was clicked (drives the inspector payload shape). */
  kind: ProcessGraphNodeKind;
  /** Set when kind === "phase" or "forkJoin". */
  phase?: BuildPhase;
  /** Set when kind === "task" AND the title matches an entry in the build plan. */
  task?: AssignedTask;
  /** Viewport rect of the clicked node element. */
  anchorRect: DOMRect;
  /** Viewport rect of the graph container that wraps the inspector. */
  containerRect: DOMRect;
  /** Container scrollTop, needed by getInspectorPlacement to position correctly. */
  containerScrollTop: number;
};

/**
 * Resolve the AssignedTask matching a task-node label by walking the
 * build's dependency graph. Returns null if no match (build has no plan,
 * or no task title matches).
 *
 * Pulled out of ProcessGraph.handleNodeClick so it can be exercised
 * directly in unit tests — no React Flow required.
 */
export function lookupAssignedTaskByTitle(
  build: FeatureBuildRow,
  taskTitle: string,
): AssignedTask | null {
  if (build.buildPlan == null) return null;
  const { fileStructure, tasks } = build.buildPlan;
  if (!tasks || tasks.length === 0) return null;

  const execPhases = buildDependencyGraph(fileStructure, tasks);
  for (const phase of execPhases) {
    for (const assignedTask of phase.tasks) {
      if (assignedTask.title === taskTitle) return assignedTask;
    }
  }
  return null;
}
