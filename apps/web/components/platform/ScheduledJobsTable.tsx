"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateScheduledJob, runScheduledJobNow } from "@/lib/actions/ai-providers";
import type { ScheduledJobRow } from "@/lib/ai-provider-types";

type Props = { jobs: ScheduledJobRow[]; canWrite: boolean };

const SCHEDULES = ["daily", "weekly", "monthly", "disabled"] as const;

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ScheduledJobsTable({ jobs, canWrite }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleScheduleChange(jobId: string, schedule: string) {
    startTransition(async () => {
      await updateScheduledJob({ jobId, schedule });
      router.refresh();
    });
  }

  function handleRunNow(jobId: string) {
    startTransition(async () => {
      await runScheduledJobNow(jobId);
      router.refresh();
    });
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
      <thead>
        <tr style={{ color: "var(--dpf-muted)", textAlign: "left" }}>
          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Job</th>
          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Schedule</th>
          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Last run</th>
          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Next run</th>
          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Status</th>
          <th style={{ padding: "4px 8px", fontWeight: 500 }} />
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.jobId} style={{ borderTop: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}>
            <td style={{ padding: "6px 8px" }}>{job.name}</td>
            <td style={{ padding: "6px 8px" }}>
              {canWrite ? (
                <select
                  value={job.schedule}
                  disabled={isPending}
                  onChange={(e) => handleScheduleChange(job.jobId, e.target.value)}
                  style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", color: "var(--dpf-accent)", fontSize: 10, padding: "1px 4px", borderRadius: 3 }}
                >
                  {SCHEDULES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <span style={{ color: "var(--dpf-accent)" }}>{job.schedule}</span>
              )}
            </td>
            <td style={{ padding: "6px 8px", color: "var(--dpf-muted)" }}>{formatDate(job.lastRunAt)}</td>
            <td style={{ padding: "6px 8px", color: "var(--dpf-muted)" }}>{formatDate(job.nextRunAt)}</td>
            <td style={{ padding: "6px 8px" }}>
              {job.lastStatus === "ok"    && <span style={{ color: "var(--dpf-success)" }}>✓ ok</span>}
              {job.lastStatus === "error" && <span style={{ color: "var(--dpf-error)" }}>✗ error</span>}
              {!job.lastStatus            && <span style={{ color: "var(--dpf-muted)" }}>—</span>}
            </td>
            <td style={{ padding: "6px 8px", textAlign: "right" }}>
              {canWrite && (
                <button
                  onClick={() => handleRunNow(job.jobId)}
                  disabled={isPending}
                  style={{ color: "var(--dpf-accent)", background: "none", border: "none", fontSize: 10, cursor: "pointer" }}
                >
                  Run now
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
