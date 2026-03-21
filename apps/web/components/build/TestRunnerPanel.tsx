"use client";

import { useState } from "react";

type TestStep = {
  step: string;
  passed: boolean;
  screenshotUrl: string | null;
  error: string | null;
};

export function TestRunnerPanel({ steps }: { steps: TestStep[] }) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  if (steps.length === 0) {
    return (
      <div className="p-4 text-center text-[var(--dpf-muted)] text-sm">
        UX tests will appear here during the Review phase.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      <h3 className="text-xs font-semibold text-[var(--dpf-text)] uppercase tracking-widest">UX Test Results</h3>
      {steps.map((s, i) => (
        <div key={i}>
          <button
            onClick={() => setExpandedStep(expandedStep === i ? null : i)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-left cursor-pointer hover:border-[var(--dpf-accent)] transition-colors"
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: s.passed ? "#4ade80" : "#f87171" }}
            />
            <span className="text-xs text-[var(--dpf-text)] flex-1">{s.step}</span>
            <span className="text-[10px] text-[var(--dpf-muted)]">{s.passed ? "PASS" : "FAIL"}</span>
          </button>
          {expandedStep === i && (
            <div className="mt-1 ml-4 p-2 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
              {s.screenshotUrl && (
                <img src={s.screenshotUrl} alt={`Step ${i + 1}`} className="rounded border border-[var(--dpf-border)] mb-2 max-w-full" />
              )}
              {s.error && (
                <pre className="text-[10px] text-[#f87171] whitespace-pre-wrap">{s.error}</pre>
              )}
              {!s.screenshotUrl && !s.error && (
                <span className="text-[10px] text-[var(--dpf-muted)]">No details available</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
