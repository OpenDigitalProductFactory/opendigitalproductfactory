"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./process-graph.css";

import type { BuildPhase, FeatureBuildRow } from "@/lib/feature-build-types";
import type { AssignedTask } from "@/lib/build/task-dependency-graph";
import type { BuildProgressVisibility } from "@/lib/build/progress-visibility";
import { buildDependencyGraph } from "@/lib/build/task-dependency-graph";
import { lookupAssignedTaskByTitle, type ProcessGraphNodeClickInfo } from "./ProcessGraphClickInfo";
export type { ProcessGraphNodeKind, ProcessGraphNodeClickInfo } from "./ProcessGraphClickInfo";
import {
  buildPhaseGraph,
  buildTaskGraph,
  getPhaseNodeStatus,
  graphSignature,
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

// ─── Node / Edge type registrations ────────────────────────────────────────

const NODE_TYPES = {
  processPhase: PhaseNode,
  processTask: TaskNode,
  processForkJoin: ForkJoinNode,
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
  governedBacklogEnabled: boolean;
  progressVisibility?: BuildProgressVisibility | null;
  /**
   * Optional click delegate. When provided, ProcessGraph SKIPS its internal
   * TaskInspector / WorkflowStageInspector and surfaces click context to the
   * parent instead. Used by the new BuildStudio shell to open the anchored
   * WorkflowNodeInspector inside the workflow region (see spec §2 + §6).
   *
   * When NOT provided, the legacy internal-inspector behavior is preserved
   * so existing callers (and `/build?v=1`) continue to work unchanged.
   */
  onNodeClick?: (info: ProcessGraphNodeClickInfo) => void;
};

type AnimatedProcessEdge = ProcessEdge & { type: "animatedFlow" };

// ─── Component ─────────────────────────────────────────────────────────────

export function ProcessGraph({ build, workflowLabel, governedBacklogEnabled, progressVisibility, onNodeClick }: Props) {
  const reactFlowRef = useRef<ReactFlowInstance<Node, AnimatedProcessEdge> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
  const phaseGraph = useMemo(() => buildPhaseGraph(build), [build]);

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
    const tagEdge = (e: ProcessEdge): AnimatedProcessEdge => ({
      ...e,
      type: "animatedFlow" as const,
    });

    const allEdges: AnimatedProcessEdge[] = [
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

  // Re-seed xyflow state only when the graph's *content* changes — not on
  // every new array identity. Mirroring derived nodes/edges into
  // useNodesState on identity churn races xyflow's internal measurement
  // (onNodesChange) updates and can drive a React max-update-depth (#185)
  // render loop that wedges Build Studio intake (BI-87CEAFEE). Upstream
  // re-renders (rapid `build`-prop updates during new-build intake / SSE
  // refetch) produce content-equal graphs with fresh identities; the
  // signature guard makes those no-ops while genuine status/position/edge
  // changes still re-seed.
  const graphSig = useMemo(
    () => graphSignature(mergedNodes, mergedEdges),
    [mergedNodes, mergedEdges],
  );
  const lastGraphSig = useRef<string | null>(null);
  useEffect(() => {
    if (graphSig === lastGraphSig.current) return;
    lastGraphSig.current = graphSig;
    setNodes(mergedNodes as Node[]);
    setEdges(mergedEdges);
  }, [graphSig, mergedNodes, mergedEdges, setNodes, setEdges]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      reactFlowRef.current?.fitView({ padding: 0.18, duration: 240 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [build.buildId, build.taskResults, mergedNodes.length, mergedEdges.length]);

  // ─── Task Inspector ──────────────────────────────────────────────────
  const [inspectedTask, setInspectedTask] = useState<AssignedTask | null>(
    null,
  );
  const [inspectedPhase, setInspectedPhase] = useState<BuildPhase | null>(null);

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      // ── Delegate path ────────────────────────────────────────────────
      // When the parent provided onNodeClick, gather the geometry the new
      // anchored inspector needs and hand off. Do NOT touch the internal
      // inspector state — the parent owns the inspector lifecycle.
      if (onNodeClick) {
        const containerEl = containerRef.current;
        if (!containerEl) return;
        const nodeEl = event.currentTarget as HTMLElement;
        const anchorRect = nodeEl.getBoundingClientRect();
        const containerRect = containerEl.getBoundingClientRect();
        const containerScrollTop = containerEl.scrollTop;

        if (node.type === "processPhase" || node.type === "processForkJoin") {
          const data = node.data as PhaseNodeData;
          onNodeClick({
            nodeId: String(node.id),
            kind: node.type === "processPhase" ? "phase" : "forkJoin",
            phase: data.phase,
            anchorRect,
            containerRect,
            containerScrollTop,
          });
          return;
        }
        if (node.type === "processTask") {
          const data = node.data as TaskNodeData;
          const task = lookupAssignedTaskByTitle(build, data.label) ?? undefined;
          onNodeClick({
            nodeId: String(node.id),
            kind: "task",
            task,
            anchorRect,
            containerRect,
            containerScrollTop,
          });
          return;
        }
        return;
      }

      // ── Legacy internal-inspector path ───────────────────────────────
      if (node.type === "processPhase" || node.type === "processForkJoin") {
        const nodeData = node.data as PhaseNodeData;
        setInspectedTask(null);
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
            setInspectedTask(assignedTask);
            return;
          }
        }
      }
    },
    [build, onNodeClick],
  );

  const handleInspectorClose = useCallback(() => {
    setInspectedTask(null);
    setInspectedPhase(null);
  }, []);

  // Compute inspector props
  const inspectorStatus = inspectedTask
    ? getTaskNodeStatus(inspectedTask.title, build, snapshot)
    : "pending";
  const inspectorResult = inspectedTask
    ? snapshot.storedTaskResults.get(inspectedTask.title)
    : undefined;

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onInit={(instance) => {
          reactFlowRef.current = instance;
          window.setTimeout(() => instance.fitView({ padding: 0.18, duration: 240 }), 0);
        }}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        panOnDrag
        zoomOnScroll
        colorMode="system"
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
          nodeColor="var(--dpf-accent)"
        />
      </ReactFlow>

      {inspectedTask != null && (
        <TaskInspector
          task={inspectedTask}
          status={inspectorStatus}
          result={inspectorResult}
          onClose={handleInspectorClose}
        />
      )}

      {inspectedPhase != null && (
        <WorkflowStageInspector
          build={build}
          phase={inspectedPhase}
          status={getPhaseNodeStatus(inspectedPhase, build)}
          workflowLabel={workflowLabel}
          governedBacklogEnabled={governedBacklogEnabled}
          progressVisibility={progressVisibility}
          onClose={handleInspectorClose}
        />
      )}
    </div>
  );
}
