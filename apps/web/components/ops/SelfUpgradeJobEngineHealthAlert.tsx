"use client";

import { LocalTime } from "@/components/ui/LocalTime";

export type JobEngineHealth = {
  status: "healthy" | "degraded" | "unknown";
  detail: string | null;
  checkedAt: string | null;
  watchdog?: {
    status: "healthy" | "degraded" | "unknown";
    detail: string | null;
    lastInvocationAt: string | null;
    lastGatewayHitAt: string | null;
    lastRecoveryAttemptAt: string | null;
    lastRecoverySummary: string | null;
  } | null;
};

export function shouldPollForJobEngineRecovery(jobEngine: JobEngineHealth | undefined): boolean {
  return jobEngine?.status === "degraded";
}

type Props = {
  jobEngine: JobEngineHealth | undefined;
};

export default function SelfUpgradeJobEngineHealthAlert({ jobEngine }: Props) {
  if (jobEngine?.status !== "degraded") return null;

  return (
    <div
      className="p-3 rounded-lg bg-[var(--dpf-warning)]/15 border border-[var(--dpf-warning)]/40 text-sm"
      role="alert"
      data-job-engine-health="degraded"
    >
      <div className="font-medium text-[var(--dpf-warning)]">Background jobs need attention</div>
      <div className="mt-1 text-[var(--dpf-muted)]">
        Self-upgrade, evals, backups, and watchdogs depend on Inngest. The portal
        retries Inngest registration automatically every 5 minutes and this page
        checks for recovery while the alert is visible.
      </div>
      <dl className="mt-2 grid gap-1 text-xs text-[var(--dpf-muted)] sm:grid-cols-2">
        <div>
          <dt className="font-medium text-[var(--dpf-text)]">Last check</dt>
          <dd>
            <LocalTime value={jobEngine.checkedAt} mode="time" fallback="not recorded yet" />
          </dd>
        </div>
        <div>
          <dt className="font-medium text-[var(--dpf-text)]">Current signal</dt>
          <dd>{jobEngine.detail ?? "Inngest registration is degraded."}</dd>
        </div>
        {jobEngine.watchdog?.lastRecoveryAttemptAt && (
          <div className="sm:col-span-2">
            <dt className="font-medium text-[var(--dpf-text)]">Last recovery attempt</dt>
            <dd>
              <LocalTime
                value={jobEngine.watchdog.lastRecoveryAttemptAt}
                mode="time"
                fallback="not recorded yet"
              />
              {jobEngine.watchdog.lastRecoverySummary ? ` - ${jobEngine.watchdog.lastRecoverySummary}` : ""}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
