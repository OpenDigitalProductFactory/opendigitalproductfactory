import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RestoreJournalPair, RestoreJournalReceipt, RestoreMemberLocator } from "./paired-restore-journal";
import { POSTGRES_RESTORE_SPEC } from "./engine-specs";
import { RestoreIntegrityError } from "./managed-restore";
import { resolveManagedScriptPath, runManagedScript } from "./managed-script-path";
import type { RestoreUploadMember } from "./restore-upload-destinations";
import { readUploadsCustody } from "./uploads-custody";

const SHA = /^[0-9a-f]{64}$/;
const PG_PATH = /^postgres\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export interface PairedRestoreSource {
  backupsRoot: string;
  pair: RestoreJournalPair;
  readerPath?: string;
}

type ArchiveMember = RestoreUploadMember & { sizeBytes: number };
type VerifiedArchive = {
  rootNames: string[];
  members: readonly ArchiveMember[];
  readPayload(member: ArchiveMember): AsyncIterable<Uint8Array>;
};
type UploadReader = {
  withVerifiedUploadsArchive<T>(input: {
    runDir: string;
    expected: { pairedPostgresRunId: string; pairedPostgresSha256: string; archiveSha256: string; manifestSha256: string };
  }, use: (archive: VerifiedArchive) => T | Promise<T>): Promise<T>;
};

async function postgresPath(backupsRoot: string, locator: RestoreMemberLocator): Promise<string> {
  if (!PG_PATH.test(locator.storagePath) || !SHA.test(locator.sha256)) throw new RestoreIntegrityError("Invalid paired Postgres locator");
  const directory = join(await realpath(backupsRoot), locator.storagePath);
  if (await realpath(directory) !== directory) throw new RestoreIntegrityError("Paired Postgres run directory must be physical");
  return join(directory, POSTGRES_RESTORE_SPEC.artifactFileName);
}

async function verifyPostgresDump(backupsRoot: string, locator: RestoreMemberLocator): Promise<void> {
  const dump = await postgresPath(backupsRoot, locator);
  const file = await open(dump, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat({ bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.size < 1n) throw new RestoreIntegrityError("Paired Postgres dump must be an ordinary file");
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk as Buffer);
    const after = await file.stat({ bigint: true });
    if (hash.digest("hex") !== locator.sha256 || stat.size !== after.size || after.nlink !== 1n
      || stat.mtimeNs !== after.mtimeNs || stat.ctimeNs !== after.ctimeNs) {
      throw new RestoreIntegrityError("Paired Postgres dump digest does not match the recorded source.");
    }
  } finally {
    await file.close();
  }
}

export async function withPairedRestoreArchive<T>(
  { backupsRoot, pair, readerPath }: PairedRestoreSource, use: (archive: VerifiedArchive) => T | Promise<T>,
): Promise<T> {
  const uploads = await readUploadsCustody(backupsRoot, pair.uploads.runId);
  if (uploads.storagePath !== pair.uploads.storagePath || uploads.archiveSha256 !== pair.uploads.sha256
    || uploads.manifestSha256 !== pair.uploads.manifestSha256 || uploads.pairedPostgresRunId !== pair.postgres.runId
    || uploads.pairedPostgresSha256 !== pair.postgres.sha256) {
    throw new RestoreIntegrityError("Paired restore does not match the host upload capture custody.");
  }
  const script = readerPath ?? resolveManagedScriptPath("restore-uploads.mjs");
  const href = pathToFileURL(script).href;
  const { withVerifiedUploadsArchive } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ href) as UploadReader;
  return withVerifiedUploadsArchive({
    runDir: join(await realpath(backupsRoot), uploads.storagePath),
    expected: {
      pairedPostgresRunId: uploads.pairedPostgresRunId, pairedPostgresSha256: uploads.pairedPostgresSha256,
      archiveSha256: uploads.archiveSha256, manifestSha256: uploads.manifestSha256,
    },
  }, use);
}

export async function validatePairedRestoreArtifacts(source: PairedRestoreSource): Promise<{
  rootNames: string[]; members: readonly ArchiveMember[];
}> {
  const [, archive] = await Promise.all([
    verifyPostgresDump(source.backupsRoot, source.pair.postgres),
    withPairedRestoreArchive(source, ({ rootNames, members }) => ({ rootNames, members })),
  ]);
  return archive;
}

/** The durable host journal, not the old BackupRun rows, is the apply authority. */
export async function applyVerifiedPairedPostgres(
  backupsRoot: string, receipt: RestoreJournalReceipt, scriptPath?: string,
): Promise<void> {
  if (receipt.stage !== "postgres-started") throw new RestoreIntegrityError("Paired Postgres restore requires a persisted Postgres-started stage.");
  const locator = receipt[receipt.mode].postgres;
  const dumpPath = await postgresPath(backupsRoot, locator);
  const spec = POSTGRES_RESTORE_SPEC;
  const outcome = await runManagedScript(scriptPath ?? resolveManagedScriptPath(spec.scriptName), {
    env: {
      ...spec.buildEnv({ dumpPath }),
      EXPECTED_DUMP_SHA256: locator.sha256,
      LOG_PATH: join(backupsRoot, "restore", receipt.operationId, `postgres-${receipt.mode}.log`),
    },
    timeoutMs: spec.timeoutMs,
  });
  if (!outcome.ok) {
    throw new RestoreIntegrityError("Postgres restore did not complete. The receiver remains fenced for journaled recovery.");
  }
}
