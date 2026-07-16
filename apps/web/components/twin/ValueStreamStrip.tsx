// apps/web/components/twin/ValueStreamStrip.tsx
//
// Workstream C — the value-stream flow lane. Renders the archetype's stage
// backbone (Attract → Capture → … → Retain) with live/demo demand counts and the
// longest wait overlaid, so the twin's animation view and the architecture view
// are one picture. Load-bearing stages — where this archetype's value is actually
// captured — are accented. Presentational; driven by TwinSnapshot.stageFlow.

import type { TwinStageFlow } from "./snapshot";

export interface ValueStreamStripProps {
  stages: TwinStageFlow[];
  className?: string;
}

export function ValueStreamStrip({ stages, className = "" }: ValueStreamStripProps) {
  if (stages.length === 0) return null;

  return (
    <div
      className={`flex items-stretch gap-1 overflow-x-auto rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-2 ${className}`.trim()}
      aria-label="Value stream"
    >
      {stages.map((stage, i) => (
        <div key={stage.stageKey} className="flex items-stretch gap-1">
          <div
            className={`flex min-w-[92px] flex-col justify-between rounded-md px-2.5 py-1.5 ${
              stage.loadBearing
                ? "bg-[var(--dpf-accent-soft,var(--dpf-surface-2))] ring-1 ring-[var(--dpf-accent)]"
                : "bg-[var(--dpf-surface-2)]"
            }`}
            title={stage.loadBearing ? `${stage.label} — load-bearing stage` : stage.label}
          >
            <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-muted)] leading-tight">
              {stage.label}
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-1">
              <span
                className={`text-sm font-semibold ${
                  stage.count > 0 ? "text-[var(--dpf-text)]" : "text-[var(--dpf-muted)]"
                }`}
              >
                {stage.count}
              </span>
              {stage.longestWait ? (
                <span className="text-[10px] text-[var(--dpf-warning)]">{stage.longestWait}</span>
              ) : null}
            </div>
          </div>
          {i < stages.length - 1 ? (
            <span className="self-center text-[var(--dpf-muted)]" aria-hidden>
              ›
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
