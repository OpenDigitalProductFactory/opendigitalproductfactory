"use client";

// BI-5A42E572 / EP-PROACTIVE-OPS — Scheduled Jobs admin surface (client).

import { useState, useTransition } from "react";

import {
  listScheduledJobsAction,
  updateJobScheduleAction,
  setJobEnabledAction,
  runJobNowAction,
} from "@/lib/actions/scheduled-jobs";
import type { ScheduledJobView } from "@/lib/operate/scheduled-jobs/core";
import { getErrorMessage } from "@/lib/shared/get-error-message";

// Mirror of EDITABLE_SCHEDULE_OPTIONS — the server (core.ts) is the source of
// truth and re-validates; this list only drives the dropdown UX.
const SCHEDULE_OPTIONS: { value: string; label: string }[] = [
  { value: "every-1m", label: "Every minute" },
  { value: "every-5m", label: "Every 5 minutes" },
  { value: "every-15m", label: "Every 15 minutes" },
  { value: "every-30m", label: "Every 30 minutes" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "disabled", label: "Disabled" },
];

type Banner = { kind: "ok" | "error"; text: string } | null;

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relative(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return diffMs >= 0 ? "just now" : "in <1m";
  if (mins < 60) return diffMs >= 0 ? `${mins}m ago` : `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return diffMs >= 0 ? `${hrs}h ago` : `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return diffMs >= 0 ? `${days}d ago` : `in ${days}d`;
}

const HEALTH_PILL: Record<string, { bg: string; color: string; label: string }> = {
  ok: { bg: "rgba(74, 222, 128, 0.15)", color: "#4ade80", label: "OK" },
  error: { bg: "rgba(248, 113, 113, 0.15)", color: "#f87171", label: "ERROR" },
  never: { bg: "rgba(148, 163, 184, 0.15)", color: "#94a3b8", label: "NEVER RUN" },
};

function HealthPill({ health }: { health: string }) {
  const s = HEALTH_PILL[health] ?? HEALTH_PILL.never;
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function CategoryBadge({ category }: { category: "core" | "editable" }) {
  const core = category === "core";
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1"
      style={{
        background: core ? "rgba(251, 191, 36, 0.15)" : "rgba(99, 102, 241, 0.15)",
        color: core ? "#fbbf24" : "#818cf8",
      }}
    >
      {core ? "🔒 CORE-LOCKED" : "EDITABLE"}
    </span>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left px-3 py-2 text-[10px] uppercase font-medium ${className ?? ""}`}
      style={{ color: "var(--dpf-muted)" }}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 align-top ${className ?? ""}`} style={{ color: "var(--dpf-text)" }}>
      {children}
    </td>
  );
}

export function ScheduledJobsClient({ initialJobs }: { initialJobs: ScheduledJobView[] }) {
  const [jobs, setJobs] = useState<ScheduledJobView[]>(initialJobs);
  const [banner, setBanner] = useState<Banner>(null);
  const [pendingJob, setPendingJob] = useState<string | null>(null);
  const [editJob, setEditJob] = useState<ScheduledJobView | null>(null);
  const [editSchedule, setEditSchedule] = useState<string>("hourly");
  const [, startTransition] = useTransition();

  async function refresh() {
    const fresh = await listScheduledJobsAction();
    setJobs(fresh);
  }

  function run(jobId: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setPendingJob(jobId);
    setBanner(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          setBanner({ kind: "ok", text: res.message ?? "Done." });
          await refresh();
        } else {
          setBanner({ kind: "error", text: res.error ?? "Failed." });
        }
      } catch (err) {
        setBanner({ kind: "error", text: getErrorMessage(err) });
      } finally {
        setPendingJob(null);
      }
    });
  }

  function openEdit(job: ScheduledJobView) {
    setEditJob(job);
    setEditSchedule(
      SCHEDULE_OPTIONS.some((o) => o.value === job.schedule) ? job.schedule : "hourly",
    );
  }

  const coreCount = jobs.filter((j) => j.category === "core").length;
  const editableCount = jobs.length - coreCount;
  const unhealthy = jobs.filter((j) => j.health === "error").length;

  return (
    <div className="mt-6">
      {/* Summary */}
      <div className="flex gap-4 mb-4 text-xs" style={{ color: "var(--dpf-muted)" }}>
        <span>{jobs.length} jobs</span>
        <span>· {coreCount} core-locked</span>
        <span>· {editableCount} editable</span>
        {unhealthy > 0 && (
          <span style={{ color: "#f87171" }}>· {unhealthy} reporting errors</span>
        )}
      </div>

      {banner && (
        <div
          className="mb-4 px-3 py-2 rounded text-sm"
          style={{
            background: banner.kind === "ok" ? "rgba(74, 222, 128, 0.12)" : "rgba(248, 113, 113, 0.12)",
            color: banner.kind === "ok" ? "#4ade80" : "#f87171",
            border: `1px solid ${banner.kind === "ok" ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`,
          }}
        >
          {banner.text}
        </div>
      )}

      <div style={{ border: "1px solid var(--dpf-border)" }} className="rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead style={{ background: "var(--dpf-bg)" }}>
            <tr>
              <Th>Job</Th>
              <Th>Classification</Th>
              <Th>Schedule</Th>
              <Th>Last run</Th>
              <Th>Next run</Th>
              <Th>Health</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const busy = pendingJob === job.jobId;
              return (
                <tr key={job.jobId} style={{ borderTop: "1px solid var(--dpf-border)" }}>
                  <Td>
                    <div className="font-medium flex items-center gap-2">
                      {job.name}
                      {!job.enabled && (
                        <span className="text-[10px] font-bold" style={{ color: "#f87171" }}>
                          DISABLED
                        </span>
                      )}
                    </div>
                    <div hidden>
                      {job.purpose} {job.jobId}
                      {job.inngestId ? ` ${job.inngestId}` : ""}
                    </div>
                  </Td>
                  <Td>
                    <CategoryBadge category={job.category} />
                  </Td>
                  <Td>
                    <div>{job.cadence}</div>
                    {job.inCatalog && job.scheduleEditable && (
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--dpf-muted)" }}>
                        projection only — live cron is code-defined
                      </div>
                    )}
                  </Td>
                  <Td>
                    <div>{relative(job.lastRunAt)}</div>
                    <div className="text-[10px]" style={{ color: "var(--dpf-muted)" }}>
                      {formatTimestamp(job.lastRunAt)}
                    </div>
                    {job.lastError && (
                      <div className="text-[10px] mt-0.5" style={{ color: "#f87171" }}>
                        {job.lastError.slice(0, 80)}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <div>{relative(job.nextRunAt)}</div>
                    <div className="text-[10px]" style={{ color: "var(--dpf-muted)" }}>
                      {formatTimestamp(job.nextRunAt)}
                    </div>
                  </Td>
                  <Td>
                    <HealthPill health={job.health} />
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {job.locked ? (
                      <span className="text-[10px]" style={{ color: "var(--dpf-muted)" }}>
                        read-only
                      </span>
                    ) : (
                      <div className="inline-flex gap-2">
                        <button
                          onClick={() => openEdit(job)}
                          disabled={busy}
                          className="px-2 py-1 rounded"
                          style={{ border: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() =>
                            run(job.jobId, () => setJobEnabledAction(job.jobId, !job.enabled))
                          }
                          disabled={busy}
                          className="px-2 py-1 rounded"
                          style={{ border: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}
                        >
                          {job.enabled ? "Disable" : "Enable"}
                        </button>
                      </div>
                    )}
                    {job.hasRunNow && (
                      <button
                        onClick={() => run(job.jobId, () => runJobNowAction(job.jobId))}
                        disabled={busy}
                        className="px-2 py-1 rounded ml-2"
                        style={{ background: "var(--dpf-accent)", color: "#fff" }}
                      >
                        {busy ? "…" : "Run now"}
                      </button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit schedule modal */}
      {editJob && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setEditJob(null)}
          style={{ background: "rgba(0,0,0,0.6)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[480px] max-w-[95vw] rounded p-6"
            style={{ background: "var(--dpf-surface)", border: "1px solid var(--dpf-border)" }}
          >
            <h2 className="text-lg font-bold" style={{ color: "var(--dpf-text)" }}>
              Edit schedule — {editJob.name}
            </h2>
            <p className="text-xs mt-1" style={{ color: "var(--dpf-muted)" }}>
              Persists the cadence on the ScheduledJob row and recomputes the next
              run. For code-cron-backed jobs the live trigger cadence stays
              code-defined until data-driven execution lands.
            </p>
            <label className="block text-xs mt-4 mb-1" style={{ color: "var(--dpf-muted)" }}>
              Cadence
            </label>
            <select
              value={editSchedule}
              onChange={(e) => setEditSchedule(e.target.value)}
              className="w-full px-3 py-2 rounded text-sm"
              style={{
                background: "var(--dpf-bg)",
                color: "var(--dpf-text)",
                border: "1px solid var(--dpf-border)",
              }}
            >
              {SCHEDULE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setEditJob(null)}
                className="px-4 py-2 text-sm rounded"
                style={{ border: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const jobId = editJob.jobId;
                  const schedule = editSchedule;
                  setEditJob(null);
                  run(jobId, () => updateJobScheduleAction(jobId, schedule));
                }}
                className="px-4 py-2 text-sm rounded font-medium"
                style={{ background: "var(--dpf-accent)", color: "#fff" }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
