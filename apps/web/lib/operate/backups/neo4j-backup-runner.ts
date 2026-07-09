/**
 * TypeScript orchestrator for the Neo4j daily backup.
 *
 * Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md
 * Spec: docs/superpowers/specs/2026-07-09-managed-backup-restore-substrate-design.md
 * Plan: docs/superpowers/plans/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md
 *
 * Thin wrapper (EP-8DC217EB BET-11): the full lifecycle lives in
 * managed-backup.ts, driven by NEO4J_BACKUP_SPEC (engine-specs.ts). The
 * exported name is unchanged so the Inngest layer and the self-upgrade
 * recovery-point keep working untouched.
 *
 * The script-env builder stays HERE (not in engine-specs.ts) because the
 * DPF_BACKUPS_HOST_PATH forwarding contract is structurally pinned to this
 * file by backups-host-path-relocation.test.ts (BI-8004BCD8). It is a hoisted
 * function declaration so the engine-specs ↔ wrapper module cycle is safe in
 * every load order.
 */

import { NEO4J_BACKUP_SPEC, type BackupScriptEnvContext } from "./engine-specs";
import { runManagedBackup, type ManagedBackupArgs } from "./managed-backup";

export type RunNeo4jBackupArgs = ManagedBackupArgs;

/**
 * Docker-in-docker gotcha: when the script spawns the neo4j-admin dump
 * container, the bind mount source must be the HOST path (DPF_BACKUPS_HOST_PATH,
 * which is the sibling-to-install backups directory in relocated installs;
 * falls back to DPF_HOST_INSTALL_PATH/backups for pre-relocation installs).
 * The script handles this translation via HOST_TARGET_DIR; we pass both env
 * vars through so the script can pick whichever is set. Explicit pass-through
 * (rather than relying on the process.env spread) documents the runner→script
 * contract.
 */
export function buildNeo4jBackupScriptEnv({
  targetDir,
  composeProject,
}: BackupScriptEnvContext): NodeJS.ProcessEnv {
  const containerName =
    process.env.DPF_NEO4J_CONTAINER ?? `${composeProject}-neo4j-1`;
  return {
    ...process.env,
    TARGET_DIR: targetDir,
    DPF_NEO4J_CONTAINER: containerName,
    DPF_NEO4J_VOLUME: process.env.DPF_NEO4J_VOLUME ?? `${composeProject}_neo4jdata`,
    DPF_NEO4J_DATABASE: process.env.DPF_NEO4J_DATABASE ?? "neo4j",
    DPF_BACKUPS_HOST_PATH: process.env.DPF_BACKUPS_HOST_PATH ?? "",
    DPF_HOST_INSTALL_PATH: process.env.DPF_HOST_INSTALL_PATH ?? "",
  };
}

export async function runNeo4jBackup(
  args: RunNeo4jBackupArgs,
): Promise<{ runId: string; status: "ok" | "failed"; error?: string }> {
  return runManagedBackup(NEO4J_BACKUP_SPEC, args);
}
