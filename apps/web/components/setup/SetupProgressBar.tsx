"use client";

import { SETUP_STEPS, STEP_LABELS, type SetupStep, type StepStatus } from "@/lib/actions/setup-constants";

type Props = {
  currentStep: string;
  steps: Record<string, StepStatus>;
  onStepClick?: (step: SetupStep) => void;
};

export function SetupProgressBar({ currentStep, steps, onStepClick }: Props) {
  return (
    <nav className="flex items-center gap-1 px-6 py-3 border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      {SETUP_STEPS.map((step, idx) => {
        const status = steps[step] ?? "pending";
        const isCurrent = step === currentStep;
        return (
          <button
            key={step}
            onClick={() => onStepClick?.(step)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors
              ${isCurrent ? "bg-[var(--dpf-accent)]/10 text-[var(--dpf-accent)]" : ""}
              ${status === "completed" ? "text-[#4ade80]" : ""}
              ${status === "skipped" ? "text-[var(--dpf-muted)]" : ""}
              ${status === "pending" && !isCurrent ? "text-[var(--dpf-muted)]" : ""}
            `}
          >
            <span className="w-5 h-5 flex items-center justify-center rounded-full text-xs border border-[var(--dpf-border)]">
              {status === "completed" ? "\u2713" : status === "skipped" ? "\u2014" : idx + 1}
            </span>
            {STEP_LABELS[step]}
          </button>
        );
      })}
    </nav>
  );
}
