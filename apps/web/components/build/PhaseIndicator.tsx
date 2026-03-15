// apps/web/components/build/PhaseIndicator.tsx
"use client";

import { VISIBLE_PHASES, PHASE_LABELS, PHASE_COLOURS, type BuildPhase } from "@/lib/feature-build-types";

type Props = {
  currentPhase: BuildPhase;
};

export function PhaseIndicator({ currentPhase }: Props) {
  const currentIndex = VISIBLE_PHASES.indexOf(currentPhase);

  return (
    <div className="flex items-center gap-0.5 px-4 py-2 bg-[var(--dpf-surface-2)] border-t border-[var(--dpf-border)]">
      {VISIBLE_PHASES.map((phase, i) => {
        const isActive = phase === currentPhase;
        const isDone = currentIndex > i;
        const colour = isDone || isActive ? PHASE_COLOURS[phase] : "var(--dpf-muted)";

        return (
          <div key={phase} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1 flex-1">
              <div
                className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold"
                style={{
                  border: `2px solid ${colour}`,
                  background: isDone || isActive ? colour : "transparent",
                  color: isDone || isActive ? "#0f0f1a" : colour,
                }}
              >
                {isDone ? "\u2713" : i + 1}
              </div>
              <span
                className="text-[11px]"
                style={{
                  fontWeight: isActive ? 700 : 400,
                  color: isActive ? colour : "var(--dpf-muted)",
                }}
              >
                {PHASE_LABELS[phase]}
              </span>
            </div>
            {i < VISIBLE_PHASES.length - 1 && (
              <div
                className="h-0.5 flex-1 min-w-4"
                style={{ background: isDone ? colour : "var(--dpf-border)" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
