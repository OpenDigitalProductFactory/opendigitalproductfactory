/**
 * Inngest functions for the platform-managed backup mechanism.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.2
 * Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md §3.5
 * Plan: docs/superpowers/plans/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md Chunk 3
 *
 * Slice 3 extends this module with Neo4j + Qdrant runners. The combined daily
 * cron fires at 03:00 UTC and runs all three services in sequence. Each service
 * has its own independent manual-trigger event so the admin "Run backup now"
 * buttons work independently.
 *
 * Failure of one service does NOT abort the others — each runner catches its
 * own errors and writes its own BackupRun row.
 *
 * `concurrency: { limit: 1, scope: "fn" }` per function prevents overlapping
 * runs of the same function (cron vs. manual).
 */
import { cron } from "inngest";
import { inngest } from "../inngest-client";
import {
  ALL_BACKUPS_CRON,
  NEO4J_BACKUP_EVENT,
  POSTGRES_BACKUP_CRON,
  POSTGRES_BACKUP_EVENT,
  QDRANT_BACKUP_EVENT,
} from "@/lib/operate/backups/constants";

// ─── Daily cron (all three services) ─────────────────────────────────────────

export const allBackupsDailyScheduled = inngest.createFunction(
  {
    id: "ops/all-backups-daily-scheduled",
    retries: 0, // each sub-runner has its own retry / error handling
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(ALL_BACKUPS_CRON)],
  },
  async ({ step }) => {
    // Postgres first — most critical, longest-running.
    const pgResult = await step.run("run-postgres-backup-scheduled", async () => {
      const { runPostgresBackup } = await import(
        "@/lib/operate/backups/postgres-backup-runner"
      );
      return runPostgresBackup({ trigger: "scheduled" });
    });

    // Neo4j: independent. Runs even if Postgres failed.
    const neo4jResult = await step.run("run-neo4j-backup-scheduled", async () => {
      const { runNeo4jBackup } = await import(
        "@/lib/operate/backups/neo4j-backup-runner"
      );
      return runNeo4jBackup({ trigger: "scheduled" });
    });

    // Qdrant: independent. Runs even if the others failed.
    const qdrantResult = await step.run("run-qdrant-backup-scheduled", async () => {
      const { runQdrantBackup } = await import(
        "@/lib/operate/backups/qdrant-backup-runner"
      );
      return runQdrantBackup({ trigger: "scheduled" });
    });

    return { pgResult, neo4jResult, qdrantResult };
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

// ─── Neo4j — manual trigger ───────────────────────────────────────────────────

export const neo4jBackupRequested = inngest.createFunction(
  {
    id: "ops/neo4j-backup-requested",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: NEO4J_BACKUP_EVENT }],
  },
  async ({ step }) => {
    return step.run("run-neo4j-backup-manual", async () => {
      const { runNeo4jBackup } = await import(
        "@/lib/operate/backups/neo4j-backup-runner"
      );
      return runNeo4jBackup({ trigger: "manual" });
    });
  },
);

// ─── Qdrant — manual trigger ──────────────────────────────────────────────────

export const qdrantBackupRequested = inngest.createFunction(
  {
    id: "ops/qdrant-backup-requested",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: QDRANT_BACKUP_EVENT }],
  },
  async ({ step }) => {
    return step.run("run-qdrant-backup-manual", async () => {
      const { runQdrantBackup } = await import(
        "@/lib/operate/backups/qdrant-backup-runner"
      );
      return runQdrantBackup({ trigger: "manual" });
    });
  },
);
