"use client";
import { Check } from "lucide-react";
import type { Step, StepState } from "./types";

interface StepNodeProps {
  step: Step;
  idx: number;
  last: boolean;
}

function colorForState(state: StepState): string {
  switch (state) {
    case "done":
      return "var(--dpf-success)";
    case "active":
      return "var(--dpf-accent)";
    case "waiting":
      return "var(--dpf-warning)";
    case "failed":
      return "var(--dpf-error)";
    case "queued":
    default:
      return "var(--dpf-muted)";
  }
}

function fillForState(state: StepState): string {
  switch (state) {
    case "done":
      return "var(--dpf-success)";
    case "active":
      return "var(--dpf-accent)";
    case "waiting":
      return "color-mix(in srgb, var(--dpf-warning) 30%, var(--dpf-surface-1))";
    case "failed":
      return "color-mix(in srgb, var(--dpf-error) 25%, var(--dpf-surface-1))";
    case "queued":
    default:
      return "var(--dpf-surface-1)";
  }
}

function StepNode({ step, idx, last }: StepNodeProps) {
  const isDone = step.state === "done";
  const isActive = step.state === "active";
  const isInverted = isDone || isActive;
  const accent = colorForState(step.state);
  const fill = fillForState(step.state);

  const subline = [
    step.verb,
    step.progress != null && step.total != null ? `${step.progress} of ${step.total}` : null,
    !isActive ? step.when : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-center flex-1 min-w-0">
      <div className="flex flex-col items-start gap-1.5 flex-1 min-w-0">
        <div className="flex items-center gap-2.5">
          <div
            className="relative w-6 h-6 rounded-full grid place-items-center text-[12px] font-bold shrink-0"
            style={{
              background: fill,
              border: `1.5px solid ${accent}`,
              color: isInverted ? "var(--dpf-bg)" : accent,
            }}
          >
            {isDone ? <Check size={13} strokeWidth={2.4} /> : idx + 1}
            {isActive && (
              <span
                className="absolute rounded-full animate-pulse"
                style={{
                  inset: -4,
                  border: `2px solid ${accent}`,
                  opacity: 0.25,
                }}
              />
            )}
          </div>
          <div className="min-w-0">
            <div
              className="text-[13px] font-semibold tracking-tight"
              style={{
                color: isInverted ? "var(--dpf-text)" : "var(--dpf-text-secondary)",
              }}
            >
              {step.label}
            </div>
            <div className="text-[11.5px] text-[var(--dpf-muted)] mt-px">{subline}</div>
          </div>
        </div>
      </div>
      {!last && (
        <div
          className="mx-1.5"
          style={{
            flex: "0 1 28px",
            minWidth: 14,
            height: 1.5,
            background: isDone ? "var(--dpf-success)" : "var(--dpf-border)",
          }}
        />
      )}
    </div>
  );
}

export function StepTracker({ steps }: { steps: Step[] }) {
  return (
    <div className="flex items-center px-[22px] py-3.5 bg-[var(--dpf-surface-1)] border-b border-[var(--dpf-border)]">
      {steps.map((step, i) => (
        <StepNode key={step.id} step={step} idx={i} last={i === steps.length - 1} />
      ))}
    </div>
  );
}
