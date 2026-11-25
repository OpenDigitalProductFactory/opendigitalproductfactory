import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHIVE_FORMAT,
  RefusalError,
  UPLOAD_BACKUP_LIMITS,
  buildManifest,
  listRoot,
  parseBlobRowsFromCopy,
  reconcileBlobRows,
  serializeManifest,
  sortEntries,
  splitUstarName,
  ustarHeader,
  validateRoots,
  writeArchive,
} from "./backup-uploads.mjs";

const scratch = mkdtempSync(join(tmpdir(), "backup-uploads-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const freshDir = () => {
  const dir = join(scratch, `case-${++n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const put = (root, rel, content) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), content);
};
const sha = (b) => createHash("sha256").update(b).digest("hex");
const writerPath = fileURLToPath(new URL("./backup-uploads.mjs", import.meta.url));

function runWriter(root, parent) {
  const dump = join(parent, "synthetic.dump");
  const target = join(parent, "run");
  writeFileSync(dump, "synthetic dump bytes");
  const result = spawnSync(process.execPath, [writerPath], {
    encoding: "utf8",
    env: {
      TARGET_DIR: target,
      DPF_UPLOAD_ROOTS: JSON.stringify([{ name: "upload-store", path: root, resolvedFrom: "env" }]),
      PAIRED_POSTGRES_RUN_ID: "synthetic-run",
      PAIRED_POSTGRES_DUMP: dump,
      PAIRED_POSTGRES_SHA256: sha("synthetic dump bytes"),
      // Refusals under test happen before pg_restore. Never call a real database.
      PATH: parent,
    },
  });
  return { ...result, target };
}

/** A strict ustar reader, the way the receiving side reads the archive. */
function readUstar(buf) {
  const members = [];
  let off = 0;
  for (;;) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) {
      assert.ok(buf.subarray(off + 512, off + 1024).every((b) => b === 0), "two zero blocks end the archive");
      assert.equal(off + 1024, buf.length, "nothing after the end blocks");
      return members;
    }
    assert.equal(h.toString("ascii", 257, 263), "ustar\0", "ustar magic");
    assert.equal(h.toString("ascii", 263, 265), "00", "ustar version");
    assert.equal(h.toString("ascii", 156, 157), "0", "regular file typeflag");
    assert.equal(h.toString("ascii", 100, 124), "0000644\x000000000\x000000000\x00", "mode, uid, and gid");
    assert.equal(h.toString("ascii", 136, 148), "00000000000\0", "mtime");
    assert.ok(h.subarray(265, 345).every((b) => b === 0), "empty owner names and device fields");
    assert.ok(h.subarray(500, 512).every((b) => b === 0), "reserved bytes");
    const stored = parseInt(h.toString("ascii", 148, 154), 8);
    const copy = Buffer.from(h);
    copy.fill(0x20, 148, 156);
    assert.equal(copy.reduce((s, b) => s + b, 0), stored, "header checksum");
    const cstr = (a, b) => h.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
    const prefix = cstr(345, 500);
    const name = prefix ? `${prefix}/${cstr(0, 100)}` : cstr(0, 100);
    const size = parseInt(h.toString("ascii", 124, 135), 8);
    const data = buf.subarray(off + 512, off + 512 + size);
    members.push({ name, size, sha256: sha(data) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
}

describe("validateRoots", () => {
  it("accepts safe distinct roots and sorts them by name", () => {
    const roots = validateRoots([
      { name: "voice", path: "/srv/voice", resolvedFrom: "env" },
      { name: "upload-store", path: "/srv/uploads", resolvedFrom: "platform-config" },
    ]);
    assert.deepEqual(roots.map((r) => r.name), ["upload-store", "voice"]);
  });
  it("refuses nested or coinciding roots, unsafe names and duplicates", () => {
    assert.throws(() => validateRoots([
      { name: "upload-store", path: "/srv/uploads", resolvedFrom: "env" },
      { name: "voice", path: "/srv/uploads/voice", resolvedFrom: "env" },
    ]), /nest or coincide/);
    assert.throws(() => validateRoots([
      { name: "a", path: "/srv/x", resolvedFrom: "env" },
      { name: "b", path: "/srv/x", resolvedFrom: "env" },
    ]), /nest or coincide/);
    assert.throws(() => validateRoots([{ name: "Upload Store", path: "/srv/x", resolvedFrom: "env" }]), /root name/);
    assert.throws(() => validateRoots([
      { name: "a", path: "/srv/x", resolvedFrom: "env" },
      { name: "a", path: "/srv/y", resolvedFrom: "env" },
    ]), /duplicate/);
  });
});

describe("ustar encoding", () => {
  it("splits a long name into prefix and name", () => {
    const long = `upload-store/documents/sha256/ab/cd/${"a".repeat(70)}`;
    const { name, prefix } = splitUstarName(long);
    assert.ok(Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155);
    assert.equal(`${prefix}/${name}`, long);
  });
  it("refuses a path that cannot fit instead of widening the format", () => {
    assert.throws(() => splitUstarName(`r/${"x".repeat(101)}`), RefusalError);
    assert.throws(() => ustarHeader(`r/${"y".repeat(160)}/${"z".repeat(101)}`, 1), RefusalError);
  });
});

describe("listRoot", () => {
  it("lists regular files, skips writers' transient files", () => {
    const root = freshDir();
    put(root, "documents/sha256/aa/bb/aabb", "doc");
    put(root, "thread-1/0b5c2f7a-1111-4222-8333-944455556666.pdf", "att");
    put(root, "documents/sha256/aa/bb/.aabb.123.0b5c2f7a-1111-4222-8333-944455556666.tmp", "partial");
    const skipped = [];
    const files = listRoot({ name: "upload-store", path: root }, { onSkip: (p) => skipped.push(p) });
    assert.deepEqual(files.map((f) => f.path).sort(), ["documents/sha256/aa/bb/aabb", "thread-1/0b5c2f7a-1111-4222-8333-944455556666.pdf"]);
    assert.equal(skipped.length, 1);
  });
  it("refuses a symlink and a hard link", () => {
    const root = freshDir();
    put(root, "a.txt", "a");
    symlinkSync(join(root, "a.txt"), join(root, "link.txt"));
    assert.throws(() => listRoot({ name: "r", path: root }), /symlink/);
    const root2 = freshDir();
    put(root2, "b.txt", "b");
    linkSync(join(root2, "b.txt"), join(root2, "c.txt"));
    assert.throws(() => listRoot({ name: "r", path: root2 }), /hard link/);
  });
  it("treats a missing root as empty", () => {
    assert.deepEqual(listRoot({ name: "r", path: join(scratch, "does-not-exist") }), []);
  });
  it("keeps a valid UTF-8 replacement character in a filename", () => {
    const root = freshDir();
    put(root, "valid-\uFFFD.txt", "bytes");
    assert.equal(listRoot({ name: "r", path: root })[0].path, "valid-\uFFFD.txt");
  });
  it("refuses a raw non-UTF-8 Linux name before path lookup and exits 3", { skip: process.platform !== "linux" }, () => {
    const root = freshDir();
    const name = Buffer.from([0x62, 0x61, 0x64, 0xff]);
    mkdirSync(join(root, "nested"));
    writeFileSync(Buffer.concat([Buffer.from(join(root, "nested") + "/"), name]), "no");
    const result = runWriter(root, freshDir());
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, /non-UTF-8.*upload-store\/nested.*626164ff/);
    assert.deepEqual(readdirSync(result.target), ["log.txt"]);
  });
});

describe("writeArchive", () => {
  it("writes members in files.ndjson order and a strict reader verifies every one", () => {
    const root = freshDir();
    const voice = freshDir();
    put(root, "documents/sha256/aa/bb/aabb", "document bytes");
    put(root, "thread-9/0b5c2f7a-1111-4222-8333-944455556666.png", Buffer.alloc(1024 ** 2 + 1300, 7));
    put(voice, "voice/2026/a.mp3", "audio");
    const entries = sortEntries([
      ...listRoot({ name: "voice", path: voice }),
      ...listRoot({ name: "upload-store", path: root }),
    ]);
    const out = freshDir();
    const result = writeArchive({ entries, tarPath: join(out, "uploads.tar"), ndjsonPath: join(out, "files.ndjson") });
    const ndjson = readFileSync(join(out, "files.ndjson"), "utf8");
    assert.ok(ndjson.endsWith("\n") && !ndjson.includes("\n\n"));
    const lines = ndjson.trimEnd().split("\n").map((l) => JSON.parse(l));
    for (const l of lines) assert.deepEqual(Object.keys(l), ["root", "path", "sha256", "sizeBytes"]);
    const members = readUstar(readFileSync(join(out, "uploads.tar")));
    assert.deepEqual(members.map((m) => m.name), lines.map((l) => `${l.root}/${l.path}`));
    assert.deepEqual(members.map((m) => [m.size, m.sha256]), lines.map((l) => [l.sizeBytes, l.sha256]));
    assert.equal(result.fileCount, 3);
    assert.equal(result.totalBytes, lines.reduce((s, l) => s + l.sizeBytes, 0));
    assert.equal(result.archiveSha256, sha(readFileSync(join(out, "uploads.tar"))));
    assert.equal(result.filesManifestSha256, sha(ndjson));
    assert.deepEqual(lines.map((l) => l.root), ["upload-store", "upload-store", "voice"]);
  });
  it("writes a zero-byte files.ndjson for an empty store", () => {
    const out = freshDir();
    const result = writeArchive({ entries: [], tarPath: join(out, "uploads.tar"), ndjsonPath: join(out, "files.ndjson") });
    assert.equal(readFileSync(join(out, "files.ndjson")).length, 0);
    assert.equal(result.fileCount, 0);
    assert.deepEqual(readUstar(readFileSync(join(out, "uploads.tar"))), []);
  });
  it("refuses a file that changed size between listing and reading", () => {
    const root = freshDir();
    put(root, "a", "three");
    const entries = listRoot({ name: "r", path: root });
    put(root, "a", "four");
    const out = freshDir();
    assert.throws(() => writeArchive({ entries, tarPath: join(out, "uploads.tar"), ndjsonPath: join(out, "files.ndjson") }), /changed size/);
  });
  it("refuses when headers, padding, and the trailer push the archive over 1 TiB, without reading the payloads", () => {
    const out = freshDir();
    // Each payload fits the 11-octal-digit ustar size field. Exactly 1 TiB of
    // rounded payload would fit alone, but the headers and trailer would not.
    const entries = Array.from({ length: 128 }, (_, i) => ({
      root: "r", path: String(i), abs: "/not-a-real-upload", size: 0o77777777777,
    }));
    assert.throws(() => writeArchive({ entries, tarPath: join(out, "uploads.tar"), ndjsonPath: join(out, "files.ndjson") }),
      { name: "RefusalError", message: /uploads\.tar.*1 TiB/ });
    assert.deepEqual(readdirSync(out), []);
  });
  it("refuses a files.ndjson line over 64 KiB", () => {
    const out = freshDir();
    const entries = [{ root: "r", path: "é".repeat(32 * 1024), abs: "/not-a-real-upload", size: 0 }];
    assert.throws(() => writeArchive({ entries, tarPath: join(out, "uploads.tar"), ndjsonPath: join(out, "files.ndjson") }),
      { name: "RefusalError", message: /files\.ndjson.*line.*64 KiB/ });
    assert.deepEqual(readdirSync(out), []);
  });
  it("counts encoded bytes and each LF toward the files.ndjson total and admits exact limits", () => {
    const root = freshDir();
    put(root, "é", "a");
    const entries = listRoot({ name: "r", path: root });
    const bytes = Buffer.byteLength(JSON.stringify({ root: "r", path: "é", sha256: sha("a"), sizeBytes: 1 }) + "\n");
    const out = freshDir();
    const args = { entries, tarPath: join(out, "uploads.tar"), ndjsonPath: join(out, "files.ndjson") };
    assert.throws(() => writeArchive({ ...args, limits: { ndjsonBytes: bytes - 1 } }),
      { name: "RefusalError", message: /files\.ndjson.*1 GiB/ });
    assert.throws(() => writeArchive({ ...args, limits: { archiveBytes: 2047 } }),
      { name: "RefusalError", message: /uploads\.tar.*1 TiB/ });
    assert.deepEqual(readdirSync(out), []);
    writeArchive({ ...args, limits: { ndjsonBytes: bytes, ndjsonLineBytes: bytes - 1, archiveBytes: 2048 } });
    assert.equal(readFileSync(args.ndjsonPath).length, bytes);
    assert.equal(readFileSync(args.tarPath).length, 2048);
  });
});

it("uses the agreed DPF2 limits, including the 1 GiB NDJSON cap", () => {
  assert.deepEqual(UPLOAD_BACKUP_LIMITS, {
    manifestBytes: 16 * 1024 ** 2,
    ndjsonLineBytes: 64 * 1024,
    ndjsonBytes: 1024 ** 3,
    archiveBytes: 1024 ** 4,
  });
});

it("refuses manifest.json over 16 MiB and admits exactly 16 MiB, including the LF", () => {
  const limit = 16 * 1024 * 1024;
  const overhead = Buffer.byteLength(JSON.stringify({ payload: "" }, null, 2) + "\n");
  const payload = "é".repeat(Math.floor((limit - overhead) / 2)) + "x".repeat((limit - overhead) % 2);
  assert.equal(Buffer.byteLength(serializeManifest({ payload })), limit);
  assert.throws(() => serializeManifest({ payload: payload + "x" }),
    { name: "RefusalError", message: /manifest\.json.*16 MiB/ });
});

describe("reconcile with the paired dump", () => {
  const copy = [
    'COPY public."DocumentBlob" (id, sha256, "storageKey", "mimeType", "sizeBytes", "createdAt") FROM stdin;',
    "blob-kept\taabb\tdocuments/sha256/aa/bb/aabb\t\\N\t3\t2026-11-24 00:00:00",
    "blob-gone\tccdd\tdocuments/sha256/cc/dd/ccdd\t\\N\t3\t2026-11-24 00:00:00",
    "\\.",
    'COPY public."MediaAsset" (id, "organizationId", sha256, "storageKey") FROM stdin;',
    "media-live\torg\teeff\tmedia/sha256/ee/ff/eeff",
    "\\.",
  ].join("\n");
  const entries = [{ root: "upload-store", path: "documents/sha256/aa/bb/aabb" }];

  it("parses blob rows from a pg_restore data-only stream", () => {
    assert.deepEqual(parseBlobRowsFromCopy(copy), [
      { table: "DocumentBlob", id: "blob-kept", storageKey: "documents/sha256/aa/bb/aabb" },
      { table: "DocumentBlob", id: "blob-gone", storageKey: "documents/sha256/cc/dd/ccdd" },
      { table: "MediaAsset", id: "media-live", storageKey: "media/sha256/ee/ff/eeff" },
    ]);
  });
  it("records a row deleted after the snapshot", async () => {
    const rows = parseBlobRowsFromCopy(copy).filter((r) => r.table === "DocumentBlob");
    const deleted = await reconcileBlobRows({ dumpRows: rows, entries, blobRootName: "upload-store", liveRowExists: async () => false });
    assert.deepEqual(deleted, [{ table: "DocumentBlob", id: "blob-gone", root: "upload-store", path: "documents/sha256/cc/dd/ccdd" }]);
  });
  it("refuses a live row whose file is missing", async () => {
    await assert.rejects(
      reconcileBlobRows({ dumpRows: parseBlobRowsFromCopy(copy), entries, blobRootName: "upload-store", liveRowExists: async (t) => t === "MediaAsset" }),
      /live MediaAsset media-live has no file/,
    );
  });
});

describe("buildManifest", () => {
  it("carries exactly the agreed keys in order", () => {
    const m = buildManifest({
      roots: [{ name: "upload-store", path: "/srv/uploads", resolvedFrom: "env", extra: 1 }],
      pairedPostgresRunId: "run", pairedPostgresSha256: "d", fileCount: 0, totalBytes: 0,
      archiveSha256: "a", filesManifestSha256: "f", deletedAfterSnapshot: [],
      startedAt: "s", finishedAt: "f", durationMs: 1,
    });
    assert.deepEqual(Object.keys(m), ["schemaVersion", "target", "roots", "pairedPostgresRunId", "pairedPostgresSha256", "fileCount", "totalBytes", "archiveSha256", "filesManifestSha256", "deletedAfterSnapshot", "startedAt", "finishedAt", "durationMs", "archiveFormat"]);
    assert.deepEqual(Object.keys(m.roots[0]), ["name", "path", "resolvedFrom"]);
    assert.equal(m.archiveFormat, ARCHIVE_FORMAT);
  });
});
