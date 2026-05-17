import { AdminTabNav } from "@/components/admin/AdminTabNav";

import {
  getBackupReadinessAction,
  listBackupRunsAction,
} from "@/lib/actions/backups";

import { BackupsClient } from "./BackupsClient";

export const dynamic = "force-dynamic";

/**
 * Admin → Advanced → Backups.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.8
 *
 * Renders the readiness card + history table + manual-trigger button. The
 * operator never sees a CLI here — clicks only — per the
 * never-ask-user-to-run-commands kernel commandment.
 */
export default async function BackupsAdminPage() {
  const [readiness, runs] = await Promise.all([
    getBackupReadinessAction(),
    listBackupRunsAction({ limit: 50 }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Backups</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Platform-managed Postgres backups. Daily schedule, automatic
          retention, manual trigger.
        </p>
      </div>

      <AdminTabNav />

      <BackupsClient initialReadiness={readiness} initialRuns={runs} />
    </div>
  );
}
