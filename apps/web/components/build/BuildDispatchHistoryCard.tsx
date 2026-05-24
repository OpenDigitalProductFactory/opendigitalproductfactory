"use client";

import type { BuildDispatchAttemptView } from "@/lib/build/dispatch-attempts";
import { TruthSourceBadge } from "./TruthSourceBadge";

type Props = {
  attempts: BuildDispatchAttemptView[];
};

export function BuildDispatchHistoryCard({ attempts }: Props) {
  const latest = attempts.at(-1) ?? null;

  return (
    <section id="build-dispatch-history" className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Dispatch attempts</h3>
        <TruthSourceBadge source="dispatch-history" observedAt={latest?.completedAt ?? latest?.startedAt ?? null} />
      </div>
      <div className="mt-3 space-y-2">
        {attempts.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)]">No dispatch attempts recorded yet.</p>
        ) : attempts.map((attempt) => {
          const diagnosis = attempt.rootCauseSummary ?? attempt.failureAxis;
          const rawOutput = attempt.stdoutExcerpt ?? attempt.stderrExcerpt;
          return (
            <div key={attempt.id} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-[var(--dpf-text)]">{attempt.taskTitle}</span>
                <span className="text-[var(--dpf-muted)]">exit {attempt.exitCode ?? "running"} · {attempt.failureAxis}</span>
              </div>
              <div
                className="mt-1 text-[var(--dpf-text)]"
                title="Classified diagnosis — derived from stdout/stderr and the failure axis."
              >
                {diagnosis}
              </div>
              {attempt.model && (
                <div className="mt-1 text-[var(--dpf-muted)]">{attempt.model}</div>
              )}
              {rawOutput && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] uppercase text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
                    Raw stdout/stderr
                  </summary>
                  <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 text-[10px] text-[var(--dpf-muted)]">
                    {rawOutput}
                  </pre>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
