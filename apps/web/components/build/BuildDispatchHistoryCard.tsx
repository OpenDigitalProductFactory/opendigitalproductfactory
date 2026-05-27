"use client";

import { useEffect, useRef } from "react";
import type { BuildDispatchAttemptView } from "@/lib/build/dispatch-attempts";
import { TruthSourceBadge } from "./TruthSourceBadge";

type Props = {
  attempts: BuildDispatchAttemptView[];
};

/**
 * Custom event name shared with BuildProgressOperationalPanel's quiet-agent
 * link. Kept as a module-level string so both ends agree without a context
 * or shared store. Per BI-9A7DA4AC + 2026-05-24 spec §6.
 */
const OPEN_LAST_DISPATCH_ATTEMPT_EVENT = "dpf:open-last-dispatch-attempt";

export function BuildDispatchHistoryCard({ attempts }: Props) {
  const latest = attempts.at(-1) ?? null;
  const sectionRef = useRef<HTMLElement>(null);

  // Listen for the quiet-agent banner's "view last action" link. On fire, open
  // the most-recent attempt's <details> and apply a 2s highlight via
  // data-just-opened. No-op when the card has zero attempts. See BI-9A7DA4AC.
  useEffect(() => {
    if (typeof document === "undefined") return;
    let highlightTimer: ReturnType<typeof setTimeout> | null = null;
    function handler() {
      const root = sectionRef.current;
      if (!root) return;
      const row = root.querySelector<HTMLElement>('[data-most-recent="true"]');
      if (!row) return;
      const details = row.querySelector<HTMLDetailsElement>("details");
      if (details) details.open = true;
      row.setAttribute("data-just-opened", "true");
      if (highlightTimer) clearTimeout(highlightTimer);
      highlightTimer = setTimeout(() => {
        row.removeAttribute("data-just-opened");
        highlightTimer = null;
      }, 2000);
    }
    document.addEventListener(OPEN_LAST_DISPATCH_ATTEMPT_EVENT, handler);
    return () => {
      document.removeEventListener(OPEN_LAST_DISPATCH_ATTEMPT_EVENT, handler);
      if (highlightTimer) clearTimeout(highlightTimer);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      id="build-dispatch-history"
      className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Dispatch attempts</h3>
        <TruthSourceBadge source="dispatch-history" observedAt={latest?.completedAt ?? latest?.startedAt ?? null} />
      </div>
      <div className="mt-3 space-y-2">
        {attempts.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)]">No dispatch attempts recorded yet.</p>
        ) : attempts.map((attempt, idx) => {
          const diagnosis = attempt.rootCauseSummary ?? attempt.failureAxis;
          const rawOutput = attempt.stdoutExcerpt ?? attempt.stderrExcerpt;
          const isMostRecent = idx === attempts.length - 1;
          return (
            <div
              key={attempt.id}
              data-most-recent={isMostRecent ? "true" : undefined}
              className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-2 text-xs transition-shadow data-[just-opened=true]:ring-2 data-[just-opened=true]:ring-[var(--dpf-accent)] data-[just-opened=true]:ring-offset-2 data-[just-opened=true]:ring-offset-[var(--dpf-surface-1)]"
            >
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
