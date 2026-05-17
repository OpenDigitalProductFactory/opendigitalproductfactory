/**
 * Voice Input Slice 1 / Task 11 — admin readiness card (server component).
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §5.3
 *
 * Mounted under Platform Tools > Communications. Shows the speaches sidecar
 * (or replacement) readiness state and a test-phrase harness.
 */

import { Mic } from "lucide-react";
import { getSpeechToTextReadiness, type SpeechToTextStatus } from "@/lib/voice/readiness";
import { SpeechToTextTestHarness } from "./SpeechToTextTestHarness";

const STATUS_COPY: Record<SpeechToTextStatus, { label: string; tone: "positive" | "warning" | "neutral" }> = {
  healthy: { label: "Healthy", tone: "positive" },
  unhealthy: { label: "Unhealthy", tone: "warning" },
  unconfigured: { label: "Not configured", tone: "neutral" },
};

export async function SpeechToTextCard() {
  const readiness = await getSpeechToTextReadiness();
  const statusCopy = STATUS_COPY[readiness.status];

  return (
    <section
      aria-label="Speech-to-text"
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-accent)]">
            <Mic className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">Speech-to-text</h2>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">
              Voice input modality
            </p>
          </div>
        </div>
        <span
          data-testid="stt-status-badge"
          data-status={readiness.status}
          className={
            "rounded border px-2.5 py-1 text-xs font-medium " +
            (statusCopy.tone === "positive"
              ? "border-[var(--dpf-success,#0a7)] bg-[color-mix(in_srgb,var(--dpf-success,#0a7)_15%,transparent)] text-[var(--dpf-text)]"
              : statusCopy.tone === "warning"
                ? "border-[var(--dpf-error,#d33)] bg-[color-mix(in_srgb,var(--dpf-error,#d33)_15%,transparent)] text-[var(--dpf-text)]"
                : "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]")
          }
        >
          {statusCopy.label}
        </span>
      </header>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Provider</dt>
          <dd className="mt-1 truncate text-sm text-[var(--dpf-text)]">
            {readiness.providerName ?? "—"}
          </dd>
        </div>
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Model</dt>
          <dd className="mt-1 truncate text-sm text-[var(--dpf-text)]" title={readiness.modelId ?? undefined}>
            {readiness.modelId ?? "—"}
          </dd>
        </div>
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Endpoint</dt>
          <dd className="mt-1 truncate text-sm text-[var(--dpf-text)]" title={readiness.baseUrl ?? undefined}>
            {readiness.baseUrl ?? "—"}
          </dd>
        </div>
      </dl>

      <p
        data-testid="stt-status-reason"
        className="mt-3 text-sm leading-6 text-[var(--dpf-muted)]"
      >
        {readiness.reason}
      </p>

      <SpeechToTextTestHarness readinessIsHealthy={readiness.status === "healthy"} />
    </section>
  );
}
