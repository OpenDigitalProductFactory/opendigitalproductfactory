/**
 * Voice Slice 2 — TypeScript orchestrator for the Postgres restore wizard.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.6
 * Spec: docs/superpowers/specs/2026-07-09-managed-backup-restore-substrate-design.md
 * Plan: docs/superpowers/plans/2026-05-17-postgres-backup-slice-2-restore.md
 *
 * Thin wrapper (EP-8DC217EB BET-11): the full lifecycle — mutex, sha256
 * integrity check, pre-restore safety dump, script spawn, audit-row
 * re-insert dance, metrics — lives in managed-restore.ts, driven by
 * POSTGRES_RESTORE_SPEC (engine-specs.ts).
 *
 * The restore lock + error types moved to managed-restore.ts (their new
 * canonical home) and are re-exported here so every existing importer
 * (server actions, self-upgrade rollback, tests) keeps working unchanged.
 */

import { POSTGRES_RESTORE_SPEC } from "./engine-specs";
import { runManagedRestore, type ManagedRestoreArgs } from "./managed-restore";

export {
  RestoreIntegrityError,
  RestoreLockedError,
  __test__,
  acquireRestoreLock,
  isRestoreInFlight,
} from "./managed-restore";

export type RestoreArgs = ManagedRestoreArgs;

export async function runPostgresRestore(
  args: RestoreArgs,
): Promise<{ restoreId: string; status: "ok" | "failed" }> {
  return runManagedRestore(POSTGRES_RESTORE_SPEC, args);
}
