"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./process-graph.css";

import type { BuildPhase, FeatureBuildRow } from "@/lib/feature-build-types";
import type { AssignedTask } from "@/lib/integrate/task-dependency-graph";
import { buildDependencyGraph } from "@/lib/integrate/task-dependency-graph";
import {
  buildPhaseGraph,
  buildTaskGraph,
  getPhaseNodeStatus,
  normalizeBuildSnapshot,
  getTaskNodeStatus,
  type ProcessNode,
  type ProcessEdge,
  type TaskNodeData,
  type PhaseNodeData,
} from "@/lib/build/process-graph-builder";

import { PhaseNode } from "./PhaseNode";
import { TaskNode } from "./TaskNode";
import { ForkJoinNode } from "./ForkJoinNode";
import { AnimatedEdge } from "./AnimatedEdge";
import { TaskInspector } from "./TaskInspector";
import { WorkflowStageInspector } from "./WorkflowStageInspector";
import { ReleaseForkNode } from "./ReleaseForkNode";
import { ReleaseDecisionInspector } from "./ReleaseDecisionInspector";
import type { BuildFlowState } from "@/lib/build-flow-state";
import type { ReleaseForkNodeData } from "@/lib/build/process-graph-builder";

// ─── Node / Edge type registrations ────────────────────────────────────────

const NODE_TYPES = {
  processPhase: PhaseNode,
  processTask: TaskNode,
  processForkJoin: ForkJoinNode,
  processReleaseFork: ReleaseForkNode,
} as const;

const EDGE_TYPES = {
  animatedFlow: AnimatedEdge,
} as const;

// ─── Task graph vertical offset below phase graph ──────────────────────────

const TASK_GRAPH_Y_OFFSET = 130;

// ─── Props ─────────────────────────────────────────────────────────────────

type Props = {
  build: FeatureBuildRow;
  workflowLabel: string | null;
  flowState: BuildFlowState | null;
};

// ─── Component ─────────────────────────────────────────────────────────────

export function ProcessGraph({ build, workflowLabel, flowState }: Props) {
  // ─── Live running-task state via DOM CustomEvents ──────────────────────
  const [activeTaskTitles, setActiveTaskTitles] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const data = (
        e as CustomEvent<{ type: string; taskTitle?: string }>
      ).detail;
      if (
        data?.type === "orchestrator:task_dispatched" &&
        data.taskTitle
      ) {
        setActiveTaskTitles((prev) => new Set(prev).add(data.taskTitle!));
      }
      if (
        data?.type === "orchestrator:task_complete" &&
        data.taskTitle
      ) {
        setActiveTaskTitles((prev) => {
          const next = new Set(prev);
          next.delete(data.taskTitle!);
          return next;
        });
      }
      if (data?.type === "done") {
        setActiveTaskTitles(new Set());
      }
    };
    window.addEventListener("build-progress-update", handleUpdate);
    return () =>
      window.removeEventListener("build-progress-update", handleUpdate);
  }, []);

  // ─── Normalize build snapshot ─────────────────────────────────────────
  const snapshot = useMemo(
    () => normalizeBuildSnapshot(build, activeTaskTitles),
    [build, activeTaskTitles],
  );

  // ─── Build phase graph (level 1) ─────────────────────────────────────
  const phaseGraph = useMemo(() => buildPhaseGraph(build, flowState), [build, flowState]);

  // ─── Build task graph (level 2) ───────────────────────────────────────
  const taskGraph = useMemo(
    () => buildTaskGraph(build, snapshot),
    [build, snapshot],
  );

  // ─── Merge graphs: offset task graph below phase graph ────────────────
  const { mergedNodes, mergedEdges } = useMemo(() => {
    const offsetTaskNodes: ProcessNode[] = taskGraph.nodes.map((n) => ({
      ...n,
      position: {
        x: n.position.x,
        y: n.position.y + TASK_GRAPH_Y_OFFSET,
      },
    }));

    const allNodes: ProcessNode[] = [
      ...phaseGraph.nodes,
      ...offsetTaskNodes,
    ];

    // Tag all edges with the animatedFlow type
    const tagEdge = (e: ProcessEdge) => ({
      ...e,
      type: "animatedFlow" as const,
    });

    const allEdges = [
      ...phaseGraph.edges.map(tagEdge),
      ...taskGraph.edges.map(tagEdge),
    ];

    return { mergedNodes: allNodes, mergedEdges: allEdges };
  }, [phaseGraph, taskGraph]);

  // ─── ReactFlow state ─────────────────────────────────────────────────
  const [nodes, setNodes, onNodesChange] = useNodesState(
    mergedNodes as Node[],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(mergedEdges);

  // Re-seed when the computed graph changes
  useEffect(() => {
    setNodes(mergedNodes as Node[]);
  }, [mergedNodes, setNodes]);

  useEffect(() => {
    setEdges(mergedEdges);
  }, [mergedEdges, setEdges]);

  // ─── Task Inspector ──────────────────────────────────────────────────
  const [inspectedTask, setInspectedTask] = useState<AssignedTask | null>(
    null,
  );
  const [inspectedPhase, setInspectedPhase] = useState<BuildPhase | null>(null);
  const [inspectedReleaseFork, setInspectedReleaseFork] = useState<"upstream" | "promote" | null>(null);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === "processReleaseFork") {
        const nodeData = node.data as ReleaseForkNodeData;
        setInspectedTask(null);
        setInspectedPhase(null);
        setInspectedReleaseFork(nodeData.forkKind);
        return;
      }

      if (node.type === "processPhase" || node.type === "processForkJoin") {
        const nodeData = node.data as PhaseNodeData;
        setInspectedTask(null);
        setInspectedReleaseFork(null);
        setInspectedPhase(nodeData.phase);
        return;
      }

      if (node.type !== "processTask") return;

      // Find the matching AssignedTask from the build plan
      if (build.buildPlan == null) return;
      const { fileStructure, tasks } = build.buildPlan;
      if (!tasks || tasks.length === 0) return;

      const execPhases = buildDependencyGraph(fileStructure, tasks);
      const nodeData = node.data as TaskNodeData;

      // Search through execution phases for matching task
      for (const phase of execPhases) {
        for (const assignedTask of phase.tasks) {
          if (assignedTask.title === nodeData.label) {
            setInspectedPhase(null);
            setInspectedReleaseFork(null);
            setInspectedTask(assignedTask);
            return;
          }
        }
      }
    },
    [build.buildPlan],
  );

  const handleInspectorClose = useCallback(() => {
    setInspectedTask(null);
    setInspectedPhase(null);
    setInspectedReleaseFork(null);
  }, []);

  // Compute inspector props
  const inspectorStatus = inspectedTask
    ? getTaskNodeStatus(inspectedTask.title, build, snapshot)
    : "pending";
  const inspectorResult = inspectedTask
    ? snapshot.storedTaskResults.get(inspectedTask.title)
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex min-h-[360px] flex-1 overflow-hidden rounded-[22px] border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          panOnDrag
          zoomOnScroll
          colorMode="dark"
          minZoom={0.1}
          maxZoom={3}
        >
          <Background color="var(--dpf-border)" gap={20} />
          <Controls
            style={{
              background: "var(--dpf-surface-1)",
              border: "1px solid var(--dpf-border)",
            }}
          />
          <MiniMap
            style={{
              background: "var(--dpf-surface-1)",
              border: "1px solid var(--dpf-border)",
            }}
            maskColor="color-mix(in srgb, var(--dpf-bg) 70%, transparent)"
            nodeColor="var(--dpf-surface-1)"
          />
        </ReactFlow>
      </div>

      {inspectedTask != null ? (
        <TaskInspector
          task={inspectedTask}
          status={inspectorStatus}
          result={inspectorResult}
          onClose={handleInspectorClose}
        />
      ) : inspectedPhase != null ? (
        <WorkflowStageInspector
          build={build}
          phase={inspectedPhase}
          status={getPhaseNodeStatus(inspectedPhase, build)}
          workflowLabel={workflowLabel}
          onClose={handleInspectorClose}
        />
      ) : inspectedReleaseFork != null && flowState != null ? (
        <ReleaseDecisionInspector
          build={build}
          flowState={flowState}
          forkKind={inspectedReleaseFork}
          onClose={handleInspectorClose}
        />
      ) : (
        <section className="rounded-[22px] border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--dpf-muted)]">
                Workflow Details
              </div>
              <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
                Select a stage, task, or release lane to inspect what happened.
              </p>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--dpf-muted)]">
                Details stay inside Build Studio so you can compare workflow state with the AI coworker, release status, and artifacts without losing the rest of the screen.
              </p>
            </div>

            {workflowLabel ? (
              <div className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--dpf-text)]">
                {workflowLabel}
              </div>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
