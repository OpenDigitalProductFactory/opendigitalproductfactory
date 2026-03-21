"use client";

import { SETUP_STEPS, type SetupStep, type StepStatus } from "@/lib/actions/setup-progress";

const STEP_LABELS: Record<SetupStep, string> = {
  "business-identity": "Business",
  "owner-account": "Account",
  "ai-capabilities": "AI Setup",
  "branding": "Branding",
  "financial-basics": "Financials",
  "first-workspace": "Workspace",
  "extensibility-preview": "Extend",
  "whats-next": "Summary",
};

type Props = {
  currentStep: string;
  steps: Record<string, StepStatus>;
  onStepClick?: (step: SetupStep) => void;
};

export function SetupProgressBar({ currentStep, steps, onStepClick }: Props) {
  return (
    <nav className="flex items-center gap-1 px-6 py-3 border-b bg-white">
      {SETUP_STEPS.map((step, idx) => {
        const status = steps[step] ?? "pending";
        const isCurrent = step === currentStep;
        return (
          <button
            key={step}
            onClick={() => onStepClick?.(step)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors
              ${isCurrent ? "bg-blue-100 text-blue-800" : ""}
              ${status === "completed" ? "text-green-700" : ""}
              ${status === "skipped" ? "text-gray-400" : ""}
              ${status === "pending" && !isCurrent ? "text-gray-500" : ""}
            `}
          >
            <span className="w-5 h-5 flex items-center justify-center rounded-full text-xs border">
              {status === "completed" ? "\u2713" : status === "skipped" ? "\u2014" : idx + 1}
            </span>
            {STEP_LABELS[step]}
          </button>
        );
      })}
    </nav>
  );
}
