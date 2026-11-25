import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { readPairedRecoveryReceipt } from "@dpf/integration-shared/paired-recovery-contract";

import type { SuccessfulSelfUpgradeRecoveryPoint } from "./recovery-point";

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const FILE = "recovery-point.json";
const MAX_BYTES = 16 * 1024;
const DIR_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const FILE_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function hasErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException)?.code === code;
}

function validPoint(value: unknown, runId: string): value is SuccessfulSelfUpgradeRecoveryPoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  if (Object.keys(point).length !== 7 || point.schemaVersion !== 2 || point.status !== "ok"
    || point.trigger !== "pre-upgrade-recovery" || point.selfUpgradeRunId !== runId
    || typeof point.createdAt !== "string" || !Number.isFinite(Date.parse(point.createdAt))
    || !Array.isArray(point.members) || point.members.length !== 2) return false;
  const pair = readPairedRecoveryReceipt(point.pairedReceipt);
  return pair !== null && (["postgres", "uploads"] as const).every((target, index) => {
    const member = point.members as unknown[];
    const selected = member[index] as Record<string, unknown> | null;
    return selected !== null && typeof selected === "object" && !Array.isArray(selected)
      && Object.keys(selected).length === 3 && selected.target === target
      && selected.runId === pair[target].runId && selected.status === "ok";
  });
}

async function physicalDirectory(path: string): Promise<boolean> {
  const stat = await lstat(path).catch((error: unknown) => {
    if (hasErrno(error, "ENOENT")) return null;
    throw error;
  });
  if (!stat) return false;
  if (!stat.isDirectory() || await realpath(path) !== path) throw new Error("Recovery point directory must be physical.");
  return true;
}

async function syncDirectory(path: string) {
  const directory = await open(path, DIR_FLAGS);
  try { await directory.sync(); } finally { await directory.close(); }
}

async function requestPaths(backupsRoot: string, runId: string) {
  if (!ID.test(runId)) throw new Error("Invalid self-upgrade run ID.");
  const root = await realpath(backupsRoot);
  const area = join(root, "self-upgrade");
  const directory = join(area, runId);
  return { root, area, directory, receiptPath: join(directory, FILE) };
}

async function readStableReceipt(path: string): Promise<Buffer | null> {
  const file = await open(path, FILE_FLAGS).catch((error: unknown) => {
    if (hasErrno(error, "ENOENT")) return null;
    throw error;
  });
  if (!file) return null;
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(MAX_BYTES)) {
      throw new Error("Invalid paired recovery point file.");
    }
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let done = 0;
    while (done < bytes.length) {
      const { bytesRead } = await file.read(bytes, done, bytes.length - done, done);
      if (!bytesRead) break;
      done += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (BigInt(done) !== before.size || after.size !== before.size || after.nlink !== 1n
      || after.ctimeNs !== before.ctimeNs || after.mtimeNs !== before.mtimeNs) {
      throw new Error("Paired recovery point changed during read.");
    }
    return bytes.subarray(0, done);
  } finally {
    await file.close();
  }
}

/** Read the exact point even when the replaced Postgres database is unavailable. */
export async function readSelfUpgradeRecoveryPoint(
  backupsRoot: string, runId: string,
): Promise<SuccessfulSelfUpgradeRecoveryPoint | null> {
  const { area, directory, receiptPath } = await requestPaths(backupsRoot, runId);
  if (!await physicalDirectory(area) || !await physicalDirectory(directory)) return null;
  const bytes = await readStableReceipt(receiptPath);
  if (!bytes) return null;
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!validPoint(value, runId)) throw new Error("Invalid paired recovery point identity or members.");
  return value;
}

async function ensureDirectory(path: string, parent: string) {
  try { await mkdir(path, { mode: 0o700 }); } catch (error) {
    if (!hasErrno(error, "EEXIST")) throw error;
  }
  if (!await physicalDirectory(path)) throw new Error("Recovery point directory disappeared.");
  await syncDirectory(parent);
}

/** Sync the immutable host record before the database can project success. */
export async function persistSelfUpgradeRecoveryPoint(
  backupsRoot: string, point: SuccessfulSelfUpgradeRecoveryPoint,
): Promise<SuccessfulSelfUpgradeRecoveryPoint> {
  const runId = point.selfUpgradeRunId;
  const { root, area, directory, receiptPath } = await requestPaths(backupsRoot, runId);
  const encoded = JSON.stringify(point) + "\n";
  if (!validPoint(point, runId) || Buffer.byteLength(encoded) > MAX_BYTES) throw new Error("Invalid paired recovery point.");

  // The mounted custody root is writable only by the platform operator and
  // services. Refuse symlinked descendants and never overwrite an existing
  // entry, even if two workers encounter the same run directory.
  await ensureDirectory(area, root);
  await ensureDirectory(directory, area);
  const temporary = join(directory, `.${FILE}.${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    try { await file.writeFile(encoded); await file.sync(); } finally { await file.close(); }
    try { await link(temporary, receiptPath); } catch (error) {
      if (!hasErrno(error, "EEXIST")) throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
  await syncDirectory(directory);
  const readback = await readSelfUpgradeRecoveryPoint(root, runId);
  if (readback === null || JSON.stringify(readback) + "\n" !== encoded) {
    throw new Error("Immutable paired recovery point changed or could not be read back.");
  }
  return readback;
}
