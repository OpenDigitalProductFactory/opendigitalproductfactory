import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildManifest, serializeManifest, writeArchive } from "./backup-uploads.mjs";
import * as teardown from "./governed-teardown.mjs";
import {
  buildComposeDownArgs,
  canonical,
  removeTreeContentsNoFollow,
  validateDeletionRoots,
} from "./governed-teardown.mjs";

test("compose mutation stays project/file scoped and only destructive scopes delete volumes", () => {
  assert.deepEqual(
    buildComposeDownArgs({ composeProject: "dpf", composeFiles: ["docker-compose.yml", "docker-compose.windows.yml"], scope: "containers" }),
    ["compose", "--project-name", "dpf", "-f", "/install/docker-compose.yml", "-f", "/install/docker-compose.windows.yml", "down", "--remove-orphans"],
  );
  assert.deepEqual(
    buildComposeDownArgs({ composeProject: "dpf", composeFiles: ["docker-compose.yml"], scope: "everything" }).slice(-2),
    ["--remove-orphans", "--volumes"],
  );
});

test("deletion-root validation refuses broad and evidence-nested targets", () => {
  assert.throws(() => validateDeletionRoots({ installPath: "/", backupsPath: "/var/backups", installMount: "/install", evidenceMount: "/evidence" }), /unsafe_teardown_install_root/);
  assert.throws(() => validateDeletionRoots({ installPath: "/home/owner", backupsPath: "/var/backups", installMount: "/install", evidenceMount: "/evidence" }), /unsafe_teardown_install_root/);
  assert.throws(() => validateDeletionRoots({ installPath: "C:\\Users\\owner", backupsPath: "D:\\DPF-backups", installMount: "/install", evidenceMount: "/evidence" }), /unsafe_teardown_install_root/);
  assert.throws(() => validateDeletionRoots({ installPath: "/opt/dpf", backupsPath: "/opt/dpf/backups", installMount: "/install", evidenceMount: "/evidence" }), /teardown_evidence_inside_source/);
  assert.doesNotThrow(() => validateDeletionRoots({ installPath: "/opt/dpf", backupsPath: "/opt/dpf-backups", installMount: "/install", evidenceMount: "/evidence" }));
});

test("no-follow removal unlinks a link without touching its target", async () => {
  const root = await mkdtemp(join(tmpdir(), "dpf-teardown-root-"));
  const outside = await mkdtemp(join(tmpdir(), "dpf-teardown-outside-"));
  await writeFile(join(outside, "keep.txt"), "protected\n");
  await mkdir(join(root, "ordinary"));
  await writeFile(join(root, "ordinary", "delete.txt"), "gone\n");
  const linkPath = join(root, "linked-outside");
  await symlink(outside, linkPath, process.platform === "win32" ? "junction" : "dir");

  const receipt = await removeTreeContentsNoFollow(root);

  assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "protected\n");
  assert.equal(receipt.linksUnlinked, 1);
  assert.equal(receipt.filesDeleted, 1);
  assert.equal(receipt.directoriesDeleted, 1);
});

test("canonicalization is stable across object key order", () => {
  assert.equal(canonical({ z: 1, a: { d: 2, c: 3 } }), canonical({ a: { c: 3, d: 2 }, z: 1 }));
});

const fixtureClock = Date.UTC(2026, 10, 25, 12);
const secret = "disposable-teardown-signing-secret";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sign = (env) => createHmac("sha256", secret).update(canonical(env)).digest("hex");

async function pairedFixture(t) {
  const backups = await mkdtemp(join(await realpath(tmpdir()), "dpf-host-paired-fixture-"));
  t.after(() => rm(backups, { recursive: true, force: true }));
  const postgres = { runId: "pg-1", storagePath: "postgres/run-1", sha256: sha("PGDMP synthetic fixture") };
  const pgDir = join(backups, postgres.storagePath);
  await mkdir(pgDir, { recursive: true });
  const pg = join(pgDir, "dpf.dump");
  await writeFile(pg, "PGDMP synthetic fixture");
  await writeFile(join(pgDir, "dpf.dump.sha256"), `${postgres.sha256}  dpf.dump\n`);
  const uploadsPath = "uploads/run-1";
  const uploadDir = join(backups, uploadsPath);
  await mkdir(uploadDir, { recursive: true });
  const payload = join(backups, "fixture-payload");
  await writeFile(payload, "fixture");
  const tar = join(uploadDir, "uploads.tar");
  const ndjson = join(uploadDir, "files.ndjson");
  const archive = writeArchive({
    entries: [{ root: "upload-store", path: "fixture", abs: payload, size: 7 }], tarPath: tar, ndjsonPath: ndjson,
  });
  const manifest = serializeManifest(buildManifest({
    roots: [{ name: "upload-store", path: "/fixture/source", resolvedFrom: "env" }],
    pairedPostgresRunId: postgres.runId, pairedPostgresSha256: postgres.sha256,
    ...archive, deletedAfterSnapshot: [], startedAt: new Date(fixtureClock - 1000).toISOString(),
    finishedAt: new Date(fixtureClock).toISOString(), durationMs: 1000,
  }));
  await writeFile(join(uploadDir, "manifest.json"), manifest);
  await writeFile(join(uploadDir, "uploads.tar.sha256"), `${archive.archiveSha256}  uploads.tar\n`);
  const uploads = {
    runId: "uploads-1", storagePath: uploadsPath, sha256: archive.archiveSha256, manifestSha256: sha(manifest),
    pairedPostgresRunId: postgres.runId, pairedPostgresSha256: postgres.sha256,
  };
  await mkdir(join(backups, "uploads-custody"));
  const custody = join(backups, "uploads-custody", `${uploads.runId}.json`);
  await writeFile(custody, JSON.stringify({
    schemaVersion: 1, runId: uploads.runId, storagePath: uploads.storagePath,
    archiveSha256: uploads.sha256, manifestSha256: uploads.manifestSha256,
    pairedPostgresRunId: postgres.runId, pairedPostgresSha256: postgres.sha256,
  }));
  const receipt = { schemaVersion: 2, postgres, uploads };
  const trial = { status: "ok", restoreId: "trial-1", postgresRunId: postgres.runId, postgresSha256: postgres.sha256,
    uploadsRunId: uploads.runId, uploadsSha256: uploads.sha256, uploadsManifestSha256: uploads.manifestSha256 };
  const envelope = {
    schemaVersion: 2, kind: "installation-teardown", runId: "TDR-FIXTUREA", scope: "volumes",
    actorRef: "fixture-operator", issuedAt: new Date(fixtureClock - 1000).toISOString(),
    expiresAt: new Date(fixtureClock + 240_000).toISOString(),
    installPath: "/fixture/install", backupsPath: backups, composeProject: "dpf-fixture",
    composeFiles: ["docker-compose.yml"], previewDigest: sha("preview"), salvageDigest: sha("salvage"),
    confirmation: { mode: "pointer-hold", challengeId: sha("challenge"), heldForMs: 2500 },
    recovery: { receipt, trial },
  };
  const evidence = join(backups, "teardown", envelope.runId);
  const commands = [];
  return {
    backups, envelope, evidence, pg, tar, ndjson, custody, commands,
    execute(env = envelope, signature = sign(env), overrides = {}) {
      assert.equal(typeof teardown.createTeardownRunner, "function");
      const run = teardown.createTeardownRunner({
        evidenceMount: backups, waitForPortal: async () => {},
        invokeDocker: async (args) => {
          commands.push(args);
          assert.deepEqual(JSON.parse(await readFile(join(evidence, "plan.json"), "utf8")).envelope.recovery, env.recovery);
          return { stdout: "", stderr: "" };
        },
        ...overrides,
      });
      return run({ envelope: env, signature, secret, now: () => fixtureClock });
    },
  };
}

test("advertises paired teardown only when the verifier closure is available", async () => {
  const expected = { schemaVersion: 1, pairedVolumeTeardown: true };
  assert.deepEqual(await teardown.getTeardownCapabilities(), expected);
  assert.deepEqual(await teardown.getTeardownCapabilities({
    loadRecoveryGuard: async () => { throw Object.assign(new Error("missing reader"), { code: "ERR_MODULE_NOT_FOUND" }); },
  }), { ...expected, pairedVolumeTeardown: false });
});

test("a signed and verified exact pair leaves external locators and runs only the scoped fake command", async (t) => {
  const f = await pairedFixture(t);
  const result = await f.execute();
  assert.equal(result.status, "completed");
  assert.equal(result.schemaVersion, 2);
  assert.deepEqual(result.recovery, f.envelope.recovery);
  assert.deepEqual(f.commands, [["compose", "--project-name", "dpf-fixture", "-f", "/install/docker-compose.yml", "down", "--remove-orphans", "--volumes"]]);
  assert.deepEqual(JSON.parse(await readFile(join(f.evidence, "evidence.json"), "utf8")).recovery, f.envelope.recovery);
});

test("keeps the legacy containers-only handoff usable when paired proof assets are absent", async (t) => {
  const f = await pairedFixture(t);
  const envelope = { ...f.envelope, schemaVersion: 1, scope: "containers",
    confirmation: { mode: "non-destructive" }, recovery: null };
  const result = await f.execute(envelope, sign(envelope), {
    loadRecoveryGuard: async () => assert.fail("a containers-only handoff needs no paired assets"),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.schemaVersion, 1);
  assert.equal(f.commands.length, 1);
  assert.ok(!f.commands[0].includes("--volumes"));
});

test("no signature or no verifier means no evidence writes and no Docker request", async (t) => {
  const f = await pairedFixture(t);
  await assert.rejects(() => f.execute(f.envelope, "0".repeat(64), {
    loadRecoveryGuard: async () => assert.fail("invalid signatures fail before loading the verifier"),
  }), /teardown_signature_invalid/);
  await assert.rejects(() => f.execute(f.envelope, sign(f.envelope), {
    loadRecoveryGuard: async () => { throw new Error("unstaged"); },
  }), /teardown_paired_recovery_guard_unavailable/);
  await assert.rejects(() => access(f.evidence), { code: "ENOENT" });
  assert.deepEqual(f.commands, []);
});

for (const [name, change, expected] of [
  ["old volume plan", (f) => { f.envelope.schemaVersion = 1; }, /teardown_paired_recovery_required/],
  ["different trial member", (f) => { f.envelope.recovery.trial.uploadsRunId = "wrong"; }, /teardown_paired_trial_mismatch/],
  ["changed dump bytes", (f) => writeFile(f.pg, "tampered dump"), /teardown_postgres_dump_mismatch/],
  ["changed file inventory", (f) => writeFile(f.ndjson, ""), /teardown_upload_archive_unverified/],
  ["missing custody", (f) => rm(f.custody), /teardown_upload_custody_invalid/],
  ["changed custody", async (f) => {
    const changed = JSON.parse(await readFile(f.custody, "utf8"));
    await writeFile(f.custody, JSON.stringify({ ...changed, pairedPostgresRunId: "wrong" }));
  }, /teardown_upload_custody_invalid/],
  ["symlinked Postgres artifact", async (f) => {
    const target = join(f.backups, "unmanaged-dump");
    await writeFile(target, "PGDMP synthetic fixture");
    await rm(f.pg);
    await symlink(target, f.pg, "file");
  }, /teardown_postgres_dump_unverified/],
]) {
  test(`refuses ${name} before writing a plan or calling Docker`, async (t) => {
    const f = await pairedFixture(t);
    await change(f);
    await assert.rejects(async () => f.execute(), expected);
    await assert.rejects(() => access(f.evidence), { code: "ENOENT" });
    assert.deepEqual(f.commands, []);
  });
}
