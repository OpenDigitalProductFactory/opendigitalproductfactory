"use server";

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

import { buildRestorePreview } from "@/lib/operate/backups/restore-preview";
import {
  RESTORE_CONFIRMATION_TEXT,
  type RestoreImpactPreview,
  type RestoreRunListItem,
} from "@/lib/operate/backups/restore-types";
import {
  RestoreIntegrityError,
  RestoreLockedError,
  isRestoreInFlight,
  runPostgresRestore,
} from "@/lib/operate/backups/postgres-restore-runner";

async function requireBackupAdmin(): Promise<string | null> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    throw new Error("Unauthorized");
  }
  return user.id ?? null;
}

export async function previewRestoreAction(
  sourceBackupRunId: string,
): Promise<RestoreImpactPreview> {
  await requireBackupAdmin();
  return buildRestorePreview({ sourceBackupRunId });
}

export interface ConfirmRestoreResult {
  ok: boolean;
  restoreId?: string;
  status?: "ok" | "failed";
  error?: string;
  errorClass?:
    | "unauthorized"
    | "confirmation-required"
    | "integrity"
    | "locked"
    | "unknown";
}

/**
 * Confirms and triggers a restore. The wizard's "Restore" button calls this
 * with the typed confirmation text. We require an exact case-sensitive match
 * to `RESTORE` — never accept variants. The check is intentionally
 * server-side AND duplicated on the client (defense in depth).
 */
export async function confirmRestoreAction(
  sourceBackupRunId: string,
  typedConfirmation: string,
): Promise<ConfirmRestoreResult> {
  let userId: string | null = null;
  try {
    userId = await requireBackupAdmin();
  } catch {
    return {
      ok: false,
      error: "You do not have permission to restore backups.",
      errorClass: "unauthorized",
    };
  }

  if (typedConfirmation !== RESTORE_CONFIRMATION_TEXT) {
    return {
      ok: false,
      error: `Confirmation text must be exactly "${RESTORE_CONFIRMATION_TEXT}" to proceed.`,
      errorClass: "confirmation-required",
    };
  }

  try {
    const result = await runPostgresRestore({
      sourceBackupRunId,
      initiatedByUserId: userId,
    });
    return {
      ok: result.status === "ok",
      restoreId: result.restoreId,
      status: result.status,
    };
  } catch (err) {
    if (err instanceof RestoreLockedError) {
      return { ok: false, error: err.message, errorClass: "locked" };
    }
    if (err instanceof RestoreIntegrityError) {
      return { ok: false, error: err.message, errorClass: "integrity" };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, errorClass: "unknown" };
  }
}

export async function listRestoreRunsAction(args?: {
  limit?: number;
}): Promise<RestoreRunListItem[]> {
  await requireBackupAdmin();
  const limit = Math.min(Math.max(args?.limit ?? 20, 1), 100);
  const rows = await prisma.backupRestore.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    include: {
      sourceBackup: { select: { finishedAt: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    sourceBackupRunId: r.sourceBackupRunId,
    sourceFinishedAt: r.sourceBackup.finishedAt?.toISOString() ?? null,
    preRestoreBackupRunId: r.preRestoreBackupRunId,
    initiatedByUserId: r.initiatedByUserId,
    errorMessage: r.errorMessage,
    durationMs:
      r.finishedAt && r.startedAt
        ? r.finishedAt.getTime() - r.startedAt.getTime()
        : null,
  }));
}

export interface RestoreLockStatus {
  inFlight: boolean;
  holder: string | null;
  since: string | null;
}

export async function getRestoreLockStatusAction(): Promise<RestoreLockStatus> {
  await requireBackupAdmin();
  const s = isRestoreInFlight();
  return {
    inFlight: s.inFlight,
    holder: s.holder,
    since: s.since?.toISOString() ?? null,
  };
}
