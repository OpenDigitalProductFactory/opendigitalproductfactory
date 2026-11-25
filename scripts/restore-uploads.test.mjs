import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";

import { buildManifest, serializeManifest, writeArchive } from "./backup-uploads.mjs";
import { verifyUploadsRun as verify, verifyUploadsTrial as trial } from "./restore-uploads.mjs";

const directories = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(files = [["a-é", Buffer.alloc(1024 ** 2 + 17, 0x61)], ["b", Buffer.alloc(0)]]) {
  const runDir = mkdtempSync(join(realpathSync(tmpdir()), "dpf-upload-restore-"));
  directories.push(runDir);
  const archivePath = join(runDir, "uploads.tar");
  const listPath = join(runDir, "files.ndjson");
  const manifestPath = join(runDir, "manifest.json");
  const checksumPath = join(runDir, "uploads.tar.sha256");
  const pairedPostgresRunId = "fixture-postgres";
  const pairedPostgresSha256 = sha256("only a fixture");
  const entries = files.map(([path, content], index) => {
    const abs = join(runDir, `fixture-payload-${index}`);
    writeFileSync(abs, content);
    return { root: "upload-store", path, abs, size: content.length };
  });
  const output = writeArchive({ entries, tarPath: archivePath, ndjsonPath: listPath });
  const manifest = buildManifest({
    roots: [{ name: "upload-store", path: "/source-install-only", resolvedFrom: "env" }],
    pairedPostgresRunId, pairedPostgresSha256,
    ...output,
    deletedAfterSnapshot: [],
    startedAt: "2026-11-24T12:00:00.000Z",
    finishedAt: "2026-11-24T12:00:01.000Z",
    durationMs: 1000,
  });
  const bind = () => {
    manifest.archiveSha256 = sha256(readFileSync(archivePath));
    manifest.filesManifestSha256 = sha256(readFileSync(listPath));
    const encoded = serializeManifest(manifest);
    writeFileSync(manifestPath, encoded);
    writeFileSync(checksumPath, `${manifest.archiveSha256}  uploads.tar\n`);
    return {
      runDir,
      expected: {
        pairedPostgresRunId, pairedPostgresSha256,
        archiveSha256: manifest.archiveSha256,
        manifestSha256: sha256(encoded),
      },
    };
  };
  return { archivePath, listPath, manifestPath, checksumPath, manifest, bind, args: bind() };
}

it("verifies the exact writer format, including multi-read data and empty files", async () => {
  const f = fixture();
  const seen = [];
  const completed = await verify({ ...f.args, onEntry: (entry) => seen.push(entry) });
  assert.equal(completed.fileCount, 2);
  assert.equal(completed.totalBytes, 1024 ** 2 + 17);
  assert.deepEqual(completed.rootNames, ["upload-store"]);
  assert.deepEqual(seen.map(({ path, sizeBytes }) => [path, sizeBytes]),
    [["a-é", 1024 ** 2 + 17], ["b", 0]]);
  assert.ok(!JSON.stringify(completed).includes("/source-install-only"));
});

it("does not disclose unverified inventory or payloads before an exact pair is admitted", async () => {
  const f = fixture();
  const observed = [];
  const args = { ...f.args, expected: { ...f.args.expected, pairedPostgresRunId: "different-dump" },
    onEntry: (entry) => observed.push(entry) };
  await assert.rejects(() => verify(args), /paired Postgres/i);
  assert.deepEqual(observed, []);
});

it("rejects a non-canonical ustar header even if the enclosing digests match", async () => {
  const f = fixture();
  const tar = readFileSync(f.archivePath);
  tar[156] = "2".charCodeAt(0);
  writeFileSync(f.archivePath, tar);
  await assert.rejects(() => verify(f.bind()), /ustar header/i);
});

it("rejects a reordered files.ndjson list with otherwise consistent outer digests", async () => {
  const f = fixture();
  const [one, two] = readFileSync(f.listPath, "utf8").trimEnd().split("\n");
  writeFileSync(f.listPath, `${two}\n${one}\n`);
  await assert.rejects(() => verify(f.bind()), /ustar header|member order/i);
});

it("rejects reordered ustar members even when the enclosing digest is captured", async () => {
  const f = fixture();
  const tar = readFileSync(f.archivePath);
  const firstEnd = 512 + Math.ceil((1024 ** 2 + 17) / 512) * 512;
  writeFileSync(f.archivePath, Buffer.concat([
    tar.subarray(firstEnd, firstEnd + 512), tar.subarray(0, firstEnd), tar.subarray(firstEnd + 512),
  ]));
  await assert.rejects(() => verify(f.bind()), /ustar header/i);
});

it("checks each payload hash independently of the enclosing archive and manifest digests", async () => {
  const f = fixture();
  const tar = readFileSync(f.archivePath);
  tar[512] ^= 1;
  writeFileSync(f.archivePath, tar);
  await assert.rejects(() => verify(f.bind()), /payload digest/i);
});

it("refuses bytes after two complete zero end blocks", async () => {
  const f = fixture();
  writeFileSync(f.archivePath, Buffer.concat([readFileSync(f.archivePath), Buffer.alloc(512)]));
  await assert.rejects(() => verify(f.bind()), /archive end/i);
});

it("refuses a linked artifact under a physical backup run directory", async () => {
  const f = fixture();
  const alias = `${f.listPath}.physical`;
  writeFileSync(alias, readFileSync(f.listPath));
  rmSync(f.listPath);
  symlinkSync(alias, f.listPath);
  await assert.rejects(() => verify(f.args), /files\.ndjson.*regular file/i);
});

it("rejects a checksum sidecar that disagrees with the captured archive digest", async () => {
  const f = fixture();
  writeFileSync(f.checksumPath, `${sha256("different archive")}  uploads.tar\n`);
  await assert.rejects(() => verify(f.args), /checksum sidecar/i);
});

it("checks manifest custody rather than trusting mutable deletion exceptions", async () => {
  const f = fixture();
  f.manifest.deletedAfterSnapshot.push({
    table: "DocumentBlob", id: "blob-fixture", root: "upload-store", path: "documents/sha256/ab/name",
  });
  writeFileSync(f.manifestPath, serializeManifest(f.manifest));
  await assert.rejects(() => verify(f.args), /manifest digest/i);
  const verified = await verify(f.bind());
  assert.deepEqual(verified.deletedAfterSnapshot, f.manifest.deletedAfterSnapshot);
});

const trialDoc = { table: "DocumentBlob", id: "doc-1", storageKey: "documents/sha256/ab/retained", sha256: sha256("doc") };
const trialMedia = { table: "MediaAsset", id: "media-1", storageKey: "media/sha256/ab/retained", sha256: sha256("media") };

it("checks both SQL blob types and reports only SQL-owned namespace orphans", async () => {
  const f = fixture([
    [trialDoc.storageKey, Buffer.from("doc")],
    ["media/sha256/ab/orphan", Buffer.from("orphan")],
    [trialMedia.storageKey, Buffer.from("media")],
    ["threads/attachment.pdf", Buffer.from("not a SQL blob")],
    ["voice/sample.wav", Buffer.from("not a SQL blob")],
  ]);
  const result = await trial({ ...f.args, rows: [trialDoc, trialMedia] });
  assert.equal(result.referencedCount, 2);
  assert.equal(result.deletedCount, 0);
  assert.equal(result.orphanCount, 1);
  assert.deepEqual(result.orphanPaths, ["media/sha256/ab/orphan"]);
});

it("fails trial on a missing or mismatched referenced file", async () => {
  const f = fixture([[trialDoc.storageKey, Buffer.from("doc")]]);
  await assert.rejects(() => trial({ ...f.args, rows: [trialDoc, trialMedia] }), /missing referenced.*media-1/i);
  await assert.rejects(() => trial({ ...f.args, rows: [{ ...trialDoc, sha256: sha256("different bytes") }] }),
    /referenced.*digest.*doc-1/i);
});

it("honors only custody-bound deletions matching the exact restored row and path", async () => {
  const f = fixture([[trialDoc.storageKey, Buffer.from("doc")]]);
  f.manifest.deletedAfterSnapshot = [
    { id: trialMedia.id, table: trialMedia.table, root: "upload-store", path: trialMedia.storageKey },
  ];
  const bound = f.bind();
  assert.equal((await trial({ ...bound, rows: [trialDoc, trialMedia] })).deletedCount, 1);
  await assert.rejects(() => trial({
    ...bound, rows: [trialDoc, { ...trialMedia, storageKey: "media/sha256/xy/somewhere-else" }],
  }), /deletion exception.*exact/i);
});
