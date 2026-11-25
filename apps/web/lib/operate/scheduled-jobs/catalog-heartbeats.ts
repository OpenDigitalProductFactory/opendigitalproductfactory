import { UPLOADS_BACKUP_JOB_ID, UPLOADS_BACKUP_SCHEDULE } from "@/lib/operate/backups/constants";

interface ScheduledJobHeartbeat {
  jobId: string;
  parentJobId: string;
  name: string;
  purpose: string;
  /** Parent cadence for display/health only. This row never schedules work. */
  schedule: string;
  cadence: string;
}

/** Registered run history for steps that have no standalone Inngest job. */
export const SCHEDULED_JOB_HEARTBEATS: readonly ScheduledJobHeartbeat[] = [
  {
    jobId: UPLOADS_BACKUP_JOB_ID,
    parentJobId: "all-backups-daily",
    name: "Uploads backup",
    purpose: "Records the uploads step after a successful Postgres backup. It has no independent schedule or controls.",
    schedule: UPLOADS_BACKUP_SCHEDULE,
    cadence: "After the daily Postgres backup",
  },
];

export function getScheduledJobHeartbeat(jobId: string): ScheduledJobHeartbeat | undefined {
  return SCHEDULED_JOB_HEARTBEATS.find((entry) => entry.jobId === jobId);
}
