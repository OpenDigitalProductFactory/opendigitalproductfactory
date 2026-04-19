"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BrandExtractionForm } from "./BrandExtractionForm";
import { BrandPreview } from "./BrandPreview";
import { requestBrandExtraction } from "@/lib/actions/request-brand-extraction";
import { applyBrandDesignSystem } from "@/lib/actions/apply-brand-design-system";
import type { BrandDesignSystem } from "@/lib/brand/types";

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

  // Subscribe to SSE for the thread while a run is active.
  useEffect(() => {
    const running = status.kind === "queued" || status.kind === "running";
    if (!running || !threadId) return;

    const es = new EventSource(`/api/agent/stream?threadId=${threadId}`);
    es.onmessage = (raw) => {
      try {
        const event = JSON.parse(raw.data) as SSEEvent;
        if (event.type === "brand:extract.progress") {
          const e = event as Extract<SSEEvent, { type: "brand:extract.progress" }>;
          setStatus({
            kind: "running",
            taskRunId: e.taskRunId,
            threadId,
            stage: e.stage,
            message: e.message,
            percent: e.percent,
          });
        } else if (event.type === "brand:extract.complete") {
          const e = event as Extract<SSEEvent, { type: "brand:extract.complete" }>;
          setStatus({ kind: "complete", taskRunId: e.taskRunId, summary: e.summary });
          router.refresh();
        } else if (event.type === "brand:extract.failed") {
          const e = event as Extract<SSEEvent, { type: "brand:extract.failed" }>;
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
