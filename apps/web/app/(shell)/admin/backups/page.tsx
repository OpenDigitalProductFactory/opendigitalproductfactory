import { namespaceMessages, translate } from "@dpf/i18n";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";

import {
  getAllBackupReadinessAction,
  listBackupRunsAction,
} from "@/lib/actions/backups";
import { listRestoreRunsAction } from "@/lib/actions/backup-restore";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";

import { BackupsClient } from "./BackupsClient";

export const dynamic = "force-dynamic";

/**
 * Admin → Advanced → Backups.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.8, §4.6
 *
 * Scheduled backups cover Postgres and uploads. Manual controls here are
 * Postgres-only.
 */
export default async function BackupsAdminPage() {
  const [allReadiness, pgRuns, restoreRuns, { language, formatLocale }] = await Promise.all([
    getAllBackupReadinessAction(),
    listBackupRunsAction({ limit: 50, target: "postgres" }),
    listRestoreRunsAction({ limit: 20 }),
    getLocaleContext(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Backups</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {translate(language, "admin", "backups.description")}
        </p>
      </div>

      <AdminTabNav />

      <MessagesProvider locale={language} formatLocale={formatLocale} messages={{ admin: namespaceMessages(language, "admin") }}>
        <BackupsClient
          initialReadiness={allReadiness}
          initialPgRuns={pgRuns}
          initialRestoreRuns={restoreRuns}
        />
      </MessagesProvider>
    </div>
  );
}
