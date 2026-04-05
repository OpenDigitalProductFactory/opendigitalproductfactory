"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  completeOnboardingTask,
  skipOnboardingTask,
} from "@/lib/actions/onboarding";
import type { TaskRow } from "@/lib/onboarding-data";

const STATUS_COLOURS: Record<string, string> = {
  pending: "var(--dpf-info)",
  completed: "var(--dpf-success)",
  skipped: "var(--dpf-muted)",
};

const ROLE_LABELS: Record<string, string> = {
  hr: "HR",
  manager: "Manager",
  it: "IT",
  employee: "Employee",
};

type Props = {
  tasks: TaskRow[];
  checklistType: "onboarding" | "offboarding";
};

export function OnboardingPanel({ tasks, checklistType }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const requiredCount = tasks.filter((t) => t.required).length;
  const requiredCompleted = tasks.filter((t) => t.required && t.status === "completed").length;
  const allRequiredDone = requiredCount > 0 && requiredCompleted === requiredCount;

  function handleComplete(taskId: string) {
    startTransition(async () => {
      await completeOnboardingTask(taskId);
      router.refresh();
    });
  }

  function handleSkip(taskId: string) {
    startTransition(async () => {
      await skipOnboardingTask(taskId);
      router.refresh();
    });
  }

  if (tasks.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
          {checklistType === "onboarding" ? "Onboarding" : "Offboarding"} Checklist
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--dpf-muted)]">
            {completedCount}/{tasks.length} done
          </span>
          {allRequiredDone && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--dpf-success)]/10 text-[var(--dpf-success)] border border-[var(--dpf-success)]/30">
              Ready to advance
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-[var(--dpf-surface-2)] mb-3">
        <div
          className="h-1 rounded-full bg-[var(--dpf-accent)] transition-all"
          style={{ width: `${tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0}%` }}
        />
      </div>

      <div className="space-y-2">
        {tasks.map((task) => {
          const colour = STATUS_COLOURS[task.status] ?? "var(--dpf-muted)";
          return (
            <div
              key={task.id}
              className="flex items-start gap-2 p-2 rounded border border-[var(--dpf-border)]"
              style={{ opacity: task.status !== "pending" ? 0.6 : 1 }}
            >
              {/* Status indicator */}
              <div className="mt-0.5 shrink-0">
                {task.status === "completed" ? (
                  <span className="text-[var(--dpf-success)] text-xs">&#10003;</span>
                ) : task.status === "skipped" ? (
                  <span className="text-[var(--dpf-muted)] text-xs">&#8212;</span>
                ) : (
                  <span
                    className="inline-block w-3 h-3 rounded-sm border"
                    style={{ borderColor: colour }}
                  />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${task.status === "completed" ? "line-through text-[var(--dpf-muted)]" : "text-[var(--dpf-text)]"}`}>
                    {task.title}
                  </span>
                  {task.required && task.status === "pending" && (
                    <span className="text-[9px] text-[var(--dpf-error)]">required</span>
                  )}
                  {task.assigneeRole && (
                    <span className="text-[9px] px-1 rounded bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                      {ROLE_LABELS[task.assigneeRole] ?? task.assigneeRole}
                    </span>
                  )}
                </div>
                {task.description && (
                  <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5">{task.description}</p>
                )}
                {task.dueDate && task.status === "pending" && (
                  <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5">
                    Due: {new Date(task.dueDate).toLocaleDateString()}
                  </p>
                )}
              </div>

              {/* Actions */}
              {task.status === "pending" && (
                <div className="shrink-0 flex gap-1">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleComplete(task.taskId)}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--dpf-success)]/30 text-[var(--dpf-success)] hover:bg-[var(--dpf-success)]/10 disabled:opacity-50"
                  >
                    Done
                  </button>
                  {!task.required && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleSkip(task.taskId)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50"
                    >
                      Skip
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
