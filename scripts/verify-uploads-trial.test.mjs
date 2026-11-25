import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, it } from "node:test";
import { buildManifest, serializeManifest, writeArchive } from "./backup-uploads.mjs";

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const program = fileURLToPath(new URL("./verify-uploads-trial.mjs", import.meta.url));
const shell = fileURLToPath(new URL("./postgres-trial-restore.sh", import.meta.url));
const doc = { table: "DocumentBlob", id: "doc-1", storageKey: "documents/sha256/ab/doc", sha256: sha("document") };
const media = { table: "MediaAsset", id: "media-1", storageKey: "media/sha256/ab/removed", sha256: sha("old") };

function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "dpf-paired-trial-cli-"));
  dirs.push(dir);
  const members = [[doc.storageKey, "document"], ["media/sha256/cd/orphan", "newer"], ["threads/file.txt", "attachment"]];
  const entries = members.map(([path, contents], i) => {
    const abs = join(dir, `data-${i}`);
    writeFileSync(abs, contents);
    return { root: "upload-store", path, abs, size: Buffer.byteLength(contents) };
  });
  const summary = writeArchive({ entries, tarPath: join(dir, "uploads.tar"), ndjsonPath: join(dir, "files.ndjson") });
  const stamp = "2026-11-24T10:00:00.000Z";
  const manifest = serializeManifest(buildManifest({
    ...summary, roots: [{ name: "upload-store", path: "/not-the-trial-root", resolvedFrom: "env" }],
    pairedPostgresRunId: "pg-fixture", pairedPostgresSha256: sha("dump"),
    startedAt: stamp, finishedAt: stamp, durationMs: 0,
    deletedAfterSnapshot: [{ table: media.table, id: media.id, root: "upload-store", path: media.storageKey }],
  }));
  writeFileSync(join(dir, "manifest.json"), manifest);
  writeFileSync(join(dir, "uploads.tar.sha256"), `${summary.archiveSha256}  uploads.tar\n`);
  return {
    DPF_PAIRED_TRIAL_UPLOADS_DIR: dir,
    DPF_PAIRED_TRIAL_UPLOADS_RUN_ID: "uploads-fixture",
    DPF_PAIRED_TRIAL_UPLOADS_SHA256: summary.archiveSha256,
    DPF_PAIRED_TRIAL_MANIFEST_SHA256: sha(manifest),
    DPF_PAIRED_TRIAL_POSTGRES_RUN_ID: "pg-fixture",
    DPF_PAIRED_TRIAL_POSTGRES_SHA256: sha("dump"),
  };
}

function check(env, rows = [doc, media]) {
  const input = rows.map((row) => JSON.stringify(row) + "\n").join("");
  return spawnSync(process.execPath, [program], { env, input, encoding: "utf8" });
}

it("returns exact paired trial evidence and distinguishes SQL orphans from unrelated files", () => {
  const result = check(fixture());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^UPLOADS_TRIAL /u);
  assert.deepEqual(JSON.parse(result.stdout.slice("UPLOADS_TRIAL ".length)), {
    postgresRunId: "pg-fixture", uploadsRunId: "uploads-fixture",
    referencedCount: 2, deletedCount: 1, orphanCount: 1, orphanPaths: ["media/sha256/cd/orphan"],
  });
});

it("does not emit evidence for untrusted custody, a different exact deletion or a missing/mismatched reference", () => {
  const env = fixture();
  for (const [provided, rows, reason] of [
    [{ ...env, DPF_PAIRED_TRIAL_MANIFEST_SHA256: sha("another manifest") }, [doc, media], /custody/i],
    [env, [doc, { ...media, id: "other-row" }], /deletion exception/i],
    [env, [doc, media, { ...doc, id: "other-doc", storageKey: "documents/sha256/ff/missing" }], /missing referenced/i],
    [env, [{ ...doc, sha256: sha("wrong") }, media], /digest/i],
  ]) {
    const result = check(provided, rows);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, reason);
  }
});

it("tries paired verification after pg_restore and before dropping the disposable database", { skip: process.platform !== "linux" }, () => {
  const paired = fixture();
  const dir = paired.DPF_PAIRED_TRIAL_UPLOADS_DIR;
  const bin = join(dir, "bin");
  const events = join(dir, "events");
  const rows = join(dir, "rows.ndjson");
  mkdirSync(bin);
  writeFileSync(rows, [doc, media].map((row) => JSON.stringify(row) + "\n").join(""));
  writeFileSync(join(dir, "fixture.dump"), "dump");
  writeFileSync(join(bin, "docker"), `#!/bin/sh
set -eu
case "$*" in
  *pg_restore*) cat >/dev/null; printf 'restore\\n' >> "$EVENTS";;
  *'FROM pg_database'*) ;;
  *'CREATE DATABASE'*) printf 'create\\n' >> "$EVENTS";;
  *'DROP DATABASE'*) printf 'drop\\n' >> "$EVENTS";;
  *'SELECT count('* ) printf '1\\n';;
  *'json_build_object'*) printf 'query\\n' >> "$EVENTS"; [ "$FIXTURE_PSQL_FAIL" = 0 ]; cat "$ROWS";;
  *) exit 99;;
esac
`, { mode: 0o700 });
  const run = (fail) => spawnSync("/bin/sh", [shell], { encoding: "utf8", env: {
    ...paired, PATH: `${bin}:${process.env.PATH}`, EVENTS: events, ROWS: rows,
    FIXTURE_PSQL_FAIL: fail ? "1" : "0", DUMP_PATH: join(dir, "fixture.dump"), ASSERT_TABLES: "FixtureTable",
    DPF_PRODUCTION_DB_CONTAINER: "discardable-fixture", LOG_PATH: join(dir, "trial.log"),
  } });
  const success = run(false);
  assert.equal(success.status, 0, success.stderr + success.stdout);
  assert.match(success.stdout, /^UPLOADS_TRIAL .*"uploadsRunId":"uploads-fixture"/m);
  assert.equal(readFileSync(events, "utf8"), "create\nrestore\nquery\ndrop\n");
  writeFileSync(events, "");
  const failed = run(true);
  assert.notEqual(failed.status, 0);
  assert.doesNotMatch(failed.stdout, /^UPLOADS_TRIAL |^RESULT ok /m);
  assert.match(failed.stdout, /^RESULT failed .*uploads-trial/m);
  assert.equal(readFileSync(events, "utf8"), "create\nrestore\nquery\ndrop\n");
  writeFileSync(events, "");
  writeFileSync(join(dir, "fixture.dump"), "different dump");
  const wrongDump = run(false);
  assert.notEqual(wrongDump.status, 0);
  assert.match(wrongDump.stdout, /paired trial dump digest changed/u);
  assert.equal(readFileSync(events, "utf8"), "");
});
