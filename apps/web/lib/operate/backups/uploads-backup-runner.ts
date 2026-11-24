/**
 * Upload-store backup runner (BI-1C6BF6B6).
 *
 * Archives the upload store into a run directory paired with a finished
 * Postgres run, so a restore brings back the bytes the restored rows point to.
 * The writer is scripts/backup-uploads.mjs; this module resolves what it needs:
 *
 * - the roots, resolved exactly as the writers resolve them, so the backup
 *   reads the same directories they write: documents, media and coworker
 *   attachments read the PlatformConfig row `upload_storage_path`, then
 *   UPLOAD_STORAGE_PATH, then ./data/uploads; voice audio reads its own
 *   resolver. A voice root that coincides with or sits inside the upload
 *   store is the same root, so no file is archived twice.
 * - the paired Postgres run's dump and digest.
 */
import path from "node:path";

import { resolveDocumentBlobStorageRoot } from "@/lib/documents/blob-storage";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { resolveVoiceStorageRoot } from "@/lib/voice-synthesis/storage-root";

import { UPLOADS_BACKUP_SPEC } from "./engine-specs";
import { BACKUPS_ROOT, runManagedBackup, type ManagedBackupArgs } from "./managed-backup";

export const UPLOAD_STORE_ROOT_NAME = "upload-store";
export const VOICE_ROOT_NAME = "voice";

export type UploadRoot = { name: string; path: string; resolvedFrom: "platform-config" | "env" | "default" };

/** The roots to archive, given the config row and environment the writers read. */
export function resolveUploadRoots(input: {
  configuredPath: string | null;
  env: Readonly<Record<string, string | undefined>>;
  cwd?: string;
  voiceRoot?: string;
}): UploadRoot[] {
  const configured = typeof input.configuredPath === "string" && input.configuredPath.trim().length > 0 ? input.configuredPath : null;
  const uploadPath = resolveDocumentBlobStorageRoot({ configuredPath: configured, env: input.env as NodeJS.ProcessEnv, cwd: input.cwd });
  const uploadStore: UploadRoot = {
    name: UPLOAD_STORE_ROOT_NAME,
    path: uploadPath,
    resolvedFrom: configured ? "platform-config" : input.env.UPLOAD_STORAGE_PATH ? "env" : "default",
  };

  const voiceRaw = input.voiceRoot ?? resolveVoiceStorageRoot({ uploadStoragePath: input.env.UPLOAD_STORAGE_PATH ?? null, cwd: input.cwd });
  const voicePath = path.resolve(input.cwd ?? process.cwd(), voiceRaw);
  if (voicePath === uploadPath || voicePath.startsWith(uploadPath + path.sep)) return [uploadStore];
  if (uploadPath.startsWith(voicePath + path.sep)) {
    throw new Error(
      `The upload store (${uploadPath}) sits inside the voice root (${voicePath}). Archiving both would list files twice; `
      + "point upload_storage_path and UPLOAD_STORAGE_PATH at the same directory, or at directories that do not nest.",
    );
  }
  return [uploadStore, { name: VOICE_ROOT_NAME, path: voicePath, resolvedFrom: input.env.UPLOAD_STORAGE_PATH ? "env" : "default" }];
}

export type PairedPostgresRun = { id: string; storagePath: string; sha256: string | null; status: string; target: string };

/** Script environment for one uploads run, or an error naming why it cannot run. */
export function buildUploadsRunEnv(input: {
  roots: UploadRoot[];
  paired: PairedPostgresRun;
  backupsRoot: string;
}): ActionResult<Record<string, string>> {
  const { paired } = input;
  if (paired.target !== "postgres") return err(`paired run ${paired.id} is a ${paired.target} run, not postgres`);
  if (paired.status !== "ok" || !paired.sha256) return err(`paired Postgres run ${paired.id} did not finish ok, so there is no dump to pair with`);
  return ok({
    DPF_UPLOAD_ROOTS: JSON.stringify(input.roots),
    DPF_BLOB_ROOT_NAME: UPLOAD_STORE_ROOT_NAME,
    PAIRED_POSTGRES_RUN_ID: paired.id,
    PAIRED_POSTGRES_DUMP: path.posix.join(input.backupsRoot, paired.storagePath, "dpf.dump"),
    PAIRED_POSTGRES_SHA256: paired.sha256,
  });
}

/** Run one upload-store backup paired with the given Postgres run. */
export async function runUploadsBackup(
  args: ManagedBackupArgs & { pairedPostgresRunId: string },
): Promise<{ runId: string | null; status: "ok" | "failed"; error?: string }> {
  const prisma = args.prismaClient ?? (await import("@dpf/db")).prisma;
  const backupsRoot = args.backupsRoot ?? BACKUPS_ROOT;
  const paired = await prisma.backupRun.findUnique({
    where: { id: args.pairedPostgresRunId },
    select: { id: true, storagePath: true, sha256: true, status: true, target: true },
  });
  if (!paired) return { runId: null, status: "failed", error: `paired Postgres run ${args.pairedPostgresRunId} not found` };

  const config = await prisma.platformConfig.findUnique({ where: { key: "upload_storage_path" }, select: { value: true } });
  let roots: UploadRoot[];
  try {
    roots = resolveUploadRoots({ configuredPath: typeof config?.value === "string" ? config.value : null, env: process.env });
  } catch (error) {
    return { runId: null, status: "failed", error: getErrorMessage(error) };
  }
  const built = buildUploadsRunEnv({ roots, paired, backupsRoot });
  if (!built.ok) return { runId: null, status: "failed", error: built.error };
  return runManagedBackup(UPLOADS_BACKUP_SPEC, { ...args, prismaClient: prisma, backupsRoot, extraEnv: built.data });
}
