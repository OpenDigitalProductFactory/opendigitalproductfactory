"use client";
import { Package } from "lucide-react";
import type { Step } from "../types";

interface Props {
  steps: Step[];
  stepId: Step["id"];
}

export function StepRefCard({ steps, stepId }: Props) {
  const step = steps.find((s) => s.id === stepId);
  if (!step) return null;
  return (
    <span className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 text-[12px] rounded-full bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text-secondary)]">
      <Package size={12} aria-hidden="true" />
      <span className="text-[var(--dpf-muted)]">Started</span>
      <span className="font-semibold text-[var(--dpf-text)]">{step.label}</span>
    </span>
  );
}
