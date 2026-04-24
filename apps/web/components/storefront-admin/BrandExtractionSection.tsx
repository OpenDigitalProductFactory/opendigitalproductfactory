"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BrandExtractionForm } from "./BrandExtractionForm";
import { BrandPreview } from "./BrandPreview";
import { requestBrandExtraction } from "@/lib/actions/request-brand-extraction";
import { applyBrandDesignSystem } from "@/lib/actions/apply-brand-design-system";
import type { BrandDesignSystem } from "@/lib/brand/types";
import { extractBrandDesignSystemFromTaskResponse } from "@/lib/brand/task-artifacts";
import { coerceBrandExtractionEvent } from "@/lib/brand/extraction-events";
import { extractBrandExtractionStatusFromTaskResponse } from "@/lib/brand/task-status";

type Props = {
  organizationId: string;
  allowCodebaseSource: boolean;
  initialSystem: BrandDesignSystem | null;
  initialThreadId: string | null;
  hasActiveExtraction: boolean;
};

type Status =
  | { kind: "idle" }
  | { kind: "queued"; taskRunId: string; threadId: string; message: string }
  | { kind: "running"; taskRunId: string; threadId: string; stage: string; message: string; percent: number }
  | { kind: "complete"; taskRunId: string; summary: string }
  | { kind: "failed"; taskRunId: string; error: string };

type SSEEvent =
  | { type: "brand:extract.progress"; taskRunId: string; stage: string; message: string; percent: number }
  | { type: "brand:extract.complete"; taskRunId: string; summary: string }
  | { type: "brand:extract.failed"; taskRunId: string; error: string }
  | { type: string };

async function loadLatestDesignSystem(taskRunId: string): Promise<BrandDesignSystem | null> {
  const response = await fetch(`/api/internal/tasks/${taskRunId}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return extractBrandDesignSystemFromTaskResponse(payload);
}

async function loadTaskEnvelope(taskRunId: string): Promise<unknown | null> {
  const response = await fetch(`/api/internal/tasks/${taskRunId}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

export function BrandExtractionSection({
  organizationId,
  allowCodebaseSource,
  initialSystem,
  initialThreadId,
  hasActiveExtraction,
}: Props) {
  const router = useRouter();
  const [system, setSystem] = useState<BrandDesignSystem | null>(initialSystem);
  const [status, setStatus] = useState<Status>(() =>
    hasActiveExtraction && initialThreadId
      ? { kind: "queued", taskRunId: "", threadId: initialThreadId, message: "Already running — reattaching..." }
      : { kind: "idle" },
  );
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [applying, startApplying] = useTransition();
  const [applyError, setApplyError] = useState<string | null>(null);
  const [appliedAt, setAppliedAt] = useState<Date | null>(null);
  const pollingTaskRunId = status.kind === "queued" || status.kind === "running"
    ? status.taskRunId
    : null;

  useEffect(() => {
    setSystem(initialSystem);
  }, [initialSystem]);

  // Subscribe to SSE for the thread while a run is active.
  useEffect(() => {
    const running = status.kind === "queued" || status.kind === "running";
    if (!running || !threadId) return;
    const activeTaskRunId = status.taskRunId || null;

    const es = new EventSource(`/api/agent/stream?threadId=${threadId}`);
    es.onmessage = (raw) => {
      try {
        const event = JSON.parse(raw.data) as SSEEvent;
        const brandEvent = coerceBrandExtractionEvent(event, activeTaskRunId);
        if (!brandEvent) {
          return;
        }

        if (brandEvent.type === "brand:extract.progress") {
          const e = brandEvent;
          setStatus({
            kind: "running",
            taskRunId: e.taskRunId,
            threadId,
            stage: e.stage,
            message: e.message,
            percent: e.percent,
          });
        } else if (brandEvent.type === "brand:extract.complete") {
          const e = brandEvent;
          setStatus({ kind: "complete", taskRunId: e.taskRunId, summary: e.summary });
          void loadLatestDesignSystem(e.taskRunId)
            .then((nextSystem) => {
              if (nextSystem) {
                setSystem(nextSystem);
              }
            })
            .finally(() => {
              router.refresh();
            });
        } else if (brandEvent.type === "brand:extract.failed") {
          const e = brandEvent;
          setStatus({ kind: "failed", taskRunId: e.taskRunId, error: e.error });
        }
      } catch {
        // Malformed event; ignore.
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => {
      es.close();
    };
  }, [status.kind, threadId, router]);

  useEffect(() => {
    const activeTaskRunId = pollingTaskRunId;
    if (!activeTaskRunId) {
      return;
    }

    let cancelled = false;

    const syncTask = async () => {
      const payload = await loadTaskEnvelope(activeTaskRunId);
      if (!payload || cancelled) {
        return;
      }

      const nextStatus = extractBrandExtractionStatusFromTaskResponse(payload);
      const nextSystem = extractBrandDesignSystemFromTaskResponse(payload);

      if (nextSystem) {
        setSystem(nextSystem);
      }

      if (!nextStatus || nextStatus.taskRunId !== activeTaskRunId) {
        return;
      }

      if (nextStatus.kind === "queued") {
        setStatus((current) =>
          current.kind === "queued" && current.taskRunId === nextStatus.taskRunId
            ? { ...current, message: nextStatus.message }
            : current,
        );
        return;
      }

      if (nextStatus.kind === "running") {
        setStatus({
          kind: "running",
          taskRunId: nextStatus.taskRunId,
          threadId: threadId ?? "",
          stage: nextStatus.stage,
          message: nextStatus.message,
          percent: nextStatus.percent,
        });
        return;
      }

      if (nextStatus.kind === "complete") {
        setStatus({
          kind: "complete",
          taskRunId: nextStatus.taskRunId,
          summary: nextStatus.summary,
        });
        router.refresh();
        return;
      }

      if (nextStatus.kind === "failed") {
        setStatus({
          kind: "failed",
          taskRunId: nextStatus.taskRunId,
          error: nextStatus.error,
        });
      }
    };

    void syncTask();
    const interval = setInterval(() => {
      void syncTask();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollingTaskRunId, threadId, router]);

  async function handleExtract(inputs: { url?: string; includeCodebase: boolean }) {
    setStatus({ kind: "queued", taskRunId: "", threadId: threadId ?? "", message: "Queueing..." });
    const result = await requestBrandExtraction(inputs);
    if (!result.success) {
      setStatus({ kind: "failed", taskRunId: "", error: result.error });
      return;
    }
    setThreadId(result.threadId);
    setStatus({
      kind: "queued",
      taskRunId: result.taskRunId,
      threadId: result.threadId,
      message: result.status === "already-in-progress"
        ? "An extraction was already running — watching for completion."
        : "Working on it — I'll update this panel as progress comes in.",
    });
  }

  function handleApply() {
    setApplyError(null);
    startApplying(async () => {
      const result = await applyBrandDesignSystem(organizationId);
      if (!result.success) {
        setApplyError(result.error);
      } else {
        setAppliedAt(new Date());
        router.refresh();
      }
    });
  }

  const busy = status.kind === "queued" || status.kind === "running";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 }}>
      <BrandExtractionForm allowCodebaseSource={allowCodebaseSource} onExtract={handleExtract} busy={busy} />

      {status.kind === "queued" && (
        <StatusStrip tone="info">{status.message}</StatusStrip>
      )}
      {status.kind === "running" && (
        <StatusStrip tone="info">
          {status.stage}: {status.message} ({status.percent}%)
        </StatusStrip>
      )}
      {status.kind === "complete" && (
        <StatusStrip tone="success">{status.summary}</StatusStrip>
      )}
      {status.kind === "failed" && (
        <StatusStrip tone="error">Extraction failed: {status.error}</StatusStrip>
      )}

      {system && (
        <BrandPreview
          system={system}
          onApply={handleApply}
          applying={applying}
          applyError={applyError}
          appliedAt={appliedAt}
        />
      )}
    </div>
  );
}

function StatusStrip({ tone, children }: { tone: "info" | "success" | "error"; children: React.ReactNode }) {
  const color = tone === "error" ? "#ef4444" : tone === "success" ? "#10b981" : "#3b82f6";
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: 6,
        background: `${color}15`,
        color,
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      {children}
    </div>
  );
}
