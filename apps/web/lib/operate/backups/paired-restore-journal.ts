import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

export interface RestoreMemberLocator {
  runId: string;
  storagePath: string;
  sha256: string;
}

export interface RestoreJournalPair {
  postgres: RestoreMemberLocator;
  uploads: RestoreMemberLocator & { manifestSha256: string };
}

export interface RestoreJournalIntent {
  operationId: string;
  installationId: string;
  selected: RestoreJournalPair;
  safety: RestoreJournalPair;
  receiver: Array<{ name: string; path: string; dev: string; ino: string }>;
  collisionSetSha256: string;
}

const STAGES = ["prepared", "postgres-started", "postgres-restored", "uploads-started", "uploads-restored", "completed"] as const;
export type RestoreJournalStage = (typeof STAGES)[number];

export interface RestoreJournalReceipt extends RestoreJournalIntent {
  schemaVersion: 1;
  stage: RestoreJournalStage;
  mode: "selected" | "safety";
  forwardStage: RestoreJournalStage | null;
  createdAt: string;
  updatedAt: string;
}

export interface RestoreFileIntent {
  rootName: string;
  relativePath: string;
  beforeSha256: string | null;
  afterSha256: string | null;
}

export interface RestoreFileReceipt extends RestoreFileIntent {
  schemaVersion: 1;
  stage: "pending" | "published";
}

const HEX = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const MAX_BYTES = 256 * 1024;
const JOURNAL_NAME = "recovery.json";
const INTENT_KEYS = ["operationId", "installationId", "selected", "safety", "receiver", "collisionSetSha256"];
const RECEIPT_KEYS = [...INTENT_KEYS, "schemaVersion", "stage", "mode", "forwardStage", "createdAt", "updatedAt"];
const FILE_KEYS = ["rootName", "relativePath", "beforeSha256", "afterSha256"];
const FILE_RECEIPT_KEYS = [...FILE_KEYS, "schemaVersion", "stage"];
const TEMP_ENTRY = /^\.[0-9a-f]{64}\.json\.[0-9a-f-]{36}\.tmp$/;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function digest(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

function isStage(value: unknown): value is RestoreJournalStage {
  return STAGES.some((stage) => stage === value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function locator(value: unknown, target: "postgres" | "uploads"): value is RestoreMemberLocator {
  if (!object(value) || !exactKeys(value, target === "postgres" ? ["runId", "storagePath", "sha256"] : ["runId", "storagePath", "sha256", "manifestSha256"])
    || !validId(value.runId) || !digest(value.sha256) || typeof value.storagePath !== "string") return false;
  const segments = value.storagePath.split("/");
  return segments.length >= 2 && segments[0] === target
    && segments.every((part) => SEGMENT.test(part) && part !== "." && part !== "..");
}

function pair(value: unknown): value is RestoreJournalPair {
  return object(value) && exactKeys(value, ["postgres", "uploads"]) && locator(value.postgres, "postgres") && locator(value.uploads, "uploads")
    && digest((value.uploads as unknown as Record<string, unknown>).manifestSha256);
}

function root(value: unknown): value is RestoreJournalIntent["receiver"][number] {
  return object(value) && exactKeys(value, ["name", "path", "dev", "ino"]) && typeof value.name === "string" && /^[a-z0-9-]+$/.test(value.name)
    && typeof value.path === "string" && value.path !== sep && !value.path.includes("\0") && isAbsolute(value.path) && resolve(value.path) === value.path
    && typeof value.ino === "string" && /^[0-9]+$/.test(value.ino)
    && typeof value.dev === "string" && /^[0-9]+$/.test(value.dev);
}

function validateIntent(value: unknown): asserts value is RestoreJournalIntent {
  if (!object(value) || !validId(value.operationId)) throw new Error("Invalid paired restore operation ID");
  if (!validId(value.installationId) || !pair(value.selected) || !pair(value.safety)
    || value.selected.postgres.runId === value.safety.postgres.runId
    || value.selected.uploads.runId === value.safety.uploads.runId
    || !digest(value.collisionSetSha256) || !Array.isArray(value.receiver)
    || !value.receiver.length || !value.receiver.every(root)) {
    throw new Error("Invalid paired restore journal identity or member evidence");
  }
  const roots = value.receiver;
  if (roots.some((a, index) => roots.slice(index + 1).some((b) => a.name === b.name
    || (a.dev === b.dev && a.ino === b.ino) || a.path === b.path || a.path.startsWith(b.path + sep) || b.path.startsWith(a.path + sep)))) {
    throw new Error("Duplicate or overlapping receiving restore root");
  }
}

async function physical(path: string): Promise<void> {
  if (!(await lstat(path)).isDirectory() || await realpath(path) !== path) {
    throw new Error("Restore journal directory must be physical");
  }
}

async function syncDirectory(path: string): Promise<void> {
  const dir = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await dir.sync(); } finally { await dir.close(); }
}

async function paths(backupsRoot: string, operationId: string) {
  if (!validId(operationId)) throw new Error("Invalid paired restore operation ID");
  const backups = resolve(backupsRoot);
  await physical(backups);
  const area = join(backups, "restore");
  const directory = join(area, operationId);
  return { backups, area, directory, receiptPath: join(directory, JOURNAL_NAME) };
}

async function persist(directory: string, receiptPath: string, name: string, receipt: object): Promise<void> {
  const encoded = JSON.stringify(receipt) + "\n";
  if (Buffer.byteLength(encoded) > MAX_BYTES) throw new Error("Paired restore journal is too large");
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(encoded);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, receiptPath);
    await syncDirectory(directory);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readJournalValue(receiptPath: string): Promise<unknown> {
  const file = await open(receiptPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw new Error("Invalid paired restore journal file");
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw new Error("Paired restore journal changed during read");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
  } finally {
    await file.close();
  }
}

export async function readRestoreJournal(backupsRoot: string, operationId: string): Promise<RestoreJournalReceipt> {
  const { directory, receiptPath } = await paths(backupsRoot, operationId);
  await physical(directory);
  const value = await readJournalValue(receiptPath);
  if (!object(value) || !exactKeys(value, RECEIPT_KEYS)) throw new Error("Invalid paired restore journal fields");
  validateIntent(value);
  const { schemaVersion, stage, mode, forwardStage, createdAt, updatedAt } = value;
  if (schemaVersion !== 1 || value.operationId !== operationId || !isStage(stage)
    || typeof createdAt !== "string" || typeof updatedAt !== "string"
    || !Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))
    || !(mode === "selected" && forwardStage === null || mode === "safety"
      && forwardStage !== "completed" && isStage(forwardStage))) {
    throw new Error("Invalid paired restore journal version, operation or stage");
  }
  return { ...value, schemaVersion, stage, mode, forwardStage, createdAt, updatedAt };
}

/** Fsync and read back the pair before the caller may start either restore. */
export async function prepareRestoreJournal(backupsRoot: string, intent: RestoreJournalIntent): Promise<RestoreJournalReceipt> {
  validateIntent(intent);
  if (!exactKeys(intent as unknown as Record<string, unknown>, INTENT_KEYS)) throw new Error("Invalid paired restore journal intent fields");
  const { backups, area, directory, receiptPath } = await paths(backupsRoot, intent.operationId);
  try { await mkdir(area, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await physical(area);
  await syncDirectory(backups);
  await mkdir(directory, { mode: 0o700 });
  const now = new Date().toISOString();
  const receipt: RestoreJournalReceipt = { ...intent, schemaVersion: 1, stage: "prepared", mode: "selected", forwardStage: null, createdAt: now, updatedAt: now };
  await persist(directory, receiptPath, JOURNAL_NAME, receipt);
  await syncDirectory(area);
  const readback = await readRestoreJournal(backupsRoot, intent.operationId);
  if (JSON.stringify(readback) !== JSON.stringify(receipt)) throw new Error("Paired restore journal readback mismatch");
  return readback;
}

/** The managed restore lock owns this read/replace sequence. */
export async function advanceRestoreJournal(
  backupsRoot: string,
  operationId: string,
  expected: RestoreJournalStage,
  next: RestoreJournalStage,
): Promise<RestoreJournalReceipt> {
  if (STAGES.indexOf(expected) < 0 || STAGES[STAGES.indexOf(expected) + 1] !== next) {
    throw new Error("Invalid paired restore journal stage transition");
  }
  const current = await readRestoreJournal(backupsRoot, operationId);
  if (current.stage !== expected) throw new Error("Paired restore journal stage is stale");
  return replaceReceipt(backupsRoot, { ...current, stage: next });
}

/** An independent caller must verify the confirmation and the exact safety artifacts first. */
export async function selectRestoreSafetyPair(
  backupsRoot: string,
  operationId: string,
  confirmed: RestoreJournalPair,
): Promise<RestoreJournalReceipt> {
  const current = await readRestoreJournal(backupsRoot, operationId);
  const other = current.safety;
  if (current.stage === "completed" || !pair(confirmed) || confirmed.postgres.runId !== other.postgres.runId
    || confirmed.postgres.storagePath !== other.postgres.storagePath || confirmed.postgres.sha256 !== other.postgres.sha256
    || confirmed.uploads.runId !== other.uploads.runId || confirmed.uploads.storagePath !== other.uploads.storagePath
    || confirmed.uploads.sha256 !== other.uploads.sha256 || confirmed.uploads.manifestSha256 !== other.uploads.manifestSha256) {
    throw new Error("Paired restore safety selection does not match the unfinished journal");
  }
  if (current.mode === "safety") return current;
  return replaceReceipt(backupsRoot, { ...current, mode: "safety", forwardStage: current.stage, stage: "prepared" });
}

/** Malformed or unreadable evidence is not an empty journal list. Callers must fail closed. */
export async function listUnfinishedRestoreJournals(backupsRoot: string): Promise<RestoreJournalReceipt[]> {
  const backups = resolve(backupsRoot);
  await physical(backups);
  const area = join(backups, "restore");
  try { await physical(area); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries = await readdir(area, { withFileTypes: true });
  const unfinished: RestoreJournalReceipt[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !validId(entry.name)) throw new Error("Unexpected paired restore journal entry");
    const receipt = await readRestoreJournal(backups, entry.name);
    if (receipt.stage !== "completed") unfinished.push(receipt);
  }
  return unfinished;
}

async function replaceReceipt(backupsRoot: string, current: RestoreJournalReceipt): Promise<RestoreJournalReceipt> {
  const { operationId } = current;
  const { directory, receiptPath } = await paths(backupsRoot, operationId);
  await physical(directory);
  const receipt = { ...current, updatedAt: new Date().toISOString() };
  await persist(directory, receiptPath, JOURNAL_NAME, receipt);
  const readback = await readRestoreJournal(backupsRoot, operationId);
  if (JSON.stringify(readback) !== JSON.stringify(receipt)) throw new Error("Paired restore journal readback mismatch");
  return readback;
}

function fileName({ rootName, relativePath }: Pick<RestoreFileIntent, "rootName" | "relativePath">): string {
  return createHash("sha256").update(JSON.stringify([rootName, relativePath])).digest("hex") + ".json";
}

function validFile(value: unknown, mode: RestoreJournalReceipt["mode"]): value is RestoreFileIntent {
  return object(value) && typeof value.rootName === "string" && /^[a-z0-9-]+$/.test(value.rootName)
    && typeof value.relativePath === "string" && !/[\u0000\p{Cs}]/u.test(value.relativePath)
    && value.relativePath.split("/").every((part) => part !== "" && part !== "." && part !== "..")
    && (value.beforeSha256 === null || digest(value.beforeSha256))
    && (digest(value.afterSha256) || (value.afterSha256 === null && mode === "safety"))
    && value.beforeSha256 !== value.afterSha256;
}

function sameFile(a: RestoreFileIntent, b: RestoreFileIntent): boolean {
  return a.rootName === b.rootName && a.relativePath === b.relativePath
    && a.beforeSha256 === b.beforeSha256 && a.afterSha256 === b.afterSha256;
}

async function readFileIntent(directory: string, name: string, mode: RestoreJournalReceipt["mode"]): Promise<RestoreFileReceipt> {
  const data = await readJournalValue(join(directory, name));
  if (!object(data) || !exactKeys(data, FILE_RECEIPT_KEYS) || !validFile(data, mode) || fileName(data) !== name
    || data.schemaVersion !== 1 || (data.stage !== "pending" && data.stage !== "published")) {
    throw new Error("Invalid paired restore file receipt");
  }
  return { ...data, schemaVersion: data.schemaVersion, stage: data.stage };
}

async function fileArea(
  backupsRoot: string, receipt: RestoreJournalReceipt, mode: RestoreJournalReceipt["mode"], create: boolean,
) {
  const { directory } = await paths(backupsRoot, receipt.operationId);
  const area = join(directory, `${mode}-files`);
  if (create) {
    try { await mkdir(area, { mode: 0o700 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await syncDirectory(directory);
  }
  await physical(area);
  return area;
}

/** Reads pending as well as complete intents. A crash can happen after rename but before verification was recorded. */
export async function listRestoreFileIntents(
  backupsRoot: string, operationId: string, mode: RestoreJournalReceipt["mode"],
): Promise<RestoreFileReceipt[]> {
  const receipt = await readRestoreJournal(backupsRoot, operationId);
  let directory: string;
  try { directory = await fileArea(backupsRoot, receipt, mode, false); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isFile() && TEMP_ENTRY.test(entry.name)) continue;
    if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/.test(entry.name)) throw new Error("Unexpected paired restore file evidence");
    const file = await readFileIntent(directory, entry.name, mode);
    if (!receipt.receiver.some((root) => root.name === file.rootName)) throw new Error("Unknown receiving root in file evidence");
    files.push(file);
  }
  return files;
}

async function requireFileStage(
  backupsRoot: string, operationId: string, mode: RestoreJournalReceipt["mode"], file: RestoreFileIntent,
) {
  const receipt = await readRestoreJournal(backupsRoot, operationId);
  if (receipt.stage !== "uploads-started" || receipt.mode !== mode) throw new Error("Wrong upload publication stage");
  if (!validFile(file, mode) || !exactKeys(file as unknown as Record<string, unknown>, FILE_KEYS)
    || !receipt.receiver.some((root) => root.name === file.rootName)) throw new Error("Invalid paired restore file intent");
  return receipt;
}

/** Must succeed before the caller changes any destination file. */
export async function recordRestoreFileIntent(
  backupsRoot: string, operationId: string, mode: RestoreJournalReceipt["mode"], file: RestoreFileIntent,
): Promise<RestoreFileReceipt> {
  const receipt = await requireFileStage(backupsRoot, operationId, mode, file);
  const directory = await fileArea(backupsRoot, receipt, mode, true);
  const name = fileName(file);
  try {
    const previous = await readFileIntent(directory, name, mode);
    if (!sameFile(file, previous)) throw new Error("Paired restore file intent changed");
    return previous;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await persist(directory, join(directory, name), name, { ...file, schemaVersion: 1, stage: "pending" });
  const readback = await readFileIntent(directory, name, mode);
  if (readback.stage !== "pending" || !sameFile(file, readback)) throw new Error("Paired restore file intent readback mismatch");
  return readback;
}

export async function markRestoreFilePublished(
  backupsRoot: string, operationId: string, mode: RestoreJournalReceipt["mode"], file: RestoreFileIntent, verifiedDigest: string | null,
): Promise<RestoreFileReceipt> {
  if (verifiedDigest !== file.afterSha256) throw new Error("Published restore file digest does not match the intent");
  const receipt = await requireFileStage(backupsRoot, operationId, mode, file);
  const directory = await fileArea(backupsRoot, receipt, mode, false);
  const name = fileName(file);
  const previous = await readFileIntent(directory, name, mode);
  if (!sameFile(previous, file)) throw new Error("Paired restore file intent changed");
  if (previous.stage === "published") return previous;
  await persist(directory, join(directory, name), name, { ...previous, stage: "published" });
  const readback = await readFileIntent(directory, name, mode);
  if (readback.stage !== "published" || !sameFile(file, readback)) throw new Error("Paired restore file receipt readback mismatch");
  return readback;
}
