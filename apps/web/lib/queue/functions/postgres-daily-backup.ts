/**
 * Inngest functions for the platform-managed Postgres backup mechanism.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.2
 * Plan: docs/superpowers/plans/2026-05-17-postgres-daily-backup-slice-1.md
 *
 * Two surfaces, one runner:
 *   - postgresDailyBackupScheduled: cron at 03:00 UTC daily, trigger="scheduled".
 *   - postgresBackupRequested: event-driven from the admin "Run backup now"
 *                              button, trigger="manual".
 *
 * Both call the same `runPostgresBackup` to keep behavior identical.
 * `concurrency: { limit: 1, scope: "fn" }` per function ensures the cron
 * fire and a near-simultaneous manual click serialize rather than collide.
 */
import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { POSTGRES_BACKUP_CRON, POSTGRES_BACKUP_EVENT } from "@/lib/operate/backups/constants";

export const postgresDailyBackupScheduled = inngest.createFunction(
  {
    id: "ops/postgres-daily-backup-scheduled",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(POSTGRES_BACKUP_CRON)],
  },
  async ({ step }) => {
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
