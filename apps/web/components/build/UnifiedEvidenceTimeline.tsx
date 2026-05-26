"use client";

export type UnifiedEvidenceTimelineEvent = {
  id: string;
  source: "build-studio" | "codex" | "local-integration" | "review" | "external";
  label: string;
  summary: string;
  status?: "passed" | "pending" | "failed" | "recorded";
  timestamp?: string | Date | null;
};

const SOURCE_LABELS: Record<UnifiedEvidenceTimelineEvent["source"], string> = {
  "build-studio": "Build Studio",
  codex: "Codex",
  "local-integration": "Local integration",
  review: "Review",
  external: "External evidence",
};

const STATUS_CLASSES: Record<NonNullable<UnifiedEvidenceTimelineEvent["status"]>, string> = {
  passed: "text-[var(--dpf-success)]",
  recorded: "text-[var(--dpf-accent)]",
  pending: "text-[var(--dpf-warning)]",
  failed: "text-[var(--dpf-error)]",
};

export function UnifiedEvidenceTimeline({ events }: { events: UnifiedEvidenceTimelineEvent[] }) {
  if (events.length === 0) return null;

  return (
    <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <h3 className="text-xs font-semibold uppercase text-[var(--dpf-text)]">
        Evidence timeline
      </h3>
      <ol className="mt-3 space-y-2">
        {events.map((event) => (
          <li key={event.id} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-[var(--dpf-text)]">
                {event.label || SOURCE_LABELS[event.source]}
              </div>
              {event.status && (
                <span className={`text-[10px] font-semibold uppercase ${STATUS_CLASSES[event.status]}`}>
                  {event.status}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--dpf-muted)]">
              {sanitizeEvidenceSummary(event.summary)}
            </p>
            {event.timestamp && (
              <time className="mt-1 block text-[10px] text-[var(--dpf-muted)]" dateTime={toDateTime(event.timestamp)}>
                {formatTimestamp(event.timestamp)}
              </time>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function toDateTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function formatTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function sanitizeEvidenceSummary(summary: string): string {
  return summary
    .replace(/\bExternalEvidenceRecord\b/g, "external evidence")
    .replace(/\bToolExecutionReceipt\b/g, "tool evidence")
    .replace(/\bMCP\b/gi, "platform")
    .replace(/\bdpf-[a-z0-9-]+\b/gi, "platform skill")
    .replace(/\bprinciple_decide\b/gi, "decision service");
}
