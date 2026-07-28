"use client";

import { useState, useTransition } from "react";
import {
  rerunAgentTask,
  setAgentTaskActive,
} from "@/lib/actions/agent-task-scheduler";

export function ProductIntelligenceWatchActions({
  taskId,
  isActive,
}: {
  taskId: string;
  isActive: boolean;
}) {
  const [active, setActive] = useState(isActive);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setMessage(null);
    startTransition(async () => {
      const result = await setAgentTaskActive(taskId, !active);
      if (!result.success) {
        setMessage(result.error ?? "The schedule could not be updated.");
        return;
      }
      setActive(!active);
      setMessage(!active ? "Schedule resumed." : "Schedule paused.");
    });
  }

  function runNow() {
    setMessage(null);
    startTransition(async () => {
      const result = await rerunAgentTask(taskId);
      setMessage(
        result.success
          ? "A proposal run is queued."
          : result.error ?? "The scan could not be queued.",
      );
    });
  }

  return (
    <div className="mt-dpf-sm">
      <div className="flex flex-wrap gap-dpf-sm">
        <button
          type="button"
          disabled={pending}
          onClick={toggle}
          className="rounded-dpf-md border border-[var(--dpf-border)] px-dpf-sm py-dpf-2xs text-dpf-caption font-dpf-medium text-[var(--dpf-text)] disabled:opacity-50"
        >
          {active ? "Pause" : "Resume"}
        </button>
        <button
          type="button"
          disabled={pending || !active}
          onClick={runNow}
          className="rounded-dpf-md border border-[var(--dpf-border)] px-dpf-sm py-dpf-2xs text-dpf-caption font-dpf-medium text-[var(--dpf-accent)] disabled:opacity-50"
        >
          Run proposal scan now
        </button>
      </div>
      {message ? (
        <p className="mt-dpf-xs text-dpf-caption text-[var(--dpf-muted)]" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
