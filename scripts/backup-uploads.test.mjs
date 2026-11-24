import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  ARCHIVE_FORMAT,
  RefusalError,
  buildManifest,
  listRoot,
  parseBlobRowsFromCopy,
  reconcileBlobRows,
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
});

describe("writeArchive", () => {
  it("writes members in files.ndjson order and a strict reader verifies every one", () => {
    const root = freshDir();
    const voice = freshDir();
    put(root, "documents/sha256/aa/bb/aabb", "document bytes");
    put(root, "thread-9/0b5c2f7a-1111-4222-8333-944455556666.png", Buffer.alloc(1300, 7));
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
    const out = freshDir();
    const entries = [{ root: "r", path: "a", abs: "/ignored", size: 3 }];
    assert.throws(() => writeArchive({ entries, tarPath: join(out, "uploads.tar"), ndjsonPath: join(out, "files.ndjson"), readFile: () => Buffer.from("four") }), /changed size/);
  });
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
