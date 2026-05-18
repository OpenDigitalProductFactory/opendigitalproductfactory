"use client";

import type { BuildProgressVisibility } from "@/lib/build/progress-visibility";
import { getTruthSourceAge } from "@/lib/build/progress-visibility-types";
import { BuildDispatchHistoryCard } from "./BuildDispatchHistoryCard";
import { BuildSandboxCard } from "./BuildSandboxCard";
import { BuildVerificationScopedCard } from "./BuildVerificationScopedCard";
import { TruthSourceBadge } from "./TruthSourceBadge";

type Props = {
  projection: BuildProgressVisibility | null;
};

export function BuildProgressOperationalPanel({ projection }: Props) {
  if (!projection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--dpf-muted)]">
        Loading build progress...
      </div>
    );
  }

  const completed = projection.progress.primary.completed;
  const total = projection.progress.primary.total;
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const primaryAge = getTruthSourceAge(projection.progress.primary.observedAt);

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase text-[var(--dpf-muted)]">Operational status</p>
              <h3 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">
                {projection.statusHeading.operatorAction}
              </h3>
              {projection.statusHeading.failureAxis && (
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                  Failure axis: {projection.statusHeading.failureAxis}
                </p>
              )}
            </div>
            <TruthSourceBadge
              source={projection.progress.primary.source}
              observedAt={projection.progress.primary.observedAt}
              ageLabel={primaryAge.label}
            />
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--dpf-text)]">
                {completed} / {total} tasks complete
              </div>
              <div className="text-xs text-[var(--dpf-muted)]">{percent}%</div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded bg-[var(--dpf-surface-2)]">
              <div className="h-full bg-[var(--dpf-accent)]" style={{ width: `${percent}%` }} />
            </div>
          </div>

          {projection.progress.conflicts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {projection.progress.conflicts.map((conflict) => (
                <TruthSourceBadge
                  key={`${conflict.source}-${conflict.observedAt}`}
                  source={conflict.source}
                  observedAt={conflict.observedAt}
                  conflict
                />
              ))}
            </div>
          )}

          {projection.quietAgent.quiet && (
            <div className="mt-3 rounded border border-[var(--dpf-warning)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]">
              Agent has been quiet for {projection.quietAgent.minutesQuiet}m
              <span className="text-[var(--dpf-muted)]"> - </span>
              <a className="font-semibold text-[var(--dpf-accent)] underline-offset-2 hover:underline" href="#build-dispatch-history">
                view last action
              </a>
            </div>
          )}
        </section>

        <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Task list</h3>
          <div className="mt-2 space-y-1">
            {projection.tasks.tasks.length > 0 ? projection.tasks.tasks.map((task) => (
              <div key={`${task.taskIndex}-${task.title}`} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-[var(--dpf-text)]">{task.title}</span>
                  <span className="text-[var(--dpf-muted)]">{task.outcome}</span>
                </div>
                {task.summary && <div className="mt-1 truncate text-[var(--dpf-muted)]">{task.summary}</div>}
              </div>
            )) : (
              <p className="text-xs text-[var(--dpf-muted)]">No task rows recorded yet.</p>
            )}
          </div>
        </section>

        <div className="grid gap-3 xl:grid-cols-3">
          <BuildSandboxCard sandbox={projection.sandbox} />
          <BuildDispatchHistoryCard attempts={projection.dispatchHistory} />
          <BuildVerificationScopedCard verification={projection.verification} />
        </div>
      </div>
    </div>
  );
}
