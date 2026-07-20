"use client";

import { SETUP_STEPS, STEP_LABELS, type SetupStep, type StepStatus } from "@/lib/actions/setup-constants";

type Props = {
  currentStep: string;
  steps: Record<string, StepStatus>;
  onStepClick?: (step: SetupStep) => void;
};

export function SetupProgressBar({ currentStep, steps, onStepClick }: Props) {
  return (
    <nav aria-label="Setup progress" className="flex max-w-full items-center gap-1 overflow-x-auto border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-3 sm:px-6">
      {SETUP_STEPS.map((step, idx) => {
        const status = steps[step] ?? "pending";
        const isCurrent = step === currentStep;
        const accessibleState = `${isCurrent ? "current, " : ""}${status}`;
        return (
          <button
            key={step}
            type="button"
            onClick={() => onStepClick?.(step)}
            aria-label={`Step ${idx + 1} of ${SETUP_STEPS.length}: ${STEP_LABELS[step]}, ${accessibleState}`}
            aria-current={isCurrent ? "step" : undefined}
            className={`
              flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]
              ${isCurrent ? "bg-[var(--dpf-accent)]/10 text-[var(--dpf-accent)]" : ""}
              ${status === "completed" ? "text-[var(--dpf-success)]" : ""}
              ${status === "skipped" ? "text-[var(--dpf-muted)]" : ""}
              ${status === "pending" && !isCurrent ? "text-[var(--dpf-muted)]" : ""}
            `}
          >
            <span aria-hidden="true" className="w-5 h-5 flex items-center justify-center rounded-full text-xs border border-[var(--dpf-border)]">
              {status === "completed" ? "\u2713" : status === "skipped" ? "\u2014" : idx + 1}
            </span>
            {STEP_LABELS[step]}
          </button>
        );
      })}
    </nav>
  );
}
