import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, realpath, rm } from "node:fs/promises";
import { join } from "node:path";

type CaptureFields = {
  runId: string;
  storagePath: string;
  archiveSha256: string;
  pairedPostgresRunId: string;
  pairedPostgresSha256: string;
};
export type UploadsCustodyReceipt = CaptureFields & { schemaVersion: 1; manifestSha256: string };

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const SHA = /^[0-9a-f]{64}$/;
const STORAGE_PATH = /^uploads\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function validCapture(fields: unknown): fields is CaptureFields {
  if (!fields || typeof fields !== "object") return false;
  const value = fields as Record<string, unknown>;
  return typeof value.runId === "string" && ID.test(value.runId)
    && typeof value.pairedPostgresRunId === "string" && ID.test(value.pairedPostgresRunId)
    && typeof value.storagePath === "string" && STORAGE_PATH.test(value.storagePath)
    && typeof value.archiveSha256 === "string" && SHA.test(value.archiveSha256)
    && typeof value.pairedPostgresSha256 === "string" && SHA.test(value.pairedPostgresSha256);
}

async function readSmallOrdinaryFile(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat({ bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(limit)) throw new Error("Invalid upload custody artifact");
    const encoded = Buffer.alloc(Number(stat.size) + 1);
    let size = 0;
    while (size < encoded.length) {
      const { bytesRead } = await file.read(encoded, size, encoded.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (BigInt(size) !== stat.size || after.size !== stat.size || after.nlink !== 1n
      || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) {
      throw new Error("Upload custody artifact changed during capture");
    }
    return encoded.subarray(0, size);
  } finally {
    await file.close();
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function readUploadsCustody(backupsRoot: string, runId: string): Promise<UploadsCustodyReceipt> {
  if (!ID.test(runId)) throw new Error("Invalid upload custody run ID");
  const area = join(await realpath(backupsRoot), "uploads-custody");
  if (await realpath(area) !== area) throw new Error("Upload custody must be a physical host directory");
  const value: unknown = JSON.parse(decoder.decode(await readSmallOrdinaryFile(join(area, `${runId}.json`), 8192)));
  if (!validCapture(value) || value.runId !== runId) throw new Error("Invalid upload custody identity");
  const record = value as CaptureFields & Record<string, unknown>;
  if (Object.keys(record).length !== 7 || record.schemaVersion !== 1
    || typeof record.manifestSha256 !== "string" || !SHA.test(record.manifestSha256)) {
    throw new Error("Invalid upload custody record");
  }
  return { ...value, schemaVersion: 1, manifestSha256: record.manifestSha256 };
}

/** Anchor the writer's exact manifest bytes on the host before the BackupRun becomes successful. */
export async function captureUploadsCustody(backupsRoot: string, fields: CaptureFields): Promise<UploadsCustodyReceipt> {
  if (!validCapture(fields) || Object.keys(fields).length !== 5) throw new Error("Invalid upload custody capture identity");
  const root = await realpath(backupsRoot);
  const run = join(root, fields.storagePath);
  if (await realpath(run) !== run) throw new Error("Upload capture must be in a physical backup run directory");
  const bytes = await readSmallOrdinaryFile(join(run, "manifest.json"), 16 * 1024 * 1024);
  const manifest = JSON.parse(decoder.decode(bytes));
  if (manifest?.target !== "uploads" || manifest.archiveSha256 !== fields.archiveSha256
    || manifest.pairedPostgresRunId !== fields.pairedPostgresRunId || manifest.pairedPostgresSha256 !== fields.pairedPostgresSha256) {
    throw new Error("Upload custody manifest does not match the exact Postgres and uploads pair");
  }
  const receipt = { schemaVersion: 1, ...fields, manifestSha256: createHash("sha256").update(bytes).digest("hex") } as const;
  const area = join(root, "uploads-custody");
  try { await mkdir(area, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (await realpath(area) !== area) throw new Error("Upload custody must be a physical host directory");
  await syncDirectory(root);
  const temporary = join(area, `.${fields.runId}.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(receipt) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    try { await link(temporary, join(area, `${fields.runId}.json`)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
  await syncDirectory(area);
  const observed = await readUploadsCustody(root, fields.runId);
  if ((Object.keys(receipt) as Array<keyof UploadsCustodyReceipt>).some((key) => receipt[key] !== observed[key])) {
    throw new Error("Immutable upload custody evidence changed for this run");
  }
  return observed;
}
