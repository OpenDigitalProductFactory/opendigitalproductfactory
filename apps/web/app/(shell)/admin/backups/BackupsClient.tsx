"use client";

import { useState, useTransition } from "react";

import {
  getBackupReadinessAction,
  listBackupRunsAction,
  readBackupRunLogAction,
  triggerBackupNowAction,
  type BackupRunListItem,
  type BackupRunLog,
} from "@/lib/actions/backups";
import type { ReadinessSummary } from "@/lib/operate/backups/types";

interface Props {
  initialReadiness: ReadinessSummary;
  initialRuns: BackupRunListItem[];
}

function formatBytes(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDurationMs(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60 * 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60000).toFixed(1)} min`;
}

function formatTimestamp(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString();
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

export function BackupsClient({ initialReadiness, initialRuns }: Props) {
  const [readiness, setReadiness] = useState(initialReadiness);
  const [runs, setRuns] = useState(initialRuns);
  const [pending, startTransition] = useTransition();
  const [openLog, setOpenLog] = useState<{ runId: string; data: BackupRunLog } | null>(null);
  const [loadingLog, setLoadingLog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [next, list] = await Promise.all([
      getBackupReadinessAction(),
      listBackupRunsAction({ limit: 50 }),
    ]);
    setReadiness(next);
    setRuns(list);
  }

  function handleTrigger() {
    setError(null);
    startTransition(async () => {
      const result = await triggerBackupNowAction();
      if (!result.ok) {
        setError(result.error ?? "Backup request failed.");
        return;
      }
      // Inngest runs asynchronously; give it a moment to mark the row, then refresh.
      // The cron concurrency limit serializes overlapping triggers.
      setTimeout(() => {
        refresh().catch((e: unknown) =>
          setError(e instanceof Error ? e.message : String(e)),
        );
      }, 1500);
    });
  }

  async function handleOpenLog(runId: string) {
    setLoadingLog(true);
    setError(null);
    try {
      const data = await readBackupRunLogAction(runId);
      setOpenLog({ runId, data });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingLog(false);
    }
  }

  const j = readiness.scheduledJob;
  const lastRun = readiness.lastRun;
  const overdue = readiness.failuresInLastThreeRuns >= 2;

  return (
    <div className="max-w-4xl space-y-8">
      {/* ─── Readiness card ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
            Readiness
          </h2>
          <button
            onClick={handleTrigger}
            disabled={pending}
            className="px-4 py-2 text-sm font-medium rounded transition-colors"
            style={{
              background: pending ? "var(--dpf-border)" : "var(--dpf-accent)",
              color: pending ? "var(--dpf-muted)" : "#fff",
              cursor: pending ? "not-allowed" : "pointer",
            }}
          >
            {pending ? "Triggering…" : "Run backup now"}
          </button>
        </div>

        <div
          className="rounded p-4 grid gap-3 text-sm"
          style={{
            background: "var(--dpf-surface)",
            border: "1px solid var(--dpf-border)",
          }}
        >
          <ReadinessRow
            label="Schedule"
            value={j ? `${j.schedule} (cron 03:00 UTC)` : "—"}
          />
          <ReadinessRow
            label="Last run"
            value={
              lastRun
                ? `${formatTimestamp(lastRun.startedAt)} · ${formatDurationMs(
                    lastRun.durationMs,
                  )} · ${formatBytes(lastRun.sizeBytes)}`
                : "never"
            }
            statusBadge={lastRun ? <StatusPill status={lastRun.status} /> : null}
          />
          <ReadinessRow
            label="Last successful run"
            value={
              readiness.lastSuccess
                ? `${formatTimestamp(readiness.lastSuccess.finishedAt)} · ${formatBytes(
                    readiness.lastSuccess.sizeBytes,
                  )}`
                : "never"
            }
          />
          <ReadinessRow
            label="Next run"
            value={j?.nextRunAt ? formatTimestamp(j.nextRunAt) : "—"}
          />
          <ReadinessRow
            label="Retention"
            value={`${readiness.retention.daily} daily · ${readiness.retention.weekly} weekly · ${readiness.retention.monthly} monthly`}
          />
          <ReadinessRow
            label="Retained on disk"
            value={`${readiness.retainedCount} backup${readiness.retainedCount === 1 ? "" : "s"} · ${formatBytes(
              readiness.retainedBytes,
            )}`}
          />
          <ReadinessRow label="Storage path" value={readiness.storagePath} />
        </div>

        {overdue && (
          <div
            className="mt-3 p-3 rounded text-sm"
            style={{
              background: "rgba(248, 113, 113, 0.15)",
              color: "#f87171",
              border: "1px solid rgba(248, 113, 113, 0.3)",
            }}
          >
            Multiple recent backups have failed. Investigate the latest run log
            for details.
          </div>
        )}

        {error && (
          <div
            className="mt-3 p-3 rounded text-sm"
            style={{
              background: "rgba(248, 113, 113, 0.15)",
              color: "#f87171",
              border: "1px solid rgba(248, 113, 113, 0.3)",
            }}
          >
            {error}
          </div>
        )}
      </section>

      {/* ─── History ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-3">
          History
        </h2>
        {runs.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)]">
            No backups yet — the first scheduled run will appear here. Click
            “Run backup now” above to create one immediately.
          </p>
        ) : (
          <div
            className="rounded overflow-hidden"
            style={{
              border: "1px solid var(--dpf-border)",
            }}
          >
            <table className="w-full text-xs">
              <thead style={{ background: "var(--dpf-bg)" }}>
                <tr>
                  <Th>Started</Th>
                  <Th>Status</Th>
                  <Th>Trigger</Th>
                  <Th>Size</Th>
                  <Th>Duration</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className={r.prunedAt ? "opacity-60" : ""}
                    style={{ borderTop: "1px solid var(--dpf-border)" }}
                  >
                    <Td>{formatTimestamp(r.startedAt)}</Td>
                    <Td>
                      <StatusPill status={r.status} />
                    </Td>
                    <Td className="text-[var(--dpf-muted)]">{r.trigger}</Td>
                    <Td>{formatBytes(r.sizeBytes)}</Td>
                    <Td>{formatDurationMs(r.durationMs)}</Td>
                    <Td className="text-right">
                      <button
                        onClick={() => handleOpenLog(r.id)}
                        disabled={loadingLog}
                        className="text-[var(--dpf-accent)] hover:underline disabled:opacity-50"
                      >
                        View log
                      </button>
                      {r.prunedAt && (
                        <span
                          className="ml-2 text-[10px]"
                          style={{ color: "var(--dpf-muted)" }}
                        >
                          pruned
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Log drawer ─────────────────────────────────────────────────── */}
      {openLog && (
        <div
          className="fixed inset-0 z-40 flex justify-end"
          onClick={() => setOpenLog(null)}
          style={{ background: "rgba(0, 0, 0, 0.5)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="h-full w-[480px] overflow-y-auto p-6"
            style={{
              background: "var(--dpf-surface)",
              borderLeft: "1px solid var(--dpf-border)",
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
                Backup run {openLog.runId.slice(0, 8)}
              </h3>
              <button
                onClick={() => setOpenLog(null)}
                className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              >
                Close
              </button>
            </div>

            {openLog.data.notFound ? (
              <p className="text-xs text-[var(--dpf-muted)]">Run not found.</p>
            ) : (
              <>
                <h4 className="text-xs uppercase text-[var(--dpf-muted)] mb-1">
                  Manifest
                </h4>
                <pre
                  className="text-[11px] p-3 rounded overflow-x-auto whitespace-pre-wrap"
                  style={{
                    background: "var(--dpf-bg)",
                    border: "1px solid var(--dpf-border)",
                    color: "var(--dpf-text)",
                  }}
                >
                  {openLog.data.manifest
                    ? JSON.stringify(openLog.data.manifest, null, 2)
                    : "(manifest unavailable — backup may have failed before completion)"}
                </pre>

                <h4 className="text-xs uppercase text-[var(--dpf-muted)] mt-4 mb-1">
                  Log (tail)
                </h4>
                <pre
                  className="text-[11px] p-3 rounded overflow-x-auto whitespace-pre-wrap"
                  style={{
                    background: "var(--dpf-bg)",
                    border: "1px solid var(--dpf-border)",
                    color: "var(--dpf-text)",
                  }}
                >
                  {openLog.data.logTail ?? "(log empty)"}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadinessRow({
  label,
  value,
  statusBadge,
}: {
  label: string;
  value: string;
  statusBadge?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span
        className="text-xs uppercase font-medium w-40"
        style={{ color: "var(--dpf-muted)" }}
      >
        {label}
      </span>
      <span className="flex-1 text-[var(--dpf-text)]">{value}</span>
      {statusBadge}
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`text-left px-3 py-2 text-[10px] uppercase font-medium ${className ?? ""}`}
      style={{ color: "var(--dpf-muted)" }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2 ${className ?? ""}`}
      style={{ color: "var(--dpf-text)" }}
    >
      {children}
    </td>
  );
}
