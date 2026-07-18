/**
 * Inngest functions for the platform-managed backup mechanism.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.2
 *
 * postgres-only after BET-5 retired the neo4j + qdrant stores. The daily cron
 * fires at 03:00 UTC, runs the Postgres backup, then verifies it via a
 * trial-restore. The manual-trigger event lets the admin "Run backup now"
 * button work on demand.
 *
 * `concurrency: { limit: 1, scope: "fn" }` per function prevents overlapping
 * runs of the same function (cron vs. manual).
 */
import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  ALL_BACKUPS_CRON,
  POSTGRES_BACKUP_CRON,
  POSTGRES_BACKUP_EVENT,
  POSTGRES_TRIAL_RESTORE_EVENT,
} from "@/lib/operate/backups/constants";
import type { OperationalCapabilityState } from "@/lib/platform-runtime/operational-state";

type BackupProjection = Pick<OperationalCapabilityState, "backupServices">;
export type CapabilityBackupReceipt = {
  target: string;
  status: "selected" | "optional_inactive";
};

/** Core Postgres remains first; capability-owned targets come only from the shared projection. */
export function selectCapabilityBackupServices(projection: BackupProjection): string[] {
  return ["postgres", ...projection.backupServices.filter((service) => service !== "postgres")];
}

export function capabilityBackupReceipt(target: string, projection: BackupProjection): CapabilityBackupReceipt {
  return projection.backupServices.includes(target)
    ? { target, status: "selected" }
    : { target, status: "optional_inactive" };
}

// ─── Daily cron (postgres backup + trial-restore) ────────────────────────────

export const allBackupsDailyScheduled = inngest.createFunction(
  {
    id: "ops/all-backups-daily-scheduled",
    retries: 0, // each sub-runner has its own retry / error handling
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(ALL_BACKUPS_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    const pgResult = await step.run("run-postgres-backup-scheduled", async () => {
      const { runPostgresBackup } = await import(
        "@/lib/operate/backups/postgres-backup-runner"
      );
      return runPostgresBackup({ trigger: "scheduled" });
    });

    // Postgres trial-restore verification (BI-31C9FBDF). Runs AFTER the
    // postgres backup completes — verifies the dump is functionally
    // restorable (catches truncated dumps + write-during-snapshot corruption
    // that sha256 alone cannot). Never touches production. Independent failure
    // handling inside the runner (it catches its own errors and writes a
    // BackupRestore row with trigger=trial-verification).
    const trialRestoreResult = await step.run(
      "run-postgres-trial-restore-scheduled",
      async () => {
        const { runPostgresTrialRestore } = await import(
          "@/lib/operate/backups/postgres-trial-restore-runner"
        );
        return runPostgresTrialRestore();
      },
    );

    return { pgResult, trialRestoreResult };
  },
);

// ─── Postgres trial-restore — manual trigger (BI-31C9FBDF) ────────────────────

export const postgresTrialRestoreRequested = inngest.createFunction(
  {
    id: "ops/postgres-trial-restore-requested",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: POSTGRES_TRIAL_RESTORE_EVENT }],
  },
  async ({ step }) => {
    return step.run("run-postgres-trial-restore-manual", async () => {
      const { runPostgresTrialRestore } = await import(
        "@/lib/operate/backups/postgres-trial-restore-runner"
      );
      return runPostgresTrialRestore();
    });
  },
);

// ─── Postgres — kept for backwards compat + independent manual trigger ────────

/** @deprecated Use allBackupsDailyScheduled for the daily cron path. Kept for backwards compat with existing event subscribers. */
export const postgresDailyBackupScheduled = inngest.createFunction(
  {
    id: "ops/postgres-daily-backup-scheduled",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(POSTGRES_BACKUP_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("run-postgres-backup-scheduled", async () => {
      const { runPostgresBackup } = await import(
        "@/lib/operate/backups/postgres-backup-runner"
      );
      return runPostgresBackup({ trigger: "scheduled" });
    });
  },
);

export const postgresBackupRequested = inngest.createFunction(
  {
    id: "ops/postgres-backup-requested",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: POSTGRES_BACKUP_EVENT }],
  },
  async ({ step }) => {
    return step.run("run-postgres-backup-manual", async () => {
      const { runPostgresBackup } = await import(
        "@/lib/operate/backups/postgres-backup-runner"
      );
      return runPostgresBackup({ trigger: "manual" });
    });
  },
);
