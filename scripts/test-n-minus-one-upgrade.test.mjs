import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertSafeHarnessConfig,
  assertPromotionSourceIdentity,
  assertRecreatedPortalProvenance,
  cleanupHarness,
  cleanupNMinusOneBaseline,
  cleanupProject,
  cloneAndCheckoutBaseline,
  createHarnessWorkspace,
  fetchAndCheckoutCandidate,
  githubJson,
  installCleanupHandlers,
  runNMinusOneUpgrade,
  buildPromoterPromotionDockerArgs,
  execFileWithLiveOutput,
  buildPromoterReadinessDockerArgs,
  normalizePromoterReadiness,
  prepareNMinusOneBaseline,
  classifyUpgradeProtocolFloor,
  PROMOTER_READINESS_PROTOCOL_FLOOR_SHA,
  verifyBaseRevision,
} from "./test-n-minus-one-upgrade.mjs";

test("long promotion commands stream progress while retaining evidence", async () => {
  const forwarded = { stdout: "", stderr: "" };
  const launch = (_command, _args, _options, callback) => {
    const child = { stdout: new EventEmitter(), stderr: new EventEmitter() };
    queueMicrotask(() => {
      child.stdout.emit("data", "step=docker-build\n");
      child.stderr.emit("data", "build progress\n");
      callback(null, "captured stdout", "captured stderr");
    });
    return child;
  };
  const result = await execFileWithLiveOutput("docker", ["run"], {}, launch, {
    stdout: { write: (chunk) => { forwarded.stdout += chunk; } },
    stderr: { write: (chunk) => { forwarded.stderr += chunk; } },
  });
  assert.deepEqual(result, { stdout: "captured stdout", stderr: "captured stderr" });
  assert.deepEqual(forwarded, { stdout: "step=docker-build\n", stderr: "build progress\n" });
});

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

test("candidate checkout fetches the event ref, proves its SHA, then detaches", async () => {
  const sha = "b".repeat(40);
  for (const scenario of [
    { eventKind: "pull_request", candidateRef: "refs/pull/3262/merge", expectedSource: "refs/pull/3262/merge" },
    { eventKind: "schedule", candidateRef: sha, expectedSource: sha },
  ]) {
    const calls = [];
    const run = async (_command, args, options) => {
      calls.push({ args, options });
      if (args[0] === "rev-parse") return { stdout: `${sha}\n` };
      return { stdout: "" };
    };
    const result = await fetchAndCheckoutCandidate({ repositoryDir: "/isolated", candidateSha: sha, eventKind: scenario.eventKind, candidateRef: scenario.candidateRef, run });
    assert.equal(result.sourceRef, scenario.expectedSource);
    assert.deepEqual(calls.map(({ args }) => args), [
      ["fetch", "--no-tags", "origin", `+${scenario.expectedSource}:refs/dpf/candidate`],
      ["rev-parse", "refs/dpf/candidate"],
      ["checkout", "--detach", "refs/dpf/candidate"],
      ["rev-parse", "HEAD"],
    ]);
    assert.ok(calls.every(({ options }) => options.cwd === "/isolated"));
  }
});

test("runtime repository provenance orders clone and baseline before event candidate fetch", async () => {
  const baseSha = "a".repeat(40); const candidateSha = "b".repeat(40); const calls = [];
  const run = async (_command, args, options = {}) => {
    calls.push({ args, options });
    if (args[0] === "rev-parse") return { stdout: `${candidateSha}\n` };
    return { stdout: "" };
  };
  await cloneAndCheckoutBaseline({ remote: "https://github.test/o/r.git", repositoryDir: "/isolated", baseSha, run });
  await fetchAndCheckoutCandidate({ repositoryDir: "/isolated", candidateSha, eventKind: "pull_request", candidateRef: "refs/pull/9/merge", run });
  assert.deepEqual(calls.map(({ args }) => args), [
    ["clone", "--no-checkout", "https://github.test/o/r.git", "/isolated"],
    ["checkout", "--detach", baseSha],
    ["fetch", "--no-tags", "origin", "+refs/pull/9/merge:refs/dpf/candidate"],
    ["rev-parse", "refs/dpf/candidate"],
    ["checkout", "--detach", "refs/dpf/candidate"],
    ["rev-parse", "HEAD"],
  ]);
});

test("candidate checkout fails closed before checkout on a missing or mismatched event ref", async () => {
  const sha = "b".repeat(40); const calls = [];
  await assert.rejects(() => fetchAndCheckoutCandidate({ repositoryDir: "/isolated", candidateSha: sha, eventKind: "pull_request", candidateRef: "refs/pull/7/merge", run: async (_command, args) => {
    calls.push(args);
    if (args[0] === "fetch") return { stdout: "" };
    return { stdout: `${"c".repeat(40)}\n` };
  } }), /does not match the event candidate SHA/);
  assert.equal(calls.some((args) => args[0] === "checkout"), false);
  await assert.rejects(() => fetchAndCheckoutCandidate({ repositoryDir: "/isolated", candidateSha: sha, eventKind: "schedule", candidateRef: sha, run: async () => { throw new Error("missing ref"); } }), /missing ref/);
});

test("scheduled candidate fetch ignores a baseline PR number", async () => {
  const sha = "b".repeat(40); const calls = [];
  await fetchAndCheckoutCandidate({ repositoryDir: "/isolated", candidateSha: sha, eventKind: "schedule", candidateRef: sha, prNumber: 3262, run: async (_command, args) => {
    calls.push(args);
    return { stdout: args[0] === "rev-parse" ? `${sha}\n` : "" };
  } });
  assert.deepEqual(calls[0], ["fetch", "--no-tags", "origin", `+${sha}:refs/dpf/candidate`]);
  assert.equal(calls[0].some((value) => value.includes("refs/pull/")), false);
});

test("workspace is mktemp-owned and cleanup refuses root, home, unresolved, and dpf project", async () => {
  const workspace = await createHarnessWorkspace();
  workspace.project = "dpf-n1-123";
  assert.ok((await realpath(workspace.root)).startsWith(await realpath(tmpdir())));
  assert.equal(await realpath(join(workspace.backups, "recovery")), join(await realpath(workspace.backups), "recovery"));
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
    prepare: async () => ({ candidateDigest: digest, mode: "post-floor", baselineSourceV1Hash: "1".repeat(64) }),
    readiness: async () => ({ ok: true, owner: "portal", digest, quiescenceBegan: false }),
    requestUpgrade: async () => ({ requested: true }),
    poll: async () => ({ healthy: true, version: sha, promoterDigest: digest, promoterSourceSha: sha, persistenceDigest: digest,
      sourceV1Hash: "1".repeat(64), migratedV2Hash: "2".repeat(64), sourceSchemaVersion: 1, migratedSchemaVersion: 2,
      recoveryArtifacts: [{ path: "recovery/install-state.json", sha256: "1".repeat(64) }] }),
    cleanup: async () => {}, writeEvidence: async (evidence) => evidence,
  });
  assert.equal(result.result, "passed");
});

test("promoter readiness accepts only authentic ready output before quiescence", () => {
  const digest = "sha256:" + "d".repeat(64);
  const raw = { result: "ready", failures: [], quiescenceBegan: false, sourceHash: "1".repeat(64), projectionHash: "2".repeat(64), fromSchemaVersion: 1, toSchemaVersion: 2 };
  assert.deepEqual(normalizePromoterReadiness(raw, { owner: "portal", digest }), { ...raw, ok: true, owner: "portal", digest });
  assert.equal(normalizePromoterReadiness({ ...raw, result: "failed" }, { owner: "portal", digest }).ok, false);
  assert.equal(normalizePromoterReadiness({ ...raw, failures: ["install_state_invalid"] }, { owner: "portal", digest }).ok, false);
  assert.equal(normalizePromoterReadiness({ ...raw, quiescenceBegan: true }, { owner: "portal", digest }).ok, false);
});

test("protocol floor uses real PR 3276 ancestry rather than caller mode labels", async () => {
  assert.equal(PROMOTER_READINESS_PROTOCOL_FLOOR_SHA, "21969d012ad8ab382d47a2c59ffc955530796bd2");
  assert.equal(await classifyUpgradeProtocolFloor("a".repeat(40), async (floor, base) => floor === PROMOTER_READINESS_PROTOCOL_FLOOR_SHA && base === "a".repeat(40)), "post-floor");
  assert.equal(await classifyUpgradeProtocolFloor("b".repeat(40), async () => false), "legacy-bootstrap");
});

test("runtime readiness supplies the complete state, secret, digest, mount, and host contract", () => {
  const digest = "sha256:" + "d".repeat(64);
  const args = buildPromoterReadinessDockerArgs({ candidateDigest: digest, source: "/candidate", state: "/state", backups: "/backups", secret: "/secret", targetSha: "a".repeat(40), project: "dpf-n1-test" });
  const rendered = args.join(" ");
  for (const required of [
    "/candidate:/host-source:ro", "/state:/dpf-state:ro", "/backups:/backups:ro", "/secret:/run/secrets/dpf-runtime-transition:ro",
    "DPF_PROMOTER_STATE_DIR=/dpf-state", "DPF_RUNTIME_TRANSITION_SECRET_FILE=/run/secrets/dpf-runtime-transition",
    `DPF_PROMOTER_DIGEST=${digest}`, "--readiness --json",
  ]) assert.ok(rendered.includes(required), required);
  // The genuine N-1 caller cannot supply host identity; readiness must derive it from the
  // mounted install-state. Injecting it here would re-blind this guard (BI-D47955AF).
  for (const forbidden of ["DPF_HOST_PLATFORM", "DPF_HOST_ARCH", "DPF_HOST_IDENTITY_PROVENANCE"]) {
    assert.ok(!rendered.includes(forbidden), forbidden);
  }
});

test("governed promotion invokes the signed promoter with writable state and recovery mounts", async () => {
  const digest = "sha256:" + "d".repeat(64);
  const envelope = { kind: "install-state-migration", version: 1, runId: "SUR-n1-contract" };
  const encodedEnvelope = Buffer.from(JSON.stringify(envelope)).toString("base64url");
  const args = buildPromoterPromotionDockerArgs({
    candidateDigest: digest, source: "/candidate", state: "/state", backups: "/backups", secret: "/secret", composeEnvFile: "/workspace/n-minus-one.env",
    targetSha: "a".repeat(40), project: "dpf-n1-test", envelope, signature: "signed-value",
  });
  const rendered = args.join(" ");
  for (const required of [
    "/var/run/docker.sock:/var/run/docker.sock:rw", "/candidate:/host-source:ro", "/state:/dpf-state:rw",
    "/backups:/backups:rw", "/secret:/run/secrets/dpf-runtime-transition:ro", "/workspace/n-minus-one.env:/run/dpf/n-minus-one.env:ro",
    "PROMOTE_COMPOSE_ENV_FILE=/run/dpf/n-minus-one.env", `DPF_INSTALL_STATE_MIGRATION_ENVELOPE=${encodedEnvelope}`,
    "DPF_INSTALL_STATE_MIGRATION_SIGNATURE=signed-value", `DPF_PROMOTER_DIGEST=${digest}`, "COMPOSE_PARALLEL_LIMIT=1", "PROMOTE_SOURCE=/host-source",
    `PROMOTE_TARGET_SHA=${"a".repeat(40)}`, "PROMOTE_COMPOSE_PROJECT=dpf-n1-test", "PROMOTE_BACKUP_PATH=/backups/recovery", "--self-upgrade",
  ]) assert.ok(rendered.includes(required), required);
  const source = await readFile(new URL("./test-n-minus-one-upgrade.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\/api\/ops\/self-upgrade/);
});

test("promotion refuses stale Compose host-source identity", () => {
  assert.doesNotThrow(() => assertPromotionSourceIdentity("DPF_HOST_INSTALL_PATH=/candidate\nAUTH_SECRET=x\n", "/candidate"));
  assert.throws(() => assertPromotionSourceIdentity("DPF_HOST_INSTALL_PATH=/baseline\n", "/candidate"), /source diverges/);
  assert.throws(() => assertPromotionSourceIdentity("AUTH_SECRET=x\n", "/candidate"), /source diverges/);
});

test("recreated portal provenance is bound to the isolated project and candidate image", () => {
  const image = { Id: "sha256:" + "d".repeat(64) };
  const container = { Image: image.Id, Config: { Labels: { "com.docker.compose.project": "dpf-n1-test", "com.docker.compose.service": "portal" } } };
  assert.doesNotThrow(() => assertRecreatedPortalProvenance(container, image, { project: "dpf-n1-test" }));
  assert.throws(() => assertRecreatedPortalProvenance(container, image, { project: "dpf-n1-other" }), /isolated promotion project/);
  assert.throws(() => assertRecreatedPortalProvenance(container, { ...image, Id: "sha256:" + "e".repeat(64) }, { project: "dpf-n1-test" }), /image provenance/);
});

test("completed evidence must preserve the exact observed baseline bytes", async () => {
  const sha = "b".repeat(40); const digest = "sha256:" + "c".repeat(64);
  await assert.rejects(() => runNMinusOneUpgrade({ baseSha: "a".repeat(40), candidateSha: sha, repository: "o/r", project: "dpf-n1-test" }, {
    verifyBase: async () => ({}), prepare: async () => ({ candidateDigest: digest, mode: "post-floor", baselineSourceV1Hash: "1".repeat(64) }),
    readiness: async () => ({ ok: true, owner: "portal", digest, quiescenceBegan: false }), requestUpgrade: async () => ({}),
    poll: async () => ({ healthy: true, version: sha, promoterDigest: digest, promoterSourceSha: sha, persistenceDigest: digest,
      sourceV1Hash: "3".repeat(64), migratedV2Hash: "2".repeat(64), sourceSchemaVersion: 1, migratedSchemaVersion: 2,
      recoveryArtifacts: [{ path: "recovery/install-state.json", sha256: "3".repeat(64) }] }),
    cleanup: async () => {}, writeEvidence: async (value) => value,
  }), /does not match the observed baseline v1 bytes/);
});

test("acceptance workflow executes the real baseline-to-candidate N-1 runner", async () => {
  const workflow = await readFile(join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), ".github/workflows/self-upgrade-acceptance.yml"), "utf8");
  assert.match(workflow, /node scripts\/test-n-minus-one-upgrade\.mjs \\/);
  for (const flag of ["--base-sha", "--candidate-sha", "--repository", "--project", "--evidence-dir"]) assert.match(workflow, new RegExp(flag));
  assert.match(workflow, /--pr-number "\$\{\{ steps\.baseline\.outputs\.pr_number \}\}"/);
  assert.match(workflow, /--event-kind "\$\{\{ github\.event_name \}\}"/);
  assert.match(workflow, /--candidate-ref "\$candidate_ref"/);
  assert.match(workflow, /EVENT_PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.match(workflow, /candidate_ref="refs\/pull\/\$\{EVENT_PR_NUMBER\}\/merge"/);
  assert.match(workflow, /if: github\.event_name != 'pull_request' && steps\.baseline\.outputs\.should_run == 'true'/);
  assert.match(workflow, /scope:\"bounded-pr-contract\"/);
  assert.match(workflow, /DI-FA01D947B1FA/);
  assert.match(workflow, /gh api .*pulls\?state=open/);
  assert.match(workflow, /should_run=false/);
  assert.match(workflow, /21969d012ad8ab382d47a2c59ffc955530796bd2/);
});

test("baseline preparation uses the unique harness project and proves health after build/up", async () => {
  const workspace = await createHarnessWorkspace("dpf-n1-prepare-");
  const events = [];
  try {
    const baseline = await prepareNMinusOneBaseline({ workspace, project: "dpf-n1-isolated", portalUrl: "http://127.0.0.1:3000" }, {
      run: async (command, args, options) => {
        await assert.rejects(() => readFile(join(workspace.state, "install-state.json")), /ENOENT/, "legacy BOM fixture must not exist before baseline start");
        events.push({ kind: "run", command, args, env: options.env }); return { stdout: "" };
      },
      fetchImpl: async () => {
        await assert.rejects(() => readFile(join(workspace.state, "install-state.json")), /ENOENT/, "legacy BOM fixture must not exist before baseline health");
        events.push({ kind: "health" }); return new Response("ok", { status: 200 });
      }, sleep: async () => {},
    });
    assert.equal(events[0].kind, "run");
    assert.equal(events[0].command, "node");
    assert.ok(events[0].args.some((value) => value.replaceAll("\\", "/").endsWith("scripts/dpf-compose.mjs")));
    assert.ok(events[0].args.includes("dpf-n1-isolated"));
    assert.deepEqual(events[0].args.slice(-4), ["up", "-d", "--build", "postgres"]);
    assert.equal(events[0].env.COMPOSE_PROJECT_NAME, "dpf-n1-isolated");
    assert.equal(events[0].env.COMPOSE_PARALLEL_LIMIT, "1");
    assert.equal(events[0].env.DPF_STATE_DIR_HOST, workspace.state);
    assert.equal(events[0].env.DPF_STATE_DIR, workspace.state);
    assert.equal(events[0].env.DPF_BACKUPS_HOST_PATH, workspace.backups);
    assert.match(events[0].env.AUTH_SECRET, /^dpf_n1_[A-Za-z0-9_-]{43}$/);
    assert.match(events[0].env.CREDENTIAL_ENCRYPTION_KEY, /^[a-f0-9]{64}$/);
    assert.equal(events[0].env.DPF_N1_HARNESS, "1");
    assert.ok(events[0].args.includes("--env-file"));
    const envFile = events[0].args[events[0].args.indexOf("--env-file") + 1];
    const seeded = await readFile(envFile, "utf8");
    assert.ok(seeded.includes(`DPF_STATE_DIR=${workspace.state}\n`));
    assert.ok(seeded.includes(`DPF_STATE_DIR_HOST=${workspace.state}\n`));
    assert.ok(seeded.includes(`DPF_BACKUPS_HOST_PATH=${workspace.backups}\n`));
    assert.ok(seeded.includes(`DPF_HOST_INSTALL_PATH=${workspace.source}\n`));
    assert.ok(seeded.includes(`AUTH_SECRET=${events[0].env.AUTH_SECRET}\n`));
    assert.ok(seeded.includes(`CREDENTIAL_ENCRYPTION_KEY=${events[0].env.CREDENTIAL_ENCRYPTION_KEY}\n`));
    assert.match(seeded, /^DPF_N1_HARNESS=1$/m);
    assert.equal(events[1].command, "docker");
    assert.deepEqual(events[1].args.slice(0, 4), ["run", "-d", "--name", "dpf-n1-isolated-portal-1"]);
    assert.ok(events[1].args.includes("com.docker.compose.project=dpf-n1-isolated"));
    assert.ok(events[1].args.includes("com.docker.compose.service=portal"));
    assert.deepEqual(workspace.harnessEnvironment, events[0].env);
    const stateBytes = await readFile(join(workspace.state, "install-state.json"));
    assert.deepEqual([...stateBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(JSON.parse(stateBytes.subarray(3).toString("utf8")).schemaVersion, 1);
    assert.equal(baseline.sourceV1Hash, createHash("sha256").update(stateBytes).digest("hex"));
    assert.deepEqual((await (await import("node:fs/promises")).readdir(workspace.state)).filter((name) => name.startsWith(".install-state.json.n1-")), []);
    assert.equal(events.at(-1).kind, "health");
    let cleanupCall;
    await cleanupNMinusOneBaseline(workspace, async (command, args, options) => { cleanupCall = { command, args, options }; return { stdout: "" }; });
    assert.equal(cleanupCall.options.env.DPF_STATE_DIR, join(workspace.root, "cleanup-state"));
    assert.equal(cleanupCall.options.env.DPF_STATE_DIR_HOST, join(workspace.root, "cleanup-state"));
    assert.equal(cleanupCall.options.env.AUTH_SECRET, events[0].env.AUTH_SECRET);
    assert.equal(cleanupCall.options.env.CREDENTIAL_ENCRYPTION_KEY, events[0].env.CREDENTIAL_ENCRYPTION_KEY);
    assert.equal(cleanupCall.args[cleanupCall.args.indexOf("--env-file") + 1], envFile);
    assert.deepEqual(cleanupCall.args.slice(-3), ["down", "--volumes", "--remove-orphans"]);
  } finally { await rm(workspace.root, { recursive: true, force: true }); }
});

test("upgrade request occurs only after baseline preparation reports healthy", async () => {
  const events = [];
  const sha = "b".repeat(40); const digest = "sha256:" + "c".repeat(64);
  await runNMinusOneUpgrade({ baseSha: "a".repeat(40), candidateSha: sha, repository: "o/r", project: "dpf-n1-test" }, {
    verifyBase: async () => ({}), prepare: async () => { events.push("baseline-health"); return { candidateDigest: digest, mode: "post-floor", baselineSourceV1Hash: "1".repeat(64) }; },
    readiness: async () => ({ ok: true, owner: "portal", digest }), requestUpgrade: async () => events.push("request"),
    poll: async () => ({ healthy: true, version: sha, promoterDigest: digest, promoterSourceSha: sha, persistenceDigest: digest,
      sourceV1Hash: "1".repeat(64), migratedV2Hash: "2".repeat(64), sourceSchemaVersion: 1, migratedSchemaVersion: 2,
      recoveryArtifacts: [{ sha256: "1".repeat(64) }] }), cleanup: async () => {}, writeEvidence: async (value) => value,
  });
  assert.deepEqual(events, ["baseline-health", "request"]);
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
    verifyBase: async () => ({}), prepare: async () => ({ candidateDigest: digest, baselineSourceV1Hash: "1".repeat(64) }), isAncestor: async () => true,
    readiness: async () => ({ ok: true, owner: "bridge", digest, quiescenceBegan: false }), requestUpgrade: async () => ({}),
    poll: async () => ({ healthy: true, version: sha, promoterDigest: digest, promoterSourceSha: sha, persistenceDigest: digest,
      sourceV1Hash: "1".repeat(64), migratedV2Hash: "2".repeat(64), sourceSchemaVersion: 1, migratedSchemaVersion: 2,
      recoveryArtifacts: [{ path: "recovery/install-state.json", sha256: "1".repeat(64) }] }),
    cleanup: async () => {}, writeEvidence: async (value) => value,
  }), /portal-owned readiness/);
});
