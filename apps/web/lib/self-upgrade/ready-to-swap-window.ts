import {
  PAIRED_TRIAL_RESTORE_TIMEOUT_MS,
  POSTGRES_BACKUP_TIMEOUT_MS,
  UPLOADS_BACKUP_TIMEOUT_MS,
} from "@/lib/operate/backups/runner-budgets";
import { resolvePromoterTimeoutMs } from "./promoter-timeout";
import type { EnteredStateAt } from "./quiescence-contract";

const MINUTE_MS = 60_000;
const HANDOFF_MS = 10 * MINUTE_MS;
// No fresh operator confirmation means no new recovery allowance. For old
// ready rows the default legacy grant is also a conservative migration bound.
export const LEGACY_UNCONFIRMED_MAX_MS = 35 * MINUTE_MS;
const CAPTURE_MS = POSTGRES_BACKUP_TIMEOUT_MS + UPLOADS_BACKUP_TIMEOUT_MS;
const MAX_DATABASE_INTEGER = 2_147_483_647;

type ReadyOperation = "paired-upgrade" | "paired-volume-teardown" | "unrelated";

export function readyToSwapBudgetMs(
  operation: ReadyOperation,
  promoterTimeoutMs = resolvePromoterTimeoutMs({}),
): number {
  const promoterWindow = Math.ceil(promoterTimeoutMs / MINUTE_MS) * MINUTE_MS + HANDOFF_MS;
  switch (operation) {
    case "paired-upgrade": return CAPTURE_MS + promoterWindow;
    // The exact confirmed volume-scope caller is owned by BI-56077D27.
    case "paired-volume-teardown": return CAPTURE_MS + PAIRED_TRIAL_RESTORE_TIMEOUT_MS + HANDOFF_MS;
    case "unrelated": return promoterWindow;
  }
}

/** Revalidate at run start. Admission uses currentUpgradeConfirmationMatches for
 * the exact match. If requirements decreased since admission, return the
 * current requirement rather than holding the larger confirmed allowance. */
export function resolveConfirmedUpgradeWindow(
  confirmedMaxMs?: number | null,
  promoterTimeoutMs = resolvePromoterTimeoutMs({}),
): number {
  if (confirmedMaxMs == null) {
    return Math.min(readyToSwapBudgetMs("unrelated", promoterTimeoutMs), LEGACY_UNCONFIRMED_MAX_MS);
  }
  const required = readyToSwapBudgetMs("paired-upgrade", promoterTimeoutMs);
  if (!Number.isSafeInteger(confirmedMaxMs) || confirmedMaxMs > MAX_DATABASE_INTEGER || confirmedMaxMs < required) {
    throw new Error("The maintenance limit changed. Refresh the upgrade page and review the new maximum before installing.");
  }
  return required;
}

export function currentUpgradeConfirmationMatches(confirmedMaxMs: number): boolean {
  return Number.isSafeInteger(confirmedMaxMs) && confirmedMaxMs <= MAX_DATABASE_INTEGER
    && confirmedMaxMs === readyToSwapBudgetMs("paired-upgrade");
}

export function remainingReadyToSwapMs(deadline: Date, now = new Date()): number {
  return Math.max(0, +deadline - +now);
}

type WindowRow = {
  status: string;
  abortRequestedAt: Date | null;
  readyToSwapDeadlineAt: Date | null;
  enteredStateAt: unknown;
};

export function readyToSwapDeadline(
  row: Pick<WindowRow, "readyToSwapDeadlineAt" | "enteredStateAt">,
  legacyBudgetMs = LEGACY_UNCONFIRMED_MAX_MS,
): Date | null {
  const start = (row.enteredStateAt as EnteredStateAt | null)?.["ready-to-swap"];
  const deadline = row.readyToSwapDeadlineAt ?? new Date((typeof start === "string" ? Date.parse(start) : NaN) + legacyBudgetMs);
  return Number.isFinite(+deadline) ? deadline : null;
}

export function isReadyToSwapWindowLive(row: WindowRow, now: Date): boolean {
  if (row.abortRequestedAt || (row.status !== "ready-to-swap" && row.status !== "swapping")) return false;
  const deadline = readyToSwapDeadline(row);
  return deadline != null && remainingReadyToSwapMs(deadline, now) > 0;
}
