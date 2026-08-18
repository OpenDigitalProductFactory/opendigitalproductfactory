"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  mergeStewardTaskAction,
  resolveStewardTaskAction,
  runStewardSweepAction,
} from "@/lib/actions/data-stewardship";
import type { MergeableDomain } from "@/lib/mdm/merge";

export type StewardTaskRow = {
  taskId: string;
  domain: string;
  kind: "duplicate" | "stale";
  subjectId: string;
  subjectLabel: string;
  candidateId: string | null;
  candidateLabel: string | null;
  score: number | null;
  note: string | null;
};

const buttonClasses =
  "px-2.5 py-1 rounded-md text-xs border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50";
const primaryButtonClasses =
  "px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50";

function detailHref(domain: string, id: string): string | null {
  return domain === "customer-account" ? `/customer/${id}` : null;
}

/**
 * Steward review queue (BI-FEA49EC1): one decision per row, resolved inline.
 * Duplicate tasks: keep-subject merge (candidate merges away), mark distinct,
 * or dismiss. Stale tasks: confirm refreshed or dismiss.
 */
export function StewardTaskList({ tasks }: { tasks: StewardTaskRow[] }) {
  const [error, setError] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function act(taskId: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusyTask(taskId);
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
      setBusyTask(null);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--dpf-muted)]">
          {tasks.length} open task{tasks.length !== 1 ? "s" : ""}
        </p>
        <button
          className={buttonClasses}
          disabled={isPending}
          onClick={() => act("__sweep__", () => runStewardSweepAction())}
        >
          {busyTask === "__sweep__" ? "Sweeping…" : "Run sweep now"}
        </button>
      </div>

      {error && <p className="text-xs text-[var(--dpf-text)]">{error}</p>}

      {tasks.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">
          Queue is clear — run a sweep to check for new duplicates or stale records.
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const subjectHref = detailHref(task.domain, task.subjectId);
            const candidateHref = task.candidateId ? detailHref(task.domain, task.candidateId) : null;
            const busy = busyTask === task.taskId;
            return (
              <li
                key={task.taskId}
                className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-mono text-[var(--dpf-muted)]">
                      {task.taskId} · {task.domain} · {task.kind}
                      {task.score != null && ` · score ${Math.round(task.score * 100) / 100}`}
                    </p>
                    <p className="text-sm text-[var(--dpf-text)] mt-0.5">
                      {subjectHref ? (
                        <Link href={subjectHref} className="text-[var(--dpf-accent)] hover:underline">
                          {task.subjectLabel}
                        </Link>
                      ) : (
                        task.subjectLabel
                      )}
                      {task.candidateLabel && (
                        <>
                          {" ↔ "}
                          {candidateHref ? (
                            <Link href={candidateHref} className="text-[var(--dpf-accent)] hover:underline">
                              {task.candidateLabel}
                            </Link>
                          ) : (
                            task.candidateLabel
                          )}
                        </>
                      )}
                    </p>
                    {task.note && <p className="text-xs text-[var(--dpf-muted)] mt-1">{task.note}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 justify-end shrink-0">
                    {task.kind === "duplicate" && task.candidateId ? (
                      <>
                        <button
                          className={primaryButtonClasses}
                          disabled={isPending}
                          title={`Keep "${task.subjectLabel}", merge "${task.candidateLabel}" into it`}
                          onClick={() =>
                            act(task.taskId, () =>
                              mergeStewardTaskAction(
                                task.taskId,
                                task.domain as MergeableDomain,
                                task.subjectId,
                                task.candidateId!,
                              ),
                            )
                          }
                        >
                          {busy ? "Merging…" : "Merge (keep first)"}
                        </button>
                        <button
                          className={buttonClasses}
                          disabled={isPending}
                          onClick={() =>
                            act(task.taskId, () =>
                              resolveStewardTaskAction(task.taskId, "resolved_distinct"),
                            )
                          }
                        >
                          Different records
                        </button>
                      </>
                    ) : (
                      <button
                        className={primaryButtonClasses}
                        disabled={isPending}
                        onClick={() =>
                          act(task.taskId, () =>
                            resolveStewardTaskAction(task.taskId, "resolved_refreshed"),
                          )
                        }
                      >
                        {busy ? "Confirming…" : "Confirmed current"}
                      </button>
                    )}
                    <button
                      className={buttonClasses}
                      disabled={isPending}
                      onClick={() =>
                        act(task.taskId, () => resolveStewardTaskAction(task.taskId, "dismissed"))
                      }
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
