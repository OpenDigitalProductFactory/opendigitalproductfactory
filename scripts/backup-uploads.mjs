#!/usr/bin/env node
// Upload-store backup writer (BI-1C6BF6B6).
//
// The governed Postgres backup carries DocumentBlob and MediaAsset rows but
// never the bytes they point to. This writer archives every upload-store root
// into one run directory, paired with the Postgres dump it follows:
//
//   manifest.json  uploads.tar  uploads.tar.sha256  files.ndjson  log.txt
//
// The contract (agreed with DPF2 intake, recorded on BI-1C6BF6B6):
//   - uploads.tar is plain ustar: regular files only (typeflag 0), member name
//     "<root>/<path>", no pax/GNU entries, members in files.ndjson order. A
//     path that does not fit ustar fails the run; the format never widens.
//   - files.ndjson: one {"root","path","sha256","sizeBytes"} per line, sorted
//     by (root, path) in byte order, LF-terminated, no blank lines.
//   - Symlinks and hard links in any root fail the run.
//   - The run starts after the paired dump finished. Writers write a file
//     before its row, so every blob row in the dump has its file, except rows
//     deleted between dump and copy; those are recorded in
//     deletedAfterSnapshot after checking the live database. A live row with
//     no file fails the run.
//
// Environment:
//   TARGET_DIR                 run directory to create (must not exist)
//   DPF_UPLOAD_ROOTS           JSON [{ "name", "path", "resolvedFrom" }]
//   DPF_BLOB_ROOT_NAME         root holding documents/ and media/ (default "upload-store")
//   PAIRED_POSTGRES_RUN_ID     BackupRun id of the paired dump
//   PAIRED_POSTGRES_DUMP       absolute path of the paired dpf.dump
//   PAIRED_POSTGRES_SHA256     its sha256 (verified before anything is written)
//   DPF_PRODUCTION_DB_CONTAINER, POSTGRES_USER, POSTGRES_DB
//                              live database for the deletion check (as backup-postgres.sh)
//
// Exit codes: 0 ok, 2 bad input, 3 refusal (link, unfit path, live row without
// file), 4 write failure. Failures print "BACKUP_UPLOADS_FAILED: <reason>" to stderr.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, createReadStream, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const ARCHIVE_FORMAT = "ustar (POSIX.1-1988; regular files only; members in files.ndjson order)";
export const ROOT_NAME_RE = /^[a-z0-9-]+$/;
export const BLOB_TABLES = Object.freeze([
  { table: "DocumentBlob", prefix: "documents/sha256/" },
  { table: "MediaAsset", prefix: "media/sha256/" },
]);
// Writers' in-flight and pending-delete files: `.<name>.<pid>.<uuid>.tmp|delete`.
const TRANSIENT_RE = /^\..+\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(tmp|delete)$/;
const BLOCK = 512;
const MAX_USTAR_SIZE = 0o77777777777;

export class RefusalError extends Error {
  constructor(message) {
    super(message);
    this.name = "RefusalError";
  }
}

/** Byte-order comparison of two strings as UTF-8. */
export function compareBytes(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** Validate roots: safe unique names, absolute paths, no nesting or coincidence. */
export function validateRoots(roots) {
  if (!Array.isArray(roots) || roots.length === 0) throw new Error("DPF_UPLOAD_ROOTS must be a non-empty array");
  const seen = new Set();
  const normalized = roots.map((r) => {
    if (!r || typeof r.name !== "string" || !ROOT_NAME_RE.test(r.name)) throw new Error(`root name must match ${ROOT_NAME_RE}: ${r?.name}`);
    if (seen.has(r.name)) throw new Error(`duplicate root name: ${r.name}`);
    seen.add(r.name);
    if (typeof r.path !== "string" || !r.path.startsWith("/")) throw new Error(`root ${r.name} path must be absolute`);
    if (!["platform-config", "env", "default"].includes(r.resolvedFrom)) throw new Error(`root ${r.name} resolvedFrom must be platform-config, env or default`);
    return { name: r.name, path: resolve(r.path), resolvedFrom: r.resolvedFrom };
  });
  for (const a of normalized) {
    for (const b of normalized) {
      if (a === b) continue;
      if (a.path === b.path || a.path.startsWith(b.path + sep)) {
        throw new Error(`roots ${a.name} and ${b.name} nest or coincide; resolve them to one root`);
      }
    }
  }
  return normalized.sort((x, y) => compareBytes(x.name, y.name));
}

/** Split "<root>/<path>" into ustar name (<=100 bytes) and prefix (<=155 bytes), or refuse. */
export function splitUstarName(memberName) {
  const bytes = Buffer.from(memberName, "utf8");
  if (bytes.length <= 100) return { name: memberName, prefix: "" };
  const parts = memberName.split("/");
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join("/");
    const name = parts.slice(i).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100 && name.length > 0) return { name, prefix };
  }
  throw new RefusalError(`path does not fit ustar name/prefix fields: ${memberName}`);
}

function octal(value, width) {
  const digits = value.toString(8);
  if (digits.length > width - 1) throw new RefusalError(`value ${value} does not fit a ${width}-byte ustar field`);
  return digits.padStart(width - 1, "0") + "\0";
}

/** One 512-byte ustar header for a regular file. Deterministic: mode 0644, uid/gid 0, mtime 0. */
export function ustarHeader(memberName, size) {
  if (size > MAX_USTAR_SIZE) throw new RefusalError(`file larger than ustar allows: ${memberName}`);
  const { name, prefix } = splitUstarName(memberName);
  const h = Buffer.alloc(BLOCK, 0);
  h.write(name, 0, 100, "utf8");
  h.write(octal(0o644, 8), 100, 8, "ascii");
  h.write(octal(0, 8), 108, 8, "ascii");
  h.write(octal(0, 8), 116, 8, "ascii");
  h.write(octal(size, 12), 124, 12, "ascii");
  h.write(octal(0, 12), 136, 12, "ascii");
  h.fill(0x20, 148, 156); // checksum field counted as spaces
  h.write("0", 156, 1, "ascii"); // regular file
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return h;
}

/** Validate one relative path: non-empty segments, no "." or "..". */
export function assertSafeRelativePath(rel) {
  if (!rel || rel.startsWith("/")) throw new RefusalError(`not a relative path: ${rel}`);
  for (const segment of rel.split("/")) {
    if (segment === "" || segment === "." || segment === "..") throw new RefusalError(`unsafe path segment in ${rel}`);
  }
}

/**
 * List every regular file under a root. Refuses symlinks, hard links (nlink > 1)
 * and anything that is not a file or directory. Skips writers' transient files.
 */
export function listRoot(root, { lstat = lstatSync, readdir = readdirSync, onSkip = () => {} } = {}) {
  const files = [];
  if (!existsSync(root.path)) return files;
  const rootStat = lstat(root.path);
  if (rootStat.isSymbolicLink()) throw new RefusalError(`root ${root.name} is a symlink: ${root.path}`);
  if (!rootStat.isDirectory()) throw new RefusalError(`root ${root.name} is not a directory: ${root.path}`);
  const walk = (dir) => {
    for (const entry of readdir(dir)) {
      const abs = join(dir, entry);
      const st = lstat(abs);
      if (st.isSymbolicLink()) throw new RefusalError(`symlink in ${root.name}: ${relative(root.path, abs)}`);
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!st.isFile()) throw new RefusalError(`not a regular file in ${root.name}: ${relative(root.path, abs)}`);
      if (TRANSIENT_RE.test(entry)) {
        onSkip(relative(root.path, abs));
        continue;
      }
      if (st.nlink > 1) throw new RefusalError(`hard link in ${root.name}: ${relative(root.path, abs)}`);
      const rel = relative(root.path, abs).split(sep).join("/");
      assertSafeRelativePath(rel);
      files.push({ root: root.name, path: rel, abs, size: st.size });
    }
  };
  walk(root.path);
  return files;
}

/** Sort file entries by (root, path) in byte order and refuse duplicates. */
export function sortEntries(entries) {
  const sorted = [...entries].sort((a, b) => compareBytes(a.root, b.root) || compareBytes(a.path, b.path));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].root === sorted[i - 1].root && sorted[i].path === sorted[i - 1].path) throw new Error(`duplicate entry ${sorted[i].root}/${sorted[i].path}`);
  }
  return sorted;
}

/** Parse the blob rows of a pg_restore data-only COPY stream. */
export function parseBlobRowsFromCopy(text) {
  const rows = [];
  let current = null;
  for (const line of text.split("\n")) {
    const head = /^COPY "?(?:public"?\.)?"?([A-Za-z0-9_]+)"? \(([^)]*)\) FROM stdin;$/.exec(line);
    if (head) {
      const columns = head[2].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const spec = BLOB_TABLES.find((t) => t.table === head[1]);
      current = spec ? { table: spec.table, idIdx: columns.indexOf("id"), keyIdx: columns.indexOf("storageKey") } : null;
      if (current && (current.idIdx < 0 || current.keyIdx < 0)) throw new Error(`COPY header for ${head[1]} lacks id or storageKey`);
      continue;
    }
    if (line === "\\.") {
      current = null;
      continue;
    }
    if (current && line !== "") {
      const fields = line.split("\t");
      rows.push({ table: current.table, id: fields[current.idIdx], storageKey: fields[current.keyIdx] });
    }
  }
  return rows;
}

/**
 * Reconcile the dump's blob rows with the archived files. A row whose file is
 * archived is fine. A row with no file is a deletion after the snapshot when the
 * live row no longer exists; otherwise it is a refusal.
 */
export async function reconcileBlobRows({ dumpRows, entries, blobRootName, liveRowExists }) {
  const archived = new Set(entries.filter((e) => e.root === blobRootName).map((e) => e.path));
  const deletedAfterSnapshot = [];
  for (const row of dumpRows) {
    assertSafeRelativePath(row.storageKey);
    if (archived.has(row.storageKey)) continue;
    if (await liveRowExists(row.table, row.id)) {
      throw new RefusalError(`live ${row.table} ${row.id} has no file at ${blobRootName}/${row.storageKey}`);
    }
    deletedAfterSnapshot.push({ table: row.table, id: row.id, root: blobRootName, path: row.storageKey });
  }
  deletedAfterSnapshot.sort((a, b) => compareBytes(a.table, b.table) || compareBytes(a.id, b.id));
  return deletedAfterSnapshot;
}

function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("data", (c) => hash.update(c)).on("error", reject).on("end", () => resolvePromise(hash.digest("hex")));
  });
}

/** Write uploads.tar and files.ndjson. Reads each file once; refuses a file that changed size. */
export function writeArchive({ entries, tarPath, ndjsonPath, readFile = readFileSync }) {
  const fd = openSync(tarPath, "wx", 0o600);
  const tarHash = createHash("sha256");
  const lines = [];
  let totalBytes = 0;
  const put = (buf) => {
    writeSync(fd, buf);
    tarHash.update(buf);
  };
  try {
    for (const e of entries) {
      const content = readFile(e.abs);
      if (content.length !== e.size) throw new RefusalError(`file changed size during backup: ${e.root}/${e.path}`);
      const sha256 = createHash("sha256").update(content).digest("hex");
      put(ustarHeader(`${e.root}/${e.path}`, content.length));
      put(content);
      const pad = (BLOCK - (content.length % BLOCK)) % BLOCK;
      if (pad) put(Buffer.alloc(pad, 0));
      lines.push(JSON.stringify({ root: e.root, path: e.path, sha256, sizeBytes: content.length }));
      totalBytes += content.length;
    }
    put(Buffer.alloc(BLOCK * 2, 0));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const ndjson = lines.length ? lines.join("\n") + "\n" : "";
  writeFileSync(ndjsonPath, ndjson, { mode: 0o600, flag: "wx" });
  return {
    archiveSha256: tarHash.digest("hex"),
    filesManifestSha256: createHash("sha256").update(ndjson).digest("hex"),
    fileCount: lines.length,
    totalBytes,
  };
}

/** The manifest with exactly the agreed keys, in a fixed order. */
export function buildManifest(fields) {
  return {
    schemaVersion: 1,
    target: "uploads",
    roots: fields.roots.map((r) => ({ name: r.name, path: r.path, resolvedFrom: r.resolvedFrom })),
    pairedPostgresRunId: fields.pairedPostgresRunId,
    pairedPostgresSha256: fields.pairedPostgresSha256,
    fileCount: fields.fileCount,
    totalBytes: fields.totalBytes,
    archiveSha256: fields.archiveSha256,
    filesManifestSha256: fields.filesManifestSha256,
    deletedAfterSnapshot: fields.deletedAfterSnapshot,
    startedAt: fields.startedAt,
    finishedAt: fields.finishedAt,
    durationMs: fields.durationMs,
    archiveFormat: ARCHIVE_FORMAT,
  };
}

function liveRowExistsViaDocker({ container, user, db }) {
  return async (table, id) => {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`unexpected blob row id: ${id}`);
    const out = execFileSync("docker", ["exec", container, "psql", "-X", "-tA", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1",
      "-c", `SELECT count(*) FROM "${table}" WHERE id = '${id}'`], { encoding: "utf8" });
    return out.trim() !== "0";
  };
}

async function main() {
  const startedAt = new Date();
  const env = process.env;
  const targetDir = env.TARGET_DIR;
  if (!targetDir) throw Object.assign(new Error("TARGET_DIR not set"), { exitCode: 2 });
  if (existsSync(targetDir)) throw Object.assign(new Error(`TARGET_DIR already exists: ${targetDir}`), { exitCode: 2 });
  const roots = validateRoots(JSON.parse(env.DPF_UPLOAD_ROOTS ?? "null"));
  const blobRootName = env.DPF_BLOB_ROOT_NAME ?? "upload-store";
  if (!roots.some((r) => r.name === blobRootName)) throw Object.assign(new Error(`blob root ${blobRootName} is not among the roots`), { exitCode: 2 });
  for (const key of ["PAIRED_POSTGRES_RUN_ID", "PAIRED_POSTGRES_DUMP", "PAIRED_POSTGRES_SHA256"]) {
    if (!env[key]) throw Object.assign(new Error(`${key} not set`), { exitCode: 2 });
  }

  mkdirSync(targetDir, { recursive: false, mode: 0o700 });
  const logLines = [];
  const log = (msg) => {
    const line = `[uploads-backup-trace] ${msg}`;
    console.log(line);
    logLines.push(line);
  };
  const flushLog = () => writeFileSync(join(targetDir, "log.txt"), logLines.join("\n") + "\n", { mode: 0o600 });

  try {
    const dumpSha = await sha256File(env.PAIRED_POSTGRES_DUMP);
    if (dumpSha !== env.PAIRED_POSTGRES_SHA256) throw new Error(`paired dump sha256 ${dumpSha} does not match ${env.PAIRED_POSTGRES_SHA256}`);
    log(`paired dump verified run=${env.PAIRED_POSTGRES_RUN_ID} sha256=${dumpSha}`);

    let skipped = 0;
    const entries = sortEntries(roots.flatMap((root) => listRoot(root, { onSkip: () => { skipped += 1; } })));
    log(`listed ${entries.length} file(s) across ${roots.length} root(s); skipped ${skipped} transient file(s)`);

    const copy = execFileSync("pg_restore", ["--data-only", ...BLOB_TABLES.flatMap((t) => ["--table", t.table]), "--file", "-", env.PAIRED_POSTGRES_DUMP],
      { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
    const dumpRows = parseBlobRowsFromCopy(copy);
    const deletedAfterSnapshot = await reconcileBlobRows({
      dumpRows,
      entries,
      blobRootName,
      liveRowExists: liveRowExistsViaDocker({
        container: env.DPF_PRODUCTION_DB_CONTAINER ?? "dpf-postgres-1",
        user: env.POSTGRES_USER ?? "dpf",
        db: env.POSTGRES_DB ?? "dpf",
      }),
    });
    log(`reconciled ${dumpRows.length} blob row(s); ${deletedAfterSnapshot.length} deleted after the snapshot`);

    const result = writeArchive({ entries, tarPath: join(targetDir, "uploads.tar"), ndjsonPath: join(targetDir, "files.ndjson") });
    writeFileSync(join(targetDir, "uploads.tar.sha256"), `${result.archiveSha256}  uploads.tar\n`, { mode: 0o600, flag: "wx" });
    const finishedAt = new Date();
    const manifest = buildManifest({
      roots,
      pairedPostgresRunId: env.PAIRED_POSTGRES_RUN_ID,
      pairedPostgresSha256: dumpSha,
      ...result,
      deletedAfterSnapshot,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    });
    writeFileSync(join(targetDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    log(`manifest written files=${result.fileCount} bytes=${result.totalBytes} sha256=${result.archiveSha256}`);
    log("ok");
    flushLog();
  } catch (error) {
    log(`failed: ${error.message}`);
    for (const f of ["uploads.tar", "uploads.tar.sha256", "files.ndjson", "manifest.json"]) rmSync(join(targetDir, f), { force: true });
    flushLog();
    throw Object.assign(error, { exitCode: error.exitCode ?? (error instanceof RefusalError ? 3 : 4) });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`BACKUP_UPLOADS_FAILED: ${error.message}`);
    process.exit(error.exitCode ?? 4);
  });
}
