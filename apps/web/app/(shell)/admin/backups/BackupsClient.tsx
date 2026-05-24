"use client";

import { useState, useTransition, type ReactElement } from "react";

import {
  getAllBackupReadinessAction,
  listBackupRunsAction,
  readBackupRunLogAction,
  triggerBackupNowAction,
  triggerTrialRestoreNowAction,
  type BackupRunListItem,
  type BackupRunLog,
} from "@/lib/actions/backups";
import {
  listRestoreRunsAction,
  previewRestoreAction,
} from "@/lib/actions/backup-restore";
import type { BackupTarget, ReadinessSummary } from "@/lib/operate/backups/types";
import type {
  RestoreImpactPreview,
  RestoreRunListItem,
} from "@/lib/operate/backups/restore-types";

import { RestoreConfirmModal } from "./RestoreConfirmModal";
import { RestoreHistorySection } from "./RestoreHistorySection";

interface AllReadiness {
  postgres: ReadinessSummary;
  neo4j: ReadinessSummary;
  qdrant: ReadinessSummary;
}

interface Props {
  initialReadiness: AllReadiness;
  initialPgRuns: BackupRunListItem[];
  initialNeo4jRuns: BackupRunListItem[];
  initialQdrantRuns: BackupRunListItem[];
  initialRestoreRuns: RestoreRunListItem[];
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

// BI-A8C149C1: age formatters + color-coded pills for the backup-health card.

function formatAgeFromNow(s: string | null): string {
  if (!s) return "never";
  const ageMs = Date.now() - new Date(s).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < 1) return `${Math.round(ageMs / (1000 * 60))} min`;
  if (ageHours < 24) return `${ageHours.toFixed(1)} h`;
  return `${(ageHours / 24).toFixed(1)} d`;
}

function renderAgePill(finishedAt: string | null): ReactElement | null {
  if (!finishedAt) {
    return <StatusPill status="failed" />;  // never = red
  }
  const ageHours = (Date.now() - new Date(finishedAt).getTime()) / (1000 * 60 * 60);
  // Spec from BI: green if <26h (one nightly window + 2h slack), yellow 26-48h,
  // red >48h. Reuse StatusPill colors: ok=green, running=yellow-ish (we'd
  // rather have a true yellow but the existing pill set is small), failed=red.
  if (ageHours < 26) return <StatusPill status="ok" />;
  if (ageHours < 48) return <StatusPill status="running" />;
  return <StatusPill status="failed" />;
}

function renderSha256Pill(sha256: string | null): ReactElement | null {
  // The dump's sha256 was recorded by scripts/backup-postgres.sh AT dump time
  // and verified by the BackupRun row. Presence = pass; absence = never ran or
  // the runner is older than the sha256 feature. The full verification path
  // (sha256-of-on-disk-file == recorded-sha256) runs inside the existing
  // restore wizard's integrity check.
  if (!sha256) return <StatusPill status="failed" />;  // never = red
  return <StatusPill status="ok" />;
}

function renderTrialRestoreSummary(
  tr: { lastStatus: "ok" | "failed"; lastStartedAt: string; lastError: string | null } | null,
): string {
  if (!tr) return "never (no trial restore yet)";
  const when = formatTimestamp(tr.lastStartedAt);
  if (tr.lastStatus === "ok") {
    return `last passed ${when} · age ${formatAgeFromNow(tr.lastStartedAt)}`;
  }
  return `last FAILED ${when}${tr.lastError ? ` — ${tr.lastError.slice(0, 120)}` : ""}`;
}

function renderTrialRestorePill(
  tr: { lastStatus: "ok" | "failed"; lastStartedAt: string } | null,
): ReactElement | null {
  if (!tr) return <StatusPill status="failed" />;  // never run = red
  if (tr.lastStatus === "failed") return <StatusPill status="failed" />;
  // Apply the same age-based color-coding as the "Last success" row.
  return renderAgePill(tr.lastStartedAt);
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

const TARGET_LABELS: Record<BackupTarget, string> = {
  postgres: "Postgres",
  neo4j: "Neo4j",
  qdrant: "Qdrant",
};

const TARGET_DESCRIPTIONS: Record<BackupTarget, string> = {
  postgres: "Full database dump (pg_dump -Fc). All operator state, backlog, config.",
  neo4j: "Offline dump (neo4j-admin). Wiki link graph, routing data, EA model topology. Requires ~10 s Neo4j restart.",
  qdrant: "Full-instance snapshot (REST API). Vector embeddings, semantic memory, brand context. No service interruption.",
};

export function BackupsClient({
  initialReadiness,
  initialPgRuns,
  initialNeo4jRuns,
  initialQdrantRuns,
  initialRestoreRuns,
}: Props) {
  const [readiness, setReadiness] = useState<AllReadiness>(initialReadiness);
  const [runsByTarget, setRunsByTarget] = useState<Record<BackupTarget, BackupRunListItem[]>>({
    postgres: initialPgRuns,
    neo4j: initialNeo4jRuns,
    qdrant: initialQdrantRuns,
  });
  const [restoreRuns, setRestoreRuns] = useState(initialRestoreRuns);
  const [pendingTarget, setPendingTarget] = useState<BackupTarget | null>(null);
  const [isVerifyPending, setIsVerifyPending] = useState(false);
  const [, startTransition] = useTransition();
  const [openLog, setOpenLog] = useState<{ runId: string; data: BackupRunLog } | null>(null);
  const [loadingLog, setLoadingLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestoreImpactPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);

  async function refresh() {
    const [next, pgRuns, neo4jRuns, qdrantRuns, restores] = await Promise.all([
      getAllBackupReadinessAction(),
      listBackupRunsAction({ limit: 50, target: "postgres" }),
      listBackupRunsAction({ limit: 50, target: "neo4j" }),
      listBackupRunsAction({ limit: 50, target: "qdrant" }),
      listRestoreRunsAction({ limit: 20 }),
    ]);
    setReadiness(next);
    setRunsByTarget({ postgres: pgRuns, neo4j: neo4jRuns, qdrant: qdrantRuns });
    setRestoreRuns(restores);
  }

  async function handleOpenRestore(runId: string) {
    setError(null);
    setLoadingPreview(runId);
    try {
      const preview = await previewRestoreAction(runId);
      setRestorePreview(preview);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingPreview(null);
    }
  }

  function handleRestoreConfirmed() {
    setRestorePreview(null);
    refresh().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }

  function handleTrigger(target: BackupTarget) {
    setError(null);
    setPendingTarget(target);
    startTransition(async () => {
      const result = await triggerBackupNowAction(target);
      setPendingTarget(null);
      if (!result.ok) {
        setError(result.error ?? "Backup request failed.");
        return;
      }
      setTimeout(() => {
        refresh().catch((e: unknown) =>
          setError(e instanceof Error ? e.message : String(e)),
        );
      }, 1500);
    });
  }

  // BI-A8C149C1: "Verify last backup" button — fires the postgres trial-restore
  // manual-trigger event. The trial restore creates a temp DB, pg_restores the
  // latest dump, asserts row counts, drops the temp DB. Never touches production.
  function handleVerifyLastBackup() {
    setError(null);
    setIsVerifyPending(true);
    startTransition(async () => {
      const result = await triggerTrialRestoreNowAction("postgres");
      setIsVerifyPending(false);
      if (!result.ok) {
        setError(result.error ?? "Trial restore request failed.");
        return;
      }
      // Trial restore typically completes in ~10s on a small DB; give it 5s
      // before refreshing so the BackupRestore row is likely visible.
      setTimeout(() => {
        refresh().catch((e: unknown) =>
          setError(e instanceof Error ? e.message : String(e)),
        );
      }, 5000);
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

  const targets: BackupTarget[] = ["postgres", "neo4j", "qdrant"];

  return (
    <div className="max-w-4xl space-y-10">
      {error && (
        <div
          className="p-3 rounded text-sm"
          style={{
            background: "rgba(248, 113, 113, 0.15)",
            color: "#f87171",
            border: "1px solid rgba(248, 113, 113, 0.3)",
          }}
        >
          {error}
        </div>
      )}

      {targets.map((target) => {
        const r = readiness[target];
        const runs = runsByTarget[target];
        const j = r.scheduledJob;
        const lastRun = r.lastRun;
        const overdue = r.failuresInLastThreeRuns >= 2;
        const isPending = pendingTarget === target;

        return (
          <div key={target}>
            {/* ─── Section header ──────────────────────────────────────── */}
            <div className="flex items-center justify-between mb-1">
              <div>
                <h2 className="text-base font-semibold text-[var(--dpf-text)]">
                  {TARGET_LABELS[target]}
                </h2>
                <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
                  {TARGET_DESCRIPTIONS[target]}
                </p>
                {target === "neo4j" && (
                  <p
                    className="text-xs mt-1 font-medium"
                    style={{ color: "#fbbf24" }}
                  >
                    Manual trigger stops the Neo4j container for ~10 s.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                {target === "postgres" && (
                  <button
                    onClick={() => handleVerifyLastBackup()}
                    disabled={isVerifyPending || pendingTarget !== null}
                    className="px-3 py-2 text-sm font-medium rounded transition-colors"
                    style={{
                      background: isVerifyPending
                        ? "var(--dpf-border)"
                        : "transparent",
                      color: isVerifyPending
                        ? "var(--dpf-muted)"
                        : "var(--dpf-text)",
                      border: "1px solid var(--dpf-border)",
                      cursor: isVerifyPending ? "not-allowed" : "pointer",
                    }}
                    title="Run a trial restore against the latest postgres dump, into a temp DB. Proves the dump is functionally restorable. Asserts row counts on critical tables."
                  >
                    {isVerifyPending ? "Verifying…" : "Verify last backup"}
                  </button>
                )}
                <button
                  onClick={() => handleTrigger(target)}
                  disabled={isPending || pendingTarget !== null}
                  className="px-4 py-2 text-sm font-medium rounded transition-colors"
                  style={{
                    background:
                      isPending || pendingTarget !== null
                        ? "var(--dpf-border)"
                        : "var(--dpf-accent)",
                    color:
                      isPending || pendingTarget !== null
                        ? "var(--dpf-muted)"
                        : "#fff",
                    cursor:
                      isPending || pendingTarget !== null ? "not-allowed" : "pointer",
                  }}
                >
                  {isPending
                    ? "Triggering…"
                    : `Run ${TARGET_LABELS[target]} backup now`}
                </button>
              </div>
            </div>

            {/* ─── Readiness card ──────────────────────────────────────── */}
            <div
              className="rounded p-4 grid gap-3 text-sm mb-3"
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
                label="Last success"
                value={
                  r.lastSuccess
                    ? `${formatTimestamp(r.lastSuccess.finishedAt)} · ${formatBytes(
                        r.lastSuccess.sizeBytes,
                      )} · age ${formatAgeFromNow(r.lastSuccess.finishedAt)}`
                    : "never"
                }
                statusBadge={renderAgePill(r.lastSuccess?.finishedAt ?? null)}
              />
              <ReadinessRow
                label="sha256 verification"
                value={
                  r.lastSuccess?.sha256
                    ? `${r.lastSuccess.sha256.substring(0, 12)}… (recorded at dump time)`
                    : "never recorded"
                }
                statusBadge={renderSha256Pill(r.lastSuccess?.sha256 ?? null)}
              />
              <ReadinessRow
                label="Trial restore"
                value={renderTrialRestoreSummary(r.trialRestore)}
                statusBadge={renderTrialRestorePill(r.trialRestore)}
              />
              <ReadinessRow
                label="Next run"
                value={j?.nextRunAt ? formatTimestamp(j.nextRunAt) : "—"}
              />
              <ReadinessRow
                label="Retention"
                value={`${r.retention.daily} daily · ${r.retention.weekly} weekly · ${r.retention.monthly} monthly`}
              />
              <ReadinessRow
                label="Retained on disk"
                value={`${r.retainedCount} backup${r.retainedCount === 1 ? "" : "s"} · ${formatBytes(r.retainedBytes)}`}
              />
              <ReadinessRow label="Storage path" value={r.storagePath} />
            </div>

            {overdue && (
              <div
                className="mb-3 p-3 rounded text-sm"
                style={{
                  background: "rgba(248, 113, 113, 0.15)",
                  color: "#f87171",
                  border: "1px solid rgba(248, 113, 113, 0.3)",
                }}
              >
                Multiple recent {TARGET_LABELS[target]} backups have failed.
                Investigate the latest run log for details.
              </div>
            )}

            {/* ─── History table ───────────────────────────────────────── */}
            {runs.length === 0 ? (
              <p className="text-xs text-[var(--dpf-muted)]">
                No {TARGET_LABELS[target]} backups yet — click the trigger
                button above to create one immediately.
              </p>
            ) : (
              <div
                className="rounded overflow-hidden"
                style={{ border: "1px solid var(--dpf-border)" }}
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
                    {runs.map((row) => (
                      <tr
                        key={row.id}
                        className={row.prunedAt ? "opacity-60" : ""}
                        style={{ borderTop: "1px solid var(--dpf-border)" }}
                      >
                        <Td>{formatTimestamp(row.startedAt)}</Td>
                        <Td>
                          <StatusPill status={row.status} />
                        </Td>
                        <Td className="text-[var(--dpf-muted)]">{row.trigger}</Td>
                        <Td>{formatBytes(row.sizeBytes)}</Td>
                        <Td>{formatDurationMs(row.durationMs)}</Td>
                        <Td className="text-right">
                          {row.status === "ok" && !row.prunedAt && (
                            <button
                              onClick={() => handleOpenRestore(row.id)}
                              disabled={loadingPreview !== null}
                              className="mr-3 hover:underline disabled:opacity-50"
                              style={{ color: "#f87171" }}
                              title={`Restore ${TARGET_LABELS[target]} from this backup`}
                            >
                              {loadingPreview === row.id ? "Loading…" : "Restore…"}
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenLog(row.id)}
                            disabled={loadingLog}
                            className="text-[var(--dpf-accent)] hover:underline disabled:opacity-50"
                          >
                            View log
                          </button>
                          {row.prunedAt && (
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
          </div>
        );
      })}

      {/* ─── Restore history (Slice 2) ────────────────────────────────────── */}
      <RestoreHistorySection runs={restoreRuns} />

      {/* ─── Restore wizard modal (Slice 2, Postgres only) ───────────────── */}
      {restorePreview && (
        <RestoreConfirmModal
          preview={restorePreview}
          onClose={() => setRestorePreview(null)}
          onConfirmed={handleRestoreConfirmed}
        />
      )}

      {/* ─── Log drawer ──────────────────────────────────────────────────── */}
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
