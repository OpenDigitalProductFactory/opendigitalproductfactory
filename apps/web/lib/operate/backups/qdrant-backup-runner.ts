/**
 * TypeScript orchestrator for the Qdrant daily backup.
 *
 * Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md
 * Spec: docs/superpowers/specs/2026-07-09-managed-backup-restore-substrate-design.md
 * Plan: docs/superpowers/plans/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md
 *
 * Thin wrapper (EP-8DC217EB BET-11): the full lifecycle lives in
 * managed-backup.ts, driven by QDRANT_BACKUP_SPEC (engine-specs.ts). Qdrant
 * backup is fully online — no service interruption required. The exported
 * name is unchanged so the Inngest layer and the self-upgrade recovery-point
 * keep working untouched.
 */

import { QDRANT_BACKUP_SPEC } from "./engine-specs";
import { runManagedBackup, type ManagedBackupArgs } from "./managed-backup";

export type RunQdrantBackupArgs = ManagedBackupArgs;

export async function runQdrantBackup(
  args: RunQdrantBackupArgs,
): Promise<{ runId: string; status: "ok" | "failed"; error?: string }> {
  return runManagedBackup(QDRANT_BACKUP_SPEC, args);
}
