import { AdminTabNav } from "@/components/admin/AdminTabNav";

import {
  getAllBackupReadinessAction,
  listBackupRunsAction,
} from "@/lib/actions/backups";
import { listRestoreRunsAction } from "@/lib/actions/backup-restore";

import { BackupsClient } from "./BackupsClient";

export const dynamic = "force-dynamic";

/**
 * Admin → Advanced → Backups.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.8, §4.6
 * Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md §3.4
 *
 * Slice 3 extends the page with three stacked readiness sections — one per
 * backup target (Postgres, Neo4j, Qdrant). The operator never sees CLI here —
 * clicks only — per the never-ask-user-to-run-commands kernel commandment.
 */
export default async function BackupsAdminPage() {
  const [allReadiness, pgRuns, neo4jRuns, qdrantRuns, restoreRuns] =
    await Promise.all([
      getAllBackupReadinessAction(),
      listBackupRunsAction({ limit: 50, target: "postgres" }),
      listBackupRunsAction({ limit: 50, target: "neo4j" }),
      listBackupRunsAction({ limit: 50, target: "qdrant" }),
      listRestoreRunsAction({ limit: 20 }),
    ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Backups</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Platform-managed backups for Postgres, Neo4j, and Qdrant. Daily
          schedule, automatic retention, manual trigger, restore wizard.
        </p>
      </div>

      <AdminTabNav />

      <BackupsClient
        initialReadiness={allReadiness}
        initialPgRuns={pgRuns}
        initialNeo4jRuns={neo4jRuns}
        initialQdrantRuns={qdrantRuns}
        initialRestoreRuns={restoreRuns}
      />
    </div>
  );
}
