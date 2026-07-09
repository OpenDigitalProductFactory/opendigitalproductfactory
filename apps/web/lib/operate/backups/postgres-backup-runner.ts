/**
 * TypeScript orchestrator for the Postgres daily backup.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §6 Slice 1
 * Spec: docs/superpowers/specs/2026-07-09-managed-backup-restore-substrate-design.md
 * Plan: docs/superpowers/plans/2026-05-17-postgres-daily-backup-slice-1.md
 *
 * Thin wrapper (EP-8DC217EB BET-11): the full lifecycle lives in
 * managed-backup.ts, driven by POSTGRES_BACKUP_SPEC (engine-specs.ts).
 * The exported name is unchanged so the Inngest layer, server actions and
 * self-upgrade recovery-point keep working untouched.
 */

import { POSTGRES_BACKUP_SPEC } from "./engine-specs";
import { runManagedBackup, type ManagedBackupArgs } from "./managed-backup";

export type RunBackupArgs = ManagedBackupArgs;

export async function runPostgresBackup(
  args: RunBackupArgs,
): Promise<{ runId: string; status: "ok" | "failed"; error?: string }> {
  return runManagedBackup(POSTGRES_BACKUP_SPEC, args);
}
