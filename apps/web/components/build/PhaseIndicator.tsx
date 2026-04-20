// apps/web/components/build/PhaseIndicator.tsx
"use client";

import { VISIBLE_PHASES, PHASE_LABELS, PHASE_COLOURS, type BuildPhase } from "@/lib/feature-build-types";
import type { BuildFlowState, MainTrackNode } from "@/lib/build-flow-state";
import { UpstreamForkNode, PromoteForkNode } from "./ForkNode";

type Props = {
  /** Legacy path — renders the old binary-checkbox indicator. */
  currentPhase?: BuildPhase;
  /** New path — renders per-phase substep arcs + fork row. */
  flowState?: BuildFlowState | null;
};

export function PhaseIndicator({ currentPhase, flowState }: Props) {
  // Prefer the rich flow state when supplied. Fall back to the legacy
  // currentPhase-only rendering for callers that haven't been updated yet.
  if (flowState) {
    return <PhaseIndicatorWithFlow flowState={flowState} />;
  }

  const phase = currentPhase ?? "ideate";
  const currentIndex = VISIBLE_PHASES.indexOf(phase);
  return (
    <nav aria-label="Build phase progress" data-testid="phase-indicator" data-current-phase={phase} className="flex items-center gap-0.5 px-4 py-2.5 bg-[var(--dpf-surface-2)] border-t border-[var(--dpf-border)]">
      {VISIBLE_PHASES.map((p, i) => {
        const isActive = p === phase;
        const isDone = currentIndex > i;
        const colour = isDone || isActive ? PHASE_COLOURS[p] : "var(--dpf-muted)";
        return (
          <div key={p} className="flex items-center flex-1">
            <PhaseCircle label={PHASE_LABELS[p]} colour={colour} isActive={isActive} isDone={isDone} index={i} total={undefined} completed={undefined} />
            {i < VISIBLE_PHASES.length - 1 && (
              <div className="h-0.5 flex-1 min-w-4" style={{ background: isDone ? colour : "var(--dpf-border)" }} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ─── Flow-state rendering ───────────────────────────────────────────────────

function PhaseIndicatorWithFlow({ flowState }: { flowState: BuildFlowState }) {
  const { mainTrack, upstream, promote, currentPhase } = flowState;
  // The Ready-to-Ship node gets forks dropped below it. When currentPhase is
  // past ship (complete), we still render the forks so the user can see the
  // terminal disposition of each one.
  const showForks = upstream.state !== "pending" || promote.state !== "pending";

  return (
    <nav aria-label="Build phase progress" data-testid="phase-indicator" data-current-phase={currentPhase} className="px-4 py-2.5 bg-[var(--dpf-surface-2)] border-t border-[var(--dpf-border)]">
      <div className="flex items-center gap-0.5">
        {mainTrack.map((node, i) => {
          const colour = colourForNode(node);
          return (
            <div key={node.phase} className="flex items-center flex-1">
              <PhaseCircle
                label={node.label}
                colour={colour}
                isActive={node.state === "active"}
                isDone={node.state === "done"}
                index={i}
                completed={node.stepsCompleted}
                total={node.stepsTotal}
              />
              {i < mainTrack.length - 1 && (
                <div className="h-0.5 flex-1 min-w-4" style={{ background: node.state === "done" ? colour : "var(--dpf-border)" }} />
              )}
            </div>
          );
        })}
      </div>
      {showForks && (
        <div className="mt-3 flex items-center gap-3 justify-end pr-4" data-testid="phase-forks">
          <UpstreamForkNode fork={upstream} />
          <PromoteForkNode fork={promote} />
        </div>
      )}
    </nav>
  );
}

function colourForNode(node: MainTrackNode): string {
  if (node.state === "pending") return "var(--dpf-muted)";
  if (node.state === "failed") return "#ef4444";
  return PHASE_COLOURS[node.phase];
}

// ─── Phase circle with optional progress arc ────────────────────────────────

interface CircleProps {
  label: string;
  colour: string;
  isActive: boolean;
  isDone: boolean;
  index: number;
  /** When completed/total are both provided, the ring renders an arc. */
  completed?: number;
  total?: number;
}

function PhaseCircle({ label, colour, isActive, isDone, index, completed, total }: CircleProps) {
  const hasArc = typeof completed === "number" && typeof total === "number" && total > 0;
  const progress = hasArc ? Math.min(1, completed! / total!) : 0;

  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <div className="relative" style={{ width: 40, height: 40 }}>
        {/* Ring / arc background */}
        {hasArc ? (
          <ProgressRing colour={colour} progress={progress} filled={isDone} />
        ) : (
          <div
            className="w-9 h-9 lg:w-10 lg:h-10 min-w-[36px] min-h-[36px] rounded-full grid place-items-center text-xs font-bold transition-all duration-200"
            style={{
              border: `2px solid ${colour}`,
              background: isDone || isActive ? colour : "transparent",
              color: isDone || isActive ? "var(--dpf-bg)" : colour,
              boxShadow: isActive ? `0 0 0 3px color-mix(in srgb, ${colour} 25%, transparent)` : "none",
            }}
          />
        )}
        {/* Center label (done check, step number, or count) */}
        <div
          className="absolute inset-0 grid place-items-center text-xs font-bold pointer-events-none"
          style={{ color: isDone || isActive ? (hasArc ? colour : "var(--dpf-bg)") : colour }}
        >
          {isDone ? "\u2713" : hasArc && total! > 0 ? `${completed}/${total}` : index + 1}
        </div>
      </div>
      <span className="text-[11px] lg:text-xs" style={{ fontWeight: isActive ? 700 : 400, color: isActive ? colour : "var(--dpf-muted)" }}>
        {label}
      </span>
    </div>
  );
}

function ProgressRing({ colour, progress, filled }: { colour: string; progress: number; filled: boolean }) {
  const size = 40;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill={filled ? colour : "transparent"}
        stroke={colour}
        strokeWidth={stroke}
        opacity={filled ? 1 : 0.25}
      />
      {/* Progress arc — overlay */}
      {!filled && progress > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke={colour}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
