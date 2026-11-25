// Read-only admission for the BI-03093FDD paired upload restore. Consumers must
// finish this pass before staging or publishing any receiving-store files.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  ARCHIVE_FORMAT, BLOB_TABLES, ROOT_NAME_RE, RefusalError, UPLOAD_BACKUP_LIMITS,
  assertSafeRelativePath, compareBytes, ustarHeader,
} from "./backup-uploads.mjs";

const BLOCK = 512;
const LIST_CHUNK = 64 * 1024;
const PAYLOAD_CHUNK = 1024 ** 2;
const DIGEST = /^[0-9a-f]{64}$/;
const ROW_ID = /^[A-Za-z0-9_-]+$/;
const MANIFEST_KEYS = [
  "schemaVersion", "target", "roots", "pairedPostgresRunId", "pairedPostgresSha256",
  "fileCount", "totalBytes", "archiveSha256", "filesManifestSha256", "deletedAfterSnapshot",
  "startedAt", "finishedAt", "durationMs", "archiveFormat",
];
const FILE_KEYS = ["root", "path", "sha256", "sizeBytes"];
const ROOT_KEYS = ["name", "path", "resolvedFrom"];
const DELETION_KEYS = ["table", "id", "root", "path"];
const ROOT_SOURCES = new Set(["platform-config", "env", "default"]);
const BLOB_PREFIXES = new Map(BLOB_TABLES.map(({ table, prefix }) => [table, prefix]));
const ORPHAN_PATH_PREVIEW_LIMIT = 100;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function refuse(message) {
  throw new RefusalError(message);
}

function isDigest(value) {
  return typeof value === "string" && DIGEST.test(value);
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function json(bytes, label) {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    refuse(`${label} is not valid UTF-8 JSON`);
  }
}

async function openArtifact(directory, name, limit) {
  let file;
  try {
    file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (error?.code === "ELOOP") refuse(`${name} must be an ordinary regular file, not a link`);
    throw error;
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1) refuse(`${name} must be an ordinary regular file with one link`);
    if (!isCount(stat.size) || stat.size > limit) refuse(`${name} exceeds its ${limit}-byte intake bound`);
    return { file, stat, name };
  } catch (error) {
    await file.close();
    throw error;
  }
}

async function readExact(artifact, position, length) {
  if (position + length > artifact.stat.size) refuse(`${artifact.name} ended early`);
  const bytes = Buffer.allocUnsafe(length);
  for (let offset = 0; offset < length;) {
    const { bytesRead } = await artifact.file.read(bytes, offset, length - offset, position + offset);
    if (bytesRead === 0) refuse(`${artifact.name} ended early`);
    offset += bytesRead;
  }
  return bytes;
}

async function assertUnchanged({ file, stat, name }) {
  const after = await file.stat();
  if (!after.isFile() || after.nlink !== 1 || after.dev !== stat.dev || after.ino !== stat.ino
    || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
    refuse(`${name} changed during verification`);
  }
}

function assertMemberPath(path) {
  if (typeof path !== "string" || path.includes("\0") || !path.isWellFormed()) refuse("invalid member path");
  assertSafeRelativePath(path);
}

function readManifest(bytes, expected) {
  if (createHash("sha256").update(bytes).digest("hex") !== expected.manifestSha256) {
    refuse("manifest digest does not match captured custody");
  }
  const manifest = json(bytes, "manifest.json");
  if (!exactKeys(manifest, MANIFEST_KEYS) || manifest.schemaVersion !== 1 || manifest.target !== "uploads"
    || manifest.archiveFormat !== ARCHIVE_FORMAT || !isDigest(manifest.archiveSha256)
    || !isDigest(manifest.filesManifestSha256) || !isCount(manifest.fileCount)
    || !isCount(manifest.totalBytes) || !isCount(manifest.durationMs)
    || typeof manifest.startedAt !== "string" || !Number.isFinite(Date.parse(manifest.startedAt))
    || typeof manifest.finishedAt !== "string" || !Number.isFinite(Date.parse(manifest.finishedAt))) {
    refuse("manifest.json does not match the uploads run contract");
  }
  if (manifest.pairedPostgresRunId !== expected.pairedPostgresRunId
    || manifest.pairedPostgresSha256 !== expected.pairedPostgresSha256) {
    refuse("uploads manifest does not match the paired Postgres run and dump digest");
  }
  if (manifest.archiveSha256 !== expected.archiveSha256) refuse("archive digest differs from the captured uploads run");
  if (!Array.isArray(manifest.roots) || !manifest.roots.length) refuse("manifest.json lacks upload roots");
  const rootNames = new Set();
  for (const root of manifest.roots) {
    if (!exactKeys(root, ROOT_KEYS) || typeof root.name !== "string" || !ROOT_NAME_RE.test(root.name)
      || typeof root.path !== "string" || !root.path.startsWith("/") || !ROOT_SOURCES.has(root.resolvedFrom)
      || rootNames.has(root.name)) refuse("invalid or duplicate upload root in manifest.json");
    rootNames.add(root.name); // Only logical names leave the verifier.
  }
  if (!Array.isArray(manifest.deletedAfterSnapshot)) refuse("invalid deletedAfterSnapshot list");
  const deletedIds = new Set();
  const deletedPaths = new Set();
  for (const row of manifest.deletedAfterSnapshot) {
    if (!exactKeys(row, DELETION_KEYS) || !BLOB_PREFIXES.has(row.table)
      || typeof row.id !== "string" || !ROW_ID.test(row.id) || !rootNames.has(row.root)) {
      refuse("invalid deletedAfterSnapshot record");
    }
    assertMemberPath(row.path);
    const key = `${row.table}/${row.id}`;
    if (deletedIds.has(key)) refuse("duplicate deletedAfterSnapshot record");
    deletedIds.add(key);
    deletedPaths.add(`${row.root}/${row.path}`);
  }
  return { manifest, rootNames, deletedPaths };
}

async function* listLines(list, hash) {
  let pending = Buffer.alloc(0);
  for (let position = 0; position < list.stat.size;) {
    const chunk = await readExact(list, position, Math.min(LIST_CHUNK, list.stat.size - position));
    position += chunk.length;
    hash.update(chunk);
    const data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let start = 0;
    for (let end; (end = data.indexOf(0x0a, start)) !== -1; start = end + 1) {
      if (end - start > UPLOAD_BACKUP_LIMITS.ndjsonLineBytes) refuse("files.ndjson line exceeds 64 KiB");
      yield data.subarray(start, end);
    }
    pending = data.subarray(start);
    if (pending.length > UPLOAD_BACKUP_LIMITS.ndjsonLineBytes) refuse("files.ndjson line exceeds 64 KiB");
  }
  if (pending.length) refuse("files.ndjson must end with LF");
}

async function verifyMembers({ list, archive, declared, onEntry }) {
  const { manifest, rootNames, deletedPaths } = declared;
  const listHash = createHash("sha256");
  const archiveHash = createHash("sha256");
  let offset = 0;
  let fileCount = 0;
  let totalBytes = 0;
  let previous = null;
  const take = async (size) => {
    const bytes = await readExact(archive, offset, size);
    offset += size;
    archiveHash.update(bytes);
    return bytes;
  };

  for await (const line of listLines(list, listHash)) {
    const entry = json(line, "files.ndjson line");
    if (!exactKeys(entry, FILE_KEYS) || !rootNames.has(entry.root) || !isDigest(entry.sha256)
      || !isCount(entry.sizeBytes)) refuse("invalid files.ndjson entry");
    assertMemberPath(entry.path);
    if (previous && ((compareBytes(previous.root, entry.root) || compareBytes(previous.path, entry.path)) >= 0)) {
      refuse("files.ndjson member order or uniqueness is invalid");
    }
    previous = entry;
    const member = `${entry.root}/${entry.path}`;
    if (deletedPaths.has(member)) refuse("listed file is also declared deleted after snapshot");
    if (!(await take(BLOCK)).equals(ustarHeader(member, entry.sizeBytes))) {
      refuse("archive ustar header does not match the ordered files.ndjson entry");
    }
    const payloadHash = createHash("sha256");
    for (let remaining = entry.sizeBytes; remaining > 0;) {
      const bytes = await take(Math.min(remaining, PAYLOAD_CHUNK));
      payloadHash.update(bytes);
      remaining -= bytes.length;
    }
    if (payloadHash.digest("hex") !== entry.sha256) refuse("archive member payload digest does not match");
    const padding = (BLOCK - (entry.sizeBytes % BLOCK)) % BLOCK;
    if (padding && (await take(padding)).some((byte) => byte !== 0)) refuse("archive member has nonzero padding");
    fileCount += 1;
    totalBytes += entry.sizeBytes;
    await onEntry?.(Object.freeze(entry));
  }
  if (archive.stat.size - offset !== 2 * BLOCK || (await take(2 * BLOCK)).some((byte) => byte !== 0)) {
    refuse("archive end must consist of exactly two zero blocks");
  }
  if (fileCount !== manifest.fileCount || totalBytes !== manifest.totalBytes) refuse("manifest file totals do not match");
  if (listHash.digest("hex") !== manifest.filesManifestSha256) refuse("files.ndjson digest does not match manifest");
  if (archiveHash.digest("hex") !== manifest.archiveSha256) refuse("uploads.tar digest does not match captured evidence");
}

/**
 * Verify the exact source pair using trusted digests supplied by the caller.
 * Optional inventory observations are provisional until this promise resolves.
 * The callback is for read-only trial accounting, not output publication.
 */
export async function verifyUploadsRun({ runDir, expected, onEntry }) {
  if (typeof expected?.pairedPostgresRunId !== "string" || !expected.pairedPostgresRunId
    || !isDigest(expected.pairedPostgresSha256) || !isDigest(expected.archiveSha256)
    || !isDigest(expected.manifestSha256)) refuse("trusted upload and paired Postgres identities are required");
  const directory = resolve(runDir);
  if (await realpath(directory) !== directory) refuse("upload backup run directory must be physical");
  const opened = [];
  const acquire = async (name, limit) => {
    const artifact = await openArtifact(directory, name, limit);
    opened.push(artifact);
    return artifact;
  };
  try {
    const source = await acquire("manifest.json", UPLOAD_BACKUP_LIMITS.manifestBytes);
    const declared = readManifest(await readExact(source, 0, source.stat.size), expected);
    const checksum = await acquire("uploads.tar.sha256", 1024);
    const expectedSidecar = Buffer.from(`${expected.archiveSha256}  uploads.tar\n`, "ascii");
    if (!(await readExact(checksum, 0, checksum.stat.size)).equals(expectedSidecar)) {
      refuse("archive checksum sidecar does not match captured evidence");
    }
    const list = await acquire("files.ndjson", UPLOAD_BACKUP_LIMITS.ndjsonBytes);
    const archive = await acquire("uploads.tar", UPLOAD_BACKUP_LIMITS.archiveBytes);
    await verifyMembers({ list, archive, declared, onEntry });
    await Promise.all(opened.map(assertUnchanged));
    return {
      rootNames: [...declared.rootNames],
      fileCount: declared.manifest.fileCount,
      totalBytes: declared.manifest.totalBytes,
      deletedAfterSnapshot: declared.manifest.deletedAfterSnapshot,
    };
  } finally {
    await Promise.all(opened.map(({ file }) => file.close()));
  }
}

/**
 * Validate the exact DocumentBlob and MediaAsset rows from the restored trial
 * database. Non-SQL attachments and voice entries remain part of the checked
 * archive but are not classified as orphaned SQL blobs.
 */
export async function verifyUploadsTrial({ runDir, expected, rows, blobRootName = "upload-store" }) {
  const pending = new Map();
  const byPath = new Map();
  for await (const row of rows) {
    const prefix = BLOB_PREFIXES.get(row?.table);
    if (!prefix || typeof row.id !== "string" || !ROW_ID.test(row.id) || !isDigest(row.sha256)) {
      refuse("trial database returned invalid blob row identity or digest");
    }
    assertMemberPath(row.storageKey);
    if (!row.storageKey.startsWith(prefix)) refuse(`trial blob ${row.table} ${row.id} is outside its storage namespace`);
    const key = `${row.table}/${row.id}`;
    if (pending.has(key)) refuse("trial database returned a duplicate blob row");
    pending.set(key, row);
    const references = byPath.get(row.storageKey) ?? [];
    references.push(key);
    byPath.set(row.storageKey, references);
  }

  const referencedCount = pending.size;
  let orphanCount = 0;
  const orphanPaths = [];
  const result = await verifyUploadsRun({ runDir, expected, onEntry: (entry) => {
    if (entry.root !== blobRootName) return;
    const references = byPath.get(entry.path);
    if (!references) {
      if (BLOB_TABLES.some(({ prefix }) => entry.path.startsWith(prefix))) {
        orphanCount += 1;
        if (orphanPaths.length < ORPHAN_PATH_PREVIEW_LIMIT) orphanPaths.push(entry.path);
      }
      return;
    }
    for (const key of references) {
      const row = pending.get(key);
      if (entry.sha256 !== row.sha256) refuse(`referenced blob digest differs for ${row.table} ${row.id}`);
      pending.delete(key);
    }
  } });
  if (!result.rootNames.includes(blobRootName)) refuse("verified upload run does not include the selected blob root");

  for (const deleted of result.deletedAfterSnapshot) {
    const key = `${deleted.table}/${deleted.id}`;
    const row = pending.get(key);
    if (!row || deleted.root !== blobRootName || deleted.path !== row.storageKey) {
      refuse("deletion exception does not match an exact missing row in the trial database");
    }
    pending.delete(key);
  }
  if (pending.size) {
    const first = pending.values().next().value;
    refuse(`missing referenced blob ${first.table} ${first.id} (${pending.size} missing)`);
  }
  return { referencedCount, deletedCount: result.deletedAfterSnapshot.length, orphanCount, orphanPaths };
}
