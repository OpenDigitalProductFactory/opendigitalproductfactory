// apps/web/components/twin/ValueStreamStrip.tsx
//
// Workstream C — the value-stream flow lane. Renders the archetype's stage
// backbone (Attract → Capture → … → Retain) with live/demo demand counts and the
// longest wait overlaid, so the twin's animation view and the architecture view
// are one picture. Load-bearing stages — where this archetype's value is actually
// captured — are accented. Presentational; driven by TwinSnapshot.stageFlow.
//
// Two things this strip used to claim and could not deliver (BI-AF50DBD5):
//
//   1. A chevron after every stage. It was a decorative separator, but it reads
//      as "open this", and there is nothing behind it — the tiles are not
//      controls and never were. It is gone; the flow now reads from the layout.
//   2. A count of 0 on a stage nothing binds to. Of pet-rescue's sixteen stages
//      exactly one has a queue or a zone bound to it, so fifteen printed a zero
//      no query had ever been in a position to produce. An unobservable stage
//      now shows a dash: the stage is named, and the absence of a measurement is
//      shown as an absence.
//
// Naming the operator's day correctly while promising sixteen destinations reads
// as further along than saying nothing. That is the illusion this removes.

import type { TwinStageFlow } from "./snapshot";

export interface ValueStreamStripProps {
  stages: TwinStageFlow[];
  className?: string;
}

export function ValueStreamStrip({ stages, className = "" }: ValueStreamStripProps) {
  if (stages.length === 0) return null;
  const anyUntracked = stages.some((stage) => !stage.observable);

  return (
    <div className={className}>
      <div
        className="flex items-stretch gap-px overflow-x-auto rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-2"
        aria-label="Value stream"
      >
        {stages.map((stage) => (
          <div
            key={stage.stageKey}
            className={`flex min-w-[92px] flex-col justify-between rounded-md px-2.5 py-1.5 ${
              stage.loadBearing
                ? "bg-[var(--dpf-accent-soft,var(--dpf-surface-2))] ring-1 ring-[var(--dpf-accent)]"
                : "bg-[var(--dpf-surface-2)]"
            } ${stage.observable ? "" : "opacity-60"}`.trim()}
            title={stage.loadBearing ? `${stage.label} — load-bearing stage` : stage.label}
            data-stage-observable={stage.observable ? "true" : "false"}
          >
            <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-muted)] leading-tight">
              {stage.label}
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-1">
              {stage.observable ? (
                <span
                  className={`text-sm font-semibold ${
                    stage.count > 0 ? "text-[var(--dpf-text)]" : "text-[var(--dpf-muted)]"
                  }`}
                >
                  {stage.count}
                </span>
              ) : (
                <span className="text-sm font-semibold text-[var(--dpf-muted)]">
                  <span aria-hidden>—</span>
                  <span className="sr-only">Not tracked yet</span>
                </span>
              )}
              {stage.longestWait ? (
                <span className="text-[10px] text-[var(--dpf-warning)]">{stage.longestWait}</span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {anyUntracked ? (
        <p className="mt-1 text-dpf-caption text-[var(--dpf-muted)]">
          A dash means nothing records that stage yet.
        </p>
      ) : null}
    </div>
  );
}
