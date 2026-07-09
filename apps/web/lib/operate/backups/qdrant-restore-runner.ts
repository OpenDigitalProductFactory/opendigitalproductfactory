/**
 * TypeScript orchestrator for the Qdrant restore wizard.
 *
 * Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md (Slice 4)
 * Spec: docs/superpowers/specs/2026-07-09-managed-backup-restore-substrate-design.md
 *
 * Thin wrapper (EP-8DC217EB BET-11): the full lifecycle lives in
 * managed-restore.ts, driven by QDRANT_RESTORE_SPEC (engine-specs.ts).
 * Uses the Qdrant REST snapshot API for an online restore — the script
 * POSTs /snapshots/upload?wait=true and Qdrant replaces all collections from
 * the full-instance snapshot with no service interruption. Postgres is
 * unaffected, so audit rows persist normally.
 */

import { QDRANT_RESTORE_SPEC } from "./engine-specs";
import { runManagedRestore, type ManagedRestoreArgs } from "./managed-restore";

export { RestoreLockedError, RestoreIntegrityError } from "./managed-restore";

export type QdrantRestoreArgs = ManagedRestoreArgs;

export async function runQdrantRestore(
  args: QdrantRestoreArgs,
): Promise<{ restoreId: string; status: "ok" | "failed" }> {
  return runManagedRestore(QDRANT_RESTORE_SPEC, args);
}
