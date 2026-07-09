/**
 * TypeScript orchestrator for the Neo4j restore wizard.
 *
 * Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md (Slice 4)
 * Spec: docs/superpowers/specs/2026-07-09-managed-backup-restore-substrate-design.md
 *
 * Thin wrapper (EP-8DC217EB BET-11): the full lifecycle lives in
 * managed-restore.ts, driven by NEO4J_RESTORE_SPEC (engine-specs.ts).
 * Neo4j is unavailable for ~15–30 s during the stop+load+restart sequence;
 * the restore wizard shows this warning before the operator types RESTORE.
 * Unlike Postgres, Neo4j's database is NOT wiped by the restore, so audit
 * rows written to Postgres before the restore persist normally.
 *
 * The script-env builder stays HERE (not in engine-specs.ts) because the
 * DPF_BACKUPS_HOST_PATH forwarding contract is structurally pinned to this
 * file by backups-host-path-relocation.test.ts (BI-8004BCD8). It is a hoisted
 * function declaration so the engine-specs ↔ wrapper module cycle is safe in
 * every load order.
 */

import { NEO4J_RESTORE_SPEC, type RestoreScriptEnvContext } from "./engine-specs";
import { runManagedRestore, type ManagedRestoreArgs } from "./managed-restore";

export { RestoreLockedError, RestoreIntegrityError } from "./managed-restore";

export type Neo4jRestoreArgs = ManagedRestoreArgs;

/**
 * Forward both env vars for docker-in-docker bind translation; the bash
 * script prefers DPF_BACKUPS_HOST_PATH (sibling-to-install) and falls back to
 * DPF_HOST_INSTALL_PATH/backups for pre-relocation installs.
 */
export function buildNeo4jRestoreScriptEnv({
  dumpPath,
}: RestoreScriptEnvContext): NodeJS.ProcessEnv {
  const composeProject = process.env.COMPOSE_PROJECT_NAME ?? "dpf";
  return {
    ...process.env,
    DUMP_PATH: dumpPath,
    DPF_NEO4J_CONTAINER: process.env.DPF_NEO4J_CONTAINER ?? `${composeProject}-neo4j-1`,
    DPF_NEO4J_VOLUME: process.env.DPF_NEO4J_VOLUME ?? `${composeProject}_neo4jdata`,
    DPF_NEO4J_DATABASE: process.env.DPF_NEO4J_DATABASE ?? "neo4j",
    DPF_BACKUPS_HOST_PATH: process.env.DPF_BACKUPS_HOST_PATH ?? "",
    DPF_HOST_INSTALL_PATH: process.env.DPF_HOST_INSTALL_PATH ?? "",
  };
}

export async function runNeo4jRestore(
  args: Neo4jRestoreArgs,
): Promise<{ restoreId: string; status: "ok" | "failed" }> {
  return runManagedRestore(NEO4J_RESTORE_SPEC, args);
}
