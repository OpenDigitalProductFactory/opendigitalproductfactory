// apps/web/components/build/AgentActivityStrip.tsx
//
// Ambient task-level progress strip shown during the Build phase.
// Renders every task as a 9×9px cell (done/running/queued/failed),
// grouped by dependency wave from buildDependencyGraph().
//
// Data sources:
//   - Initial done/failed state: build.taskResults
//   - Live running state: build-progress-update CustomEvent (orchestrator:task_dispatched / task_complete)
//
// Spec: docs/superpowers/specs/2026-06-13-agent-activity-strip-design.md
"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { buildDependencyGraph } from "@/lib/build/task-dependency-graph";
import type { FeatureBuildRow } from "@/lib/feature-build-types";

// ─── Types ──────────────────────────────────────────────────────────────────

type CellState = "done" | "running" | "queued" | "failed";

type TaskCell = {
  title: string;
  taskIndex: number;
  state: CellState;
};

type WaveGroup = {
  waveIndex: number;
  label: string;
  tasks: TaskCell[];
};

// ─── Constants ───────────────────────────────────────────────────────────────

const SPECIALIST_LABELS: Record<string, string> = {
  "data-architect": "Foundation",
  "software-engineer": "Core Logic",
  "frontend-engineer": "UI Components",
  "qa-engineer": "Testing",
};

const MIN_TASKS_TO_SHOW = 5;

// ─── Component ───────────────────────────────────────────────────────────────

type Props = {
  build: FeatureBuildRow;
};

export function AgentActivityStrip({ build }: Props) {
  // ── Live running-task state via CustomEvents ────────────────────────────
  const [activeTaskTitles, setActiveTaskTitles] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const data = (e as CustomEvent<{ type: string; buildId?: string; taskTitle?: string }>).detail;
      // Ignore events for other builds
      if (data?.buildId && data.buildId !== build.buildId) return;

      if (data?.type === "orchestrator:task_dispatched" && data.taskTitle) {
        setActiveTaskTitles((prev) => new Set(prev).add(data.taskTitle!));
      } else if (data?.type === "orchestrator:task_complete" && data.taskTitle) {
        setActiveTaskTitles((prev) => {
          const next = new Set(prev);
          next.delete(data.taskTitle!);
          return next;
        });
      } else if (data?.type === "done") {
        setActiveTaskTitles(new Set());
      }
    };

    window.addEventListener("build-progress-update", handleUpdate);
    return () => window.removeEventListener("build-progress-update", handleUpdate);
  }, [build.buildId]);

  // Reset active titles when build changes
  useEffect(() => {
    setActiveTaskTitles(new Set());
  }, [build.buildId]);

  // ── Elapsed timer ───────────────────────────────────────────────────────
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    setElapsed(0);
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [build.buildId]);

  // ── Wave groups from dependency graph ───────────────────────────────────
  const waves = useMemo((): WaveGroup[] => {
    if (!build.buildPlan?.tasks?.length) return [];

    const execPhases = buildDependencyGraph(
      build.buildPlan.fileStructure,
      build.buildPlan.tasks,
    );

    // Build lookup of completed task results: title → passed.
    // taskResults is typed TaskResult[] but the orchestrator persists a
    // non-array JSON shape (an empty `{}`, the per-task `{ tasks, ... }`
    // object, or the agentic single-shot `{ modelId, filesChanged, ... }`
    // summary). `{} ?? []` returns `{}`, so iterating the raw value throws.
    // Guard with Array.isArray — mirrors the FleetDensityBar fix (#1978).
    const resultByTitle = new Map<string, boolean>();
    (Array.isArray(build.taskResults) ? build.taskResults : []).forEach((r) => {
      resultByTitle.set(r.title, r.testResult?.passed ?? true);
    });

    return execPhases.map((phase) => {
      const dominantSpec = phase.tasks[0]?.specialist ?? "software-engineer";
      return {
        waveIndex: phase.phaseIndex,
        label: SPECIALIST_LABELS[dominantSpec] ?? dominantSpec,
        tasks: phase.tasks.map((t) => {
          let state: CellState;
          if (resultByTitle.has(t.title)) {
            state = resultByTitle.get(t.title) ? "done" : "failed";
          } else if (activeTaskTitles.has(t.title)) {
            state = "running";
          } else {
            state = "queued";
          }
          return { title: t.title, taskIndex: t.taskIndex, state };
        }),
      };
    });
  }, [build.buildPlan, build.taskResults, activeTaskTitles]);

  // ── Render gate ─────────────────────────────────────────────────────────
  const totalTasks = waves.reduce((s, w) => s + w.tasks.length, 0);
  if (build.phase !== "build" || totalTasks < MIN_TASKS_TO_SHOW) return null;

  const doneTasks = waves.reduce((s, w) => s + w.tasks.filter((t) => t.state === "done").length, 0);
  const runningTasks = waves.reduce((s, w) => s + w.tasks.filter((t) => t.state === "running").length, 0);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedLabel = mins > 0 ? `${mins}m ${String(secs).padStart(2, "0")}s` : `${secs}s`;

  return (
    <div
      className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
      data-testid="agent-activity-strip"
      aria-label={`Agent activity: ${doneTasks} of ${totalTasks} tasks complete, ${runningTasks} running`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-[var(--dpf-surface-2)] border-b border-[var(--dpf-border)]">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
          Agent Activity
        </span>
        <span className="text-xs font-medium text-[var(--dpf-text)] tabular-nums">
          {doneTasks} / {totalTasks} tasks
          {runningTasks > 0 && ` · ${runningTasks} running`}
          {elapsed > 0 && ` · ${elapsedLabel}`}
        </span>
        <span className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold bg-[var(--dpf-accent)] text-white">
          Build Phase
        </span>
      </div>

      {/* Wave grid */}
      <div className="flex items-start px-4 py-3">
        {waves.map((wave, wi) => (
          <div key={wave.waveIndex} className="flex items-start">
            <div className="flex flex-col gap-1.5">
              <WaveLabel wave={wave} />
              <div className="flex flex-wrap gap-0.5">
                {wave.tasks.map((task) => (
                  <Cell key={task.taskIndex} task={task} />
                ))}
              </div>
            </div>
            {wi < waves.length - 1 && (
              <div
                className="mx-2 self-stretch mt-5 w-px bg-[var(--dpf-border)]"
                aria-hidden="true"
              />
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 px-4 pb-2.5">
        <LegendItem state="done" label="Done" />
        <LegendItem state="running" label="Running" />
        <LegendItem state="queued" label="Queued" />
        <LegendItem state="failed" label="Failed" />
        <span className="ml-auto text-[10px] text-[var(--dpf-muted)]">
          Hover for task name
        </span>
      </div>
    </div>
  );
}

// ─── Wave label ──────────────────────────────────────────────────────────────

function WaveLabel({ wave }: { wave: WaveGroup }) {
  const done = wave.tasks.filter((t) => t.state === "done").length;
  const running = wave.tasks.filter((t) => t.state === "running").length;
  const total = wave.tasks.length;
  const meta =
    running > 0 ? `${done} done · ${running} running` : `${done}/${total}`;

  return (
    <div className="text-[10px] text-[var(--dpf-muted)] font-medium whitespace-nowrap">
      {wave.label}{" "}
      <span className="opacity-55">· {meta}</span>
    </div>
  );
}

// ─── Individual task cell ────────────────────────────────────────────────────

const CELL_BG: Record<CellState, string> = {
  done:    "var(--dpf-success)",
  running: "var(--dpf-accent)",
  failed:  "var(--dpf-error)",
  queued:  "transparent",
};

function Cell({ task }: { task: TaskCell }) {
  const isRunning = task.state === "running";
  const isQueued = task.state === "queued";

  return (
    <div
      role="img"
      aria-label={`${task.title}: ${task.state}`}
      title={task.title}
      className="w-[9px] h-[9px] rounded-[1.5px] cursor-default transition-transform hover:scale-150 hover:z-10 relative shrink-0"
      style={{
        background: CELL_BG[task.state],
        border: isQueued ? "1px solid var(--dpf-border)" : "none",
        animation: isRunning ? "dpf-cell-pulse 1.4s ease-in-out infinite" : "none",
      }}
    />
  );
}

// ─── Legend item ─────────────────────────────────────────────────────────────

function LegendItem({ state, label }: { state: CellState; label: string }) {
  const isQueued = state === "queued";
  return (
    <div className="flex items-center gap-1">
      <div
        className="w-2 h-2 rounded-[1.5px] shrink-0"
        style={{
          background: isQueued ? "transparent" : CELL_BG[state],
          border: isQueued ? "1px solid var(--dpf-muted)" : "none",
        }}
      />
      <span className="text-[10px] text-[var(--dpf-muted)]">{label}</span>
    </div>
  );
}
