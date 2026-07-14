"use server";

import { prisma } from "@dpf/db";

import { requireCapability } from "@/lib/actions/shared/guards";

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
import { getErrorMessage } from "@/lib/shared/get-error-message";

async function requireBackupAdmin(): Promise<string | null> {
  return (await requireCapability("manage_provider_connections")).userId;
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
 * Confirms and triggers a restore. postgres-only after BET-5 retired the neo4j
 * + qdrant stores. The confirmation text must match RESTORE exactly.
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
    // Look up the target so we dispatch to the correct runner.
    const run = await prisma.backupRun.findUnique({
      where: { id: sourceBackupRunId },
      select: { target: true },
    });
    if (!run) {
      return { ok: false, error: `Backup run ${sourceBackupRunId} not found.`, errorClass: "integrity" };
    }
    if (run.target !== "postgres") {
      return {
        ok: false,
        error: `Restore is postgres-only after BET-5 (backup target=${run.target}).`,
        errorClass: "integrity",
      };
    }

    const result = await runPostgresRestore({ sourceBackupRunId, initiatedByUserId: userId });

    return { ok: result.status === "ok", restoreId: result.restoreId, status: result.status };
  } catch (err) {
    if (err instanceof RestoreLockedError) {
      return { ok: false, error: err.message, errorClass: "locked" };
    }
    if (err instanceof RestoreIntegrityError) {
      return { ok: false, error: err.message, errorClass: "integrity" };
    }
    const message = getErrorMessage(err);
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
