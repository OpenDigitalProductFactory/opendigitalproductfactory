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
        <tr style={{ color: "#8888a0", textAlign: "left" }}>
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
          <tr key={job.jobId} style={{ borderTop: "1px solid #2a2a40", color: "#e0e0ff" }}>
            <td style={{ padding: "6px 8px" }}>{job.name}</td>
            <td style={{ padding: "6px 8px" }}>
              {canWrite ? (
                <select
                  value={job.schedule}
                  disabled={isPending}
                  onChange={(e) => handleScheduleChange(job.jobId, e.target.value)}
                  style={{ background: "#1a1a2e", border: "1px solid #2a2a40", color: "#7c8cf8", fontSize: 10, padding: "1px 4px", borderRadius: 3 }}
                >
                  {SCHEDULES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <span style={{ color: "#7c8cf8" }}>{job.schedule}</span>
              )}
            </td>
            <td style={{ padding: "6px 8px", color: "#8888a0" }}>{formatDate(job.lastRunAt)}</td>
            <td style={{ padding: "6px 8px", color: "#8888a0" }}>{formatDate(job.nextRunAt)}</td>
            <td style={{ padding: "6px 8px" }}>
              {job.lastStatus === "ok"    && <span style={{ color: "#4ade80" }}>✓ ok</span>}
              {job.lastStatus === "error" && <span style={{ color: "#f87171" }}>✗ error</span>}
              {!job.lastStatus            && <span style={{ color: "#8888a0" }}>—</span>}
            </td>
            <td style={{ padding: "6px 8px", textAlign: "right" }}>
              {canWrite && (
                <button
                  onClick={() => handleRunNow(job.jobId)}
                  disabled={isPending}
                  style={{ color: "#7c8cf8", background: "none", border: "none", fontSize: 10, cursor: "pointer" }}
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
