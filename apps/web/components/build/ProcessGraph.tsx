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
};

// ─── Component ─────────────────────────────────────────────────────────────

export function ProcessGraph({ build, workflowLabel }: Props) {
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

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
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
    [build.buildPlan],
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
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
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
        <Background color="#2a2a40" gap={20} />
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
          nodeColor="#3a3a5a"
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
          onClose={handleInspectorClose}
        />
      )}
    </div>
  );
}
