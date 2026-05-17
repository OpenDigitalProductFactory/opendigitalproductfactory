"use client";

import type { RestoreRunListItem } from "@/lib/operate/backups/restore-types";

interface Props {
  runs: RestoreRunListItem[];
}

const STATUS_PILL: Record<string, { bg: string; color: string; label: string }> = {
  ok: { bg: "rgba(74, 222, 128, 0.15)", color: "#4ade80", label: "OK" },
  failed: { bg: "rgba(248, 113, 113, 0.15)", color: "#f87171", label: "FAILED" },
  running: { bg: "rgba(99, 102, 241, 0.15)", color: "#6366f1", label: "RUNNING" },
};

function StatusPill({ status }: { status: string }) {
  const style = STATUS_PILL[status] ?? {
    bg: "rgba(136, 136, 160, 0.15)",
    color: "#8888a0",
    label: status.toUpperCase(),
  };
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
      style={{ background: style.bg, color: style.color }}
    >
      {style.label}
    </span>
  );
}

function formatTimestamp(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

function formatDurationMs(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60 * 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60000).toFixed(1)} min`;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="text-left px-3 py-2 text-[10px] uppercase font-medium"
      style={{ color: "var(--dpf-muted)" }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <td className="px-3 py-2" style={{ color: "var(--dpf-text)" }} title={title}>
      {children}
    </td>
  );
}

export function RestoreHistorySection({ runs }: Props) {
  if (runs.length === 0) {
    return (
      <section>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-3">
          Restore history
        </h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          No restores have been performed.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-3">
        Restore history
      </h2>
      <div
        className="rounded overflow-hidden"
        style={{ border: "1px solid var(--dpf-border)" }}
      >
        <table className="w-full text-xs">
          <thead style={{ background: "var(--dpf-bg)" }}>
            <tr>
              <Th>Started</Th>
              <Th>Status</Th>
              <Th>Source dump</Th>
              <Th>Safety dump</Th>
              <Th>Duration</Th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.id}
                style={{ borderTop: "1px solid var(--dpf-border)" }}
              >
                <Td>{formatTimestamp(r.startedAt)}</Td>
                <Td>
                  <StatusPill status={r.status} />
                  {r.errorMessage && (
                    <span
                      className="ml-2 text-[10px]"
                      style={{ color: "#f87171" }}
                      title={r.errorMessage}
                    >
                      ⚠
                    </span>
                  )}
                </Td>
                <Td title={r.sourceBackupRunId}>
                  {formatTimestamp(r.sourceFinishedAt)}
                </Td>
                <Td title={r.preRestoreBackupRunId ?? undefined}>
                  {r.preRestoreBackupRunId
                    ? r.preRestoreBackupRunId.slice(0, 8)
                    : "—"}
                </Td>
                <Td>{formatDurationMs(r.durationMs)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
