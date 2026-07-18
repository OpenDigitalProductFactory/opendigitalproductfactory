import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertSafeHarnessConfig,
  cleanupHarness,
  cleanupProject,
  createHarnessWorkspace,
  githubJson,
  installCleanupHandlers,
  runNMinusOneUpgrade,
  classifyUpgradeProtocolFloor,
  verifyBaseRevision,
} from "./test-n-minus-one-upgrade.mjs";

test("GitHub client authenticates and follows pagination", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(url.includes("page=2") ? [{ name: "Build", commit: { sha: "abc" } }] : []), {
      headers: { link: url.includes("page=2") ? "" : '<https://api.github.test/page=2>; rel="next"' },
    });
  };
  const rows = await githubJson("https://api.github.test/page=1", { token: "secret", fetchImpl, paginate: true });
  assert.equal(rows.length, 1);
  assert.equal(calls[0].init.headers.authorization, "Bearer secret");
});

test("project cleanup only removes resources carrying the unique project label", async () => {
  const calls = [];
  const run = async (_command, args) => {
    calls.push(args);
    if (args[0] === "ps") return { stdout: "container-1\n" };
    if (args[0] === "volume" && args[1] === "ls") return { stdout: "dpf-n1-safe_postgres\n" };
    return { stdout: "" };
  };
  await cleanupProject("dpf-n1-safe", run);
  assert.ok(calls.every((args) => !args.includes("dpf")));
  await assert.rejects(() => cleanupProject("dpf", run), /unique non-dpf/);
});

test("signal and exit handlers share an idempotent safe cleanup", async () => {
  const handlers = new Map();
  let cleanups = 0;
  installCleanupHandlers({ once: (name, fn) => handlers.set(name, fn) }, async () => { cleanups += 1; });
  assert.deepEqual([...handlers.keys()].sort(), ["SIGINT", "SIGTERM", "beforeExit"]);
  await handlers.get("SIGTERM")();
  await handlers.get("beforeExit")();
  assert.equal(cleanups, 1);
});

test("GitHub client fails instead of skipping on missing auth or API error", async () => {
  await assert.rejects(() => githubJson("https://api.github.test/x", { token: "" }), /GITHUB_TOKEN/);
  await assert.rejects(
    () => githubJson("https://api.github.test/x", { token: "x", fetchImpl: async () => new Response("no", { status: 403 }) }),
    /403/,
  );
});

test("base verification requires exact PR base, main membership, and named successful checks", async () => {
  const baseSha = "a".repeat(40);
  const api = async (url) => {
    if (url.endsWith("/pulls/7")) return { base: { ref: "main", sha: baseSha } };
    if (url.includes(`/compare/${baseSha}...main`)) return { status: "ahead" };
    return { check_runs: [
      { name: "Build", conclusion: "failure" },
      { name: "Build", conclusion: "success" },
      { name: "Unit Tests", conclusion: "success" },
    ] };
  };
  const result = await verifyBaseRevision({ repository: "o/r", prNumber: 7, baseSha, requiredChecks: ["Build", "Unit Tests"], api });
  assert.equal(result.baseSha, baseSha);
  await assert.rejects(() => verifyBaseRevision({ repository: "o/r", prNumber: 7, baseSha: "d".repeat(40), requiredChecks: ["Build"], api }), /exact PR base/);
  await assert.rejects(() => verifyBaseRevision({ repository: "o/r", prNumber: 7, baseSha, requiredChecks: ["Missing"], api }), /Missing/);
});

test("workspace is mktemp-owned and cleanup refuses root, home, unresolved, and dpf project", async () => {
  const workspace = await createHarnessWorkspace();
  workspace.project = "dpf-n1-123";
  assert.ok((await realpath(workspace.root)).startsWith(await realpath(tmpdir())));
  assertSafeHarnessConfig(workspace);
  assert.throws(() => assertSafeHarnessConfig({ ...workspace, project: "dpf" }), /project/);
  assert.throws(() => assertSafeHarnessConfig({ ...workspace, root: homedir(), project: "dpf-n1-x" }), /temporary/);
  assert.throws(() => assertSafeHarnessConfig({ ...workspace, root: join(workspace.root, "missing"), project: "dpf-n1-x" }), /resolve/);
  await cleanupHarness(workspace, async () => {});
});

test("readiness failure never requests upgrade and keeps baseline healthy", async () => {
  const events = [];
  const result = await runNMinusOneUpgrade({
    baseSha: "a".repeat(40), candidateSha: "b".repeat(40), repository: "o/r", project: "dpf-n1-test",
    injectReadinessFailure: true,
  }, {
    verifyBase: async () => ({ baseSha: "a".repeat(40) }),
    prepare: async () => ({ candidateDigest: "sha256:" + "c".repeat(64), mode: "introduction-bridge" }),
    readiness: async () => ({ ok: false, owner: "bridge", quiescenceBegan: false }),
    requestUpgrade: async () => events.push("request"),
    baselineHealth: async () => true,
    cleanup: async () => events.push("cleanup"),
    writeEvidence: async (evidence) => evidence,
  });
  assert.equal(result.upgradeRequested, false);
  assert.equal(result.baselineHealthy, true);
  assert.deepEqual(events, ["cleanup"]);
});

test("success proves immutable candidate bytes, state migration, recovery, health, and readiness ownership", async () => {
  const sha = "b".repeat(40);
  const digest = "sha256:" + "c".repeat(64);
  const result = await runNMinusOneUpgrade({ baseSha: "a".repeat(40), candidateSha: sha, repository: "o/r", project: "dpf-n1-test" }, {
    verifyBase: async () => ({ baseSha: "a".repeat(40) }),
    prepare: async () => ({ candidateDigest: digest, mode: "post-floor" }),
    readiness: async () => ({ ok: true, owner: "portal", digest, quiescenceBegan: false }),
    requestUpgrade: async () => ({ requested: true }),
    poll: async () => ({ healthy: true, version: sha, promoterDigest: digest, promoterSourceSha: sha, persistenceDigest: digest,
      sourceV1Hash: "1".repeat(64), migratedV2Hash: "2".repeat(64), sourceSchemaVersion: 1, migratedSchemaVersion: 2,
      recoveryArtifacts: [{ path: "recovery/install-state.json", sha256: "1".repeat(64) }] }),
    cleanup: async () => {}, writeEvidence: async (evidence) => evidence,
  });
  assert.equal(result.result, "passed");
});

test("protocol floor uses real PR 3276 ancestry rather than caller mode labels", async () => {
  assert.equal(await classifyUpgradeProtocolFloor("a".repeat(40), async (floor, base) => floor === "21969d012" && base === "a".repeat(40)), "post-floor");
  assert.equal(await classifyUpgradeProtocolFloor("b".repeat(40), async () => false), "legacy-bootstrap");
});

test("honest pre-floor legacy-bootstrap mode refuses automatic migration", async () => {
  const digest = "sha256:" + "c".repeat(64);
  let requested = false;
  await assert.rejects(() => runNMinusOneUpgrade({ baseSha: "a".repeat(40), candidateSha: "b".repeat(40), repository: "o/r", project: "dpf-n1-test" }, {
    verifyBase: async () => ({}), prepare: async () => ({ candidateDigest: digest, mode: "legacy-bootstrap" }),
    readiness: async () => ({ ok: true, owner: "bridge", digest, quiescenceBegan: false }),
    requestUpgrade: async () => { requested = true; }, cleanup: async () => {}, writeEvidence: async (value) => value,
  }), /installer\/reinstall remediation/);
  assert.equal(requested, false);
});

test("derived pre-floor mode refuses automatic migration before request when prepare omits mode", async () => {
  const digest = "sha256:" + "c".repeat(64);
  let requested = false;
  await assert.rejects(() => runNMinusOneUpgrade({ baseSha: "a".repeat(40), candidateSha: "b".repeat(40), repository: "o/r", project: "dpf-n1-test" }, {
    verifyBase: async () => ({}), prepare: async () => ({ candidateDigest: digest }), isAncestor: async () => false,
    readiness: async () => ({ ok: true, owner: "bridge", digest, quiescenceBegan: false }),
    requestUpgrade: async () => { requested = true; }, cleanup: async () => {}, writeEvidence: async (value) => value,
  }), /installer\/reinstall remediation/);
  assert.equal(requested, false);
});

test("derived post-floor mode enforces portal readiness ownership when prepare omits mode", async () => {
  const sha = "b".repeat(40);
  const digest = "sha256:" + "c".repeat(64);
  await assert.rejects(() => runNMinusOneUpgrade({ baseSha: "a".repeat(40), candidateSha: sha, repository: "o/r", project: "dpf-n1-test" }, {
    verifyBase: async () => ({}), prepare: async () => ({ candidateDigest: digest }), isAncestor: async () => true,
    readiness: async () => ({ ok: true, owner: "bridge", digest, quiescenceBegan: false }), requestUpgrade: async () => ({}),
    poll: async () => ({ healthy: true, version: sha, promoterDigest: digest, promoterSourceSha: sha, persistenceDigest: digest,
      sourceV1Hash: "1".repeat(64), migratedV2Hash: "2".repeat(64), sourceSchemaVersion: 1, migratedSchemaVersion: 2,
      recoveryArtifacts: [{ path: "recovery/install-state.json", sha256: "1".repeat(64) }] }),
    cleanup: async () => {}, writeEvidence: async (value) => value,
  }), /portal-owned readiness/);
});
