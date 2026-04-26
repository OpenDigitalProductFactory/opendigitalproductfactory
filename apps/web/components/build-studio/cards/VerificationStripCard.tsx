"use client";
import { Check, ChevronRight } from "lucide-react";
import type { StoryStep, StoryStepResult } from "../types";

interface Props {
  steps: StoryStep[];
  onDrill: () => void;
}

function colorFor(result: StoryStepResult): string {
  switch (result) {
    case "passed":
      return "var(--dpf-success)";
    case "running":
      return "var(--dpf-accent)";
    case "failed":
      return "var(--dpf-error)";
    case "queued":
    default:
      return "var(--dpf-border-strong)";
  }
}

export function VerificationStripCard({ steps, onDrill }: Props) {
  const working = steps.filter((s) => s.result === "passed").length;
  const total = steps.length;

  return (
    <div className="mt-2 p-3.5 bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-xl">
      <div className="flex items-center mb-2.5">
        <div className="text-[10.5px] font-bold text-[var(--dpf-muted)] uppercase tracking-[0.6px]">
          Walking through the feature
        </div>
        <span className="flex-1" />
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11.5px] font-semibold rounded-full border"
          style={{
            color: "var(--dpf-success)",
            background: "color-mix(in srgb, var(--dpf-success) 12%, var(--dpf-surface-1))",
            borderColor: "color-mix(in srgb, var(--dpf-success) 35%, var(--dpf-border))",
          }}
        >
          {working} of {total} working
        </span>
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {steps.map((s) => {
          const c = colorFor(s.result);
          return (
            <div
              key={s.idx}
              data-testid="verification-strip-cell"
              data-status={s.result}
              className="relative bg-[var(--dpf-surface-3)] rounded-md overflow-hidden"
              style={{
                aspectRatio: "1.4 / 1",
                border: `1px solid ${c}`,
              }}
            >
              <div
                className="absolute top-1 left-1 text-[9.5px] font-bold px-1 py-px rounded-sm bg-[var(--dpf-surface-1)]"
                style={{ color: c, border: `1px solid ${c}` }}
              >
                {s.idx}
              </div>
              {s.result === "running" && (
                <div className="absolute inset-0 animate-pulse" style={{ opacity: 0.35, background: c }} />
              )}
              {s.result === "passed" && (
                <div
                  className="absolute bottom-1 right-1"
                  style={{ color: c, opacity: 0.7 }}
                  aria-hidden="true"
                >
                  <Check size={12} strokeWidth={2.4} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--dpf-border)]">
        <button
          type="button"
          onClick={onDrill}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-[12.5px] font-medium rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-3)] transition-colors"
        >
          See screenshots
          <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}
