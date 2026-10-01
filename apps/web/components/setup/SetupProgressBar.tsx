"use client";

import { SETUP_STEPS, type SetupStep, type StepStatus } from "@/lib/actions/setup-constants";
import { useT } from "@/lib/i18n/use-t";

type Props = {
  currentStep: string;
  steps: Record<string, StepStatus>;
  onStepClick?: (step: SetupStep) => void;
};

export function SetupProgressBar({ currentStep, steps, onStepClick }: Props) {
  const t = useT("setup");
  return (
    <nav aria-label={t("progress.label")} className="flex max-w-full items-center gap-1 overflow-x-auto border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-3 sm:px-6">
      {SETUP_STEPS.map((step, idx) => {
        const status = steps[step] ?? "pending";
        const isCurrent = step === currentStep;
        const statusLabel = t(`progress.status.${status}`);
        const accessibleState = isCurrent ? `${t("progress.current")}, ${statusLabel}` : statusLabel;
        const label = t(`steps.${step}`);
        return (
          <button
            key={step}
            type="button"
            onClick={() => onStepClick?.(step)}
            aria-label={t("progress.stepAria", { index: idx + 1, total: SETUP_STEPS.length, label, state: accessibleState })}
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
            {label}
          </button>
        );
      })}
    </nav>
  );
}
