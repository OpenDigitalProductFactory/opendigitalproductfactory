import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildHostResourceClaim,
  classifyHeavyProcess,
  findUngovernedHeavyProcesses,
  parseHostResourceArgs,
  readMcpConnection,
  readProcessRows,
  claimHostResourceAdmission,
} from "./host-resource-runner.mjs";
import { isAllowedMcpEndpoint } from "./lib/mcp-client.mjs";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolveHostAttempt, hostResumePin } from "./lib/host-resource-attempt.mjs";

const GiB = 1024 ** 3;

function admissionFixture() {
  const context = { fixture: "claim" };
  const attempt = resolveHostAttempt(context);
  const claimArgs = { claimKey: attempt.claimKey, environmentKey: "host-heavy-resource",
    ownerProvider: "codex", ownerSessionId: "fixture-session", worktreePath: "fixture-worktree",
    branchName: "fix/fixture", resourceClass: "vitest", purpose: "host-resource:vitest",
    expectedMemoryBytes: GiB, ownerProcessId: 101 };
  const row = { ...claimArgs, leaseId: "NPEL-TEST", status: "queued", ownerPid: 101 };
  const reply = { success: true, entityId: row.leaseId,
    data: { admission: { status: "admitted" }, lease: { leaseId: row.leaseId } } };
  return { context, attempt, claimArgs, row, reply,
    connection: { mcpUrl: "http://127.0.0.1:1/api/mcp/v1", bearerToken: "fixture-only" } };
}

test("a lost claim response reconciles the original queued lease before one same-key replacement", async () => {
  const fixture = admissionFixture();
  const calls = [];
  let clock = 0;
  const result = await claimHostResourceAdmission({ ...fixture, now: () => clock, call: async (name, args, options) => {
    calls.push({ name, args, options });
    if (calls.length === 1) { clock = 60000; throw Object.assign(new Error("fixture-secret"), { code: "ETIMEDOUT" }); }
    if (name === "list_nonprod_environment_leases") return { success: true, data: { leases: [], queued: [fixture.row] } };
    return fixture.reply;
  } });
  assert.equal(result, fixture.reply);
  assert.deepEqual(calls.map(call => call.name), ["claim_nonprod_environment_lease", "list_nonprod_environment_leases", "claim_nonprod_environment_lease"]);
  assert.equal(calls[0].options.timeoutMs, 60000);
  assert.equal(calls[0].args.claimKey, calls[2].args.claimKey);
  assert.equal(calls[2].args.resumeLeaseId, fixture.row.leaseId);
});

test("response-loss recovery observes its own active process without transferring active authority", async () => {
  const fixture = admissionFixture();
  let calls = 0;
  await claimHostResourceAdmission({ ...fixture, call: async (name, args) => {
    if (++calls === 1) throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    if (name === "list_nonprod_environment_leases") return { success: true, data: {
      leases: [{ ...fixture.row, status: "active" }], queued: [],
    } };
    assert.equal(args.claimKey, fixture.attempt.claimKey);
    assert.equal(args.resumeLeaseId, undefined, "active process observation must not request a queued handoff");
    return fixture.reply;
  } });
  assert.equal(calls, 3);
});

test("an empty listing is not absence proof and replacement retains the same immutable key", async () => {
  const fixture = admissionFixture();
  const keys = [];
  let listed = false;
  await claimHostResourceAdmission({ ...fixture, call: async (name, args) => {
    if (name === "list_nonprod_environment_leases") { listed = true; return { success: true, data: { leases: [], queued: [] } }; }
    keys.push(args.claimKey);
    if (keys.length === 1) throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    assert.equal(listed, true);
    return fixture.reply;
  } });
  assert.deepEqual(keys, [fixture.attempt.claimKey, fixture.attempt.claimKey]);
});

test("uncertain host admission exposes a same-attempt pin and never retries a failed replacement", async () => {
  const fixture = admissionFixture();
  let calls = 0;
  let failure;
  await assert.rejects(claimHostResourceAdmission({ ...fixture, call: async name => {
    ++calls;
    if (name === "list_nonprod_environment_leases") return { success: true, data: { leases: [], queued: [] } };
    throw Object.assign(new Error("fixture-secret"), { code: "ETIMEDOUT" });
  } }), error => { failure = error; return error.code === "host_admission_unavailable" && error.commandExecuted === false; });
  assert.equal(calls, 3);
  assert.doesNotMatch(failure.message, /fixture-secret/);
  const resumed = resolveHostAttempt(fixture.context, failure.resumePin);
  assert.equal(resumed.claimKey, fixture.attempt.claimKey);
  assert.equal(resumed.phase, "claim-uncertain");
  assert.throws(() => resolveHostAttempt({ fixture: "changed" }, failure.resumePin));
});

test("an uncertain pin reconciles before its first resumed claim", async () => {
  const fixture = admissionFixture();
  const attempt = resolveHostAttempt(fixture.context, hostResumePin(fixture.attempt));
  const calls = [];
  await claimHostResourceAdmission({ ...fixture, attempt, call: async (name, args) => {
    calls.push(name);
    if (name === "list_nonprod_environment_leases") return { success: true, data: { leases: [], queued: [fixture.row] } };
    assert.equal(args.resumeLeaseId, fixture.row.leaseId);
    return fixture.reply;
  } });
  assert.deepEqual(calls, ["list_nonprod_environment_leases", "claim_nonprod_environment_lease"]);
});

test("authoritative refusal is not retried or replaced by a listing", async () => {
  const fixture = admissionFixture();
  let calls = 0;
  const refusal = { success: false, error: "permission_denied" };
  assert.equal(await claimHostResourceAdmission({ ...fixture, call: async () => { ++calls; return refusal; } }), refusal);
  assert.equal(calls, 1);
});

test("foreign, duplicate, conflicting and active-other-process reconciliation stops before a replacement", async () => {
  const fixture = admissionFixture();
  for (const rows of [[{ ...fixture.row, ownerSessionId: "foreign" }], [fixture.row, fixture.row],
    [{ ...fixture.row, branchName: "different" }], [{ ...fixture.row, status: "active", ownerPid: 202 }]]) {
    let calls = 0;
    await assert.rejects(claimHostResourceAdmission({ ...fixture, call: async name => {
      ++calls;
      if (name === "claim_nonprod_environment_lease") throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
      return { success: true, data: { leases: [], queued: rows } };
    } }), error => error.code === "host_admission_unavailable");
    assert.equal(calls, 2);
  }
});

test("non-timeout transport failure and unavailable reconciliation never trigger another claim", async () => {
  const fixture = admissionFixture();
  let calls = 0;
  await assert.rejects(claimHostResourceAdmission({ ...fixture, call: async () => { ++calls; throw new Error("fixture-secret"); } }),
    error => error.reason === "claim-transport-unavailable" && !error.message.includes("fixture-secret"));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(claimHostResourceAdmission({ ...fixture, call: async name => {
    ++calls;
    if (name === "claim_nonprod_environment_lease") throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    return { success: false, error: "permission_denied" };
  } }), error => error.reason === "reconciliation-unproven");
  assert.equal(calls, 2);
});

test("a late authoritative response retains the known lease but cannot start work past the elapsed deadline", async () => {
  const fixture = admissionFixture();
  let clock = 0;
  await assert.rejects(claimHostResourceAdmission({ ...fixture, now: () => clock, call: async () => {
    clock = 180000;
    return fixture.reply;
  } }), error => error.reason === "claim-deadline" && error.leaseId === fixture.row.leaseId && error.commandExecuted === false);
});

test("failed recovery progress recording stops admission as unrun before any replacement", async () => {
  const fixture = admissionFixture();
  let calls = 0;
  await assert.rejects(claimHostResourceAdmission({ ...fixture,
    onProgress: () => { throw new Error("fixture-secret recording failure"); },
    call: async () => { ++calls; throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); },
  }), error => error.code === "host_admission_unavailable" && error.reason === "progress-unavailable"
    && !error.message.includes("fixture-secret"));
  assert.equal(calls, 1);
});

test("a malformed claim response stops as unrun without automatic reconciliation", async () => {
  const fixture = admissionFixture();
  let calls = 0;
  await assert.rejects(claimHostResourceAdmission({ ...fixture,
    call: async () => { ++calls; return null; },
  }), error => error.reason === "claim-response-unproven");
  assert.equal(calls, 1);
});

async function createHostClaimFixture(t, { claimDelayMs = 0, loseFirstResponse = false, releaseRefused = false, extraEnv = {} } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "host-claim-test-"));
  const git = args => execFileSync("git", args, { cwd, windowsHide: true, stdio: "pipe" });
  git(["init"]);
  writeFileSync(join(cwd, "input.txt"), "fixture");
  git(["add", "."]);
  git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture"]);
  const calls = [];
  const leases = new Map();
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    calls.push(rpc.params);
    const args = rpc.params.arguments;
    if (rpc.params.name === "release_nonprod_environment_lease" && releaseRefused) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id,
        result: releaseRefused === "unproven" ? { success: true, entityId: "APPROVAL-FIXTURE" }
          : { success: false, error: "approval_required" } }));
      return;
    }
    if (rpc.params.name === "claim_nonprod_environment_lease") {
      if (!leases.has(args.claimKey)) leases.set(args.claimKey, { ...args, leaseId: "NPEL-FIXTURE-CLAIM",
        status: "active", ownerPid: args.ownerProcessId });
      if (loseFirstResponse && calls.filter(call => call.name === "claim_nonprod_environment_lease").length === 1) return;
    }
    if (rpc.params.name === "list_nonprod_environment_leases") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: {
        success: true, data: { leases: [...leases.values()], queued: [] },
      } }));
      return;
    }
    if (rpc.params.name === "claim_nonprod_environment_lease" && claimDelayMs) {
      await new Promise(resolve => setTimeout(resolve, claimDelayMs));
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: {
      success: true, entityId: "NPEL-FIXTURE-CLAIM",
      data: { admission: { status: "admitted" }, lease: {
        leaseId: "NPEL-FIXTURE-CLAIM", expiresAt: new Date(Date.now() + 600000).toISOString(),
        status: rpc.params.name === "release_nonprod_environment_lease" ? "released" : "active",
        ownerSessionId: args.ownerSessionId,
      } },
    } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|comspec|temp|tmp|pathext)$/i.test(key))),
    DPF_MCP_URL: `http://127.0.0.1:${server.address().port}/api/mcp/v1`,
    DPF_MCP_BEARER_TOKEN: "fixture-only", DPF_MCP_CLIENT_CREDENTIALS_FILE: join(cwd, "absent-credentials"),
    DPF_DURABLE_RESUMER: "off", DPF_GATE_OWNER_SESSION_ID: "fixture-claim-session",
    ...extraEnv,
  };
  const run = command => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./host-resource-runner.mjs", import.meta.url)),
      "--class", "vitest", "--", ...command],
    { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 45000 });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { calls, leases, run };
}

test("real response-loss recovery reconciles one admitted mock row and executes the command once", { timeout: 60000 }, async t => {
  const fixture = await createHostClaimFixture(t, { loseFirstResponse: true,
    extraEnv: { DPF_GATE_MCP_TIMEOUT_MS: "200" } });
  const result = await fixture.run([process.execPath, "-e", "process.stdout.write('EXECUTED')"]);
  assert.equal(result.signal, null);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "EXECUTED");
  assert.equal(fixture.leases.size, 1);
  const claims = fixture.calls.filter(call => call.name === "claim_nonprod_environment_lease");
  assert.equal(claims.length, 2);
  assert.equal(claims[0].arguments.claimKey, claims[1].arguments.claimKey);
  assert.equal(claims[1].arguments.resumeLeaseId, undefined);
  assert.equal(fixture.calls[1].name, "list_nonprod_environment_leases");
  assert.equal(fixture.calls.at(-1).name, "release_nonprod_environment_lease");
});

test("real host claim tolerates a response beyond the generic ten-second probe budget", { timeout: 60000 }, async t => {
  const fixture = await createHostClaimFixture(t, { claimDelayMs: 12000 });
  const result = await fixture.run([process.execPath, "-e", "process.stdout.write('EXECUTED')"]);
  assert.equal(result.signal, null, "fixture timeout is unrun, not a product verdict");
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "EXECUTED");
  assert.equal(fixture.calls.filter(call => call.name === "claim_nonprod_environment_lease").length, 1);
});

test("a missing wrapped executable is a redacted unrun outcome and still releases its mock lease", { timeout: 60000 }, async t => {
  const fixture = await createHostClaimFixture(t);
  const result = await fixture.run(["fixture-secret-missing-executable"]);
  assert.equal(result.signal, null, "fixture timeout is unrun, not a product verdict");
  assert.equal(result.code, 88, result.stderr);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /fixture-secret/);
  const packet = JSON.parse(result.stderr.trim());
  assert.equal(packet.status, "unrun");
  assert.equal(packet.commandExecuted, false);
  assert.equal(fixture.calls.at(-1).name, "release_nonprod_environment_lease");
});

test("Windows host runner launches the installed pnpm shim through the shared command resolver", {
  timeout: 60000, skip: process.platform !== "win32" && "Windows-only package-manager shim",
}, async t => {
  const fixture = await createHostClaimFixture(t);
  const result = await fixture.run(["pnpm", "--version"]);
  assert.equal(result.signal, null);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
  assert.equal(fixture.calls.at(-1).name, "release_nonprod_environment_lease");
});

test("an executed child failure remains a code result rather than launch-unrun", { timeout: 60000 }, async t => {
  const fixture = await createHostClaimFixture(t);
  const result = await fixture.run([process.execPath, "-e", "process.exit(7)"]);
  assert.equal(result.signal, null);
  assert.equal(result.code, 7);
  assert.doesNotMatch(result.stderr, /host_command_unavailable/);
  assert.equal(fixture.calls.at(-1).name, "release_nonprod_environment_lease");
});

test("a refused cleanup is exposed separately and never relabels an executed code failure", { timeout: 60000 }, async t => {
  const fixture = await createHostClaimFixture(t, { releaseRefused: true });
  const result = await fixture.run([process.execPath, "-e", "process.exit(7)"]);
  assert.equal(result.signal, null);
  assert.equal(result.code, 7);
  const packet = JSON.parse(result.stderr.trim());
  assert.equal(packet.status, "cleanup-unproven");
  assert.equal(packet.cleanupVerified, false);
  assert.equal(packet.commandExecuted, true);
  assert.equal(packet.recovery.tool, "release_nonprod_environment_lease");
  assert.equal(packet.recovery.arguments.ownerSessionId, "fixture-claim-session");
  assert.equal(fixture.calls.at(-1).arguments.ownerSessionId, "fixture-claim-session");
});

test("a success flag without the exact terminal lease is not verified cleanup", { timeout: 60000 }, async t => {
  const fixture = await createHostClaimFixture(t, { releaseRefused: "unproven" });
  const result = await fixture.run([process.execPath, "-e", "process.exit(0)"]);
  assert.equal(result.code, 0, "actual command success remains its own fact");
  assert.equal(JSON.parse(result.stderr.trim()).cleanupVerified, false);
});

test("a conflicting authoritative lease identity never replaces the reconciled original", async () => {
  const fixture = admissionFixture();
  const attempt = { ...fixture.attempt, leaseId: fixture.row.leaseId };
  await assert.rejects(claimHostResourceAdmission({ ...fixture, attempt, call: async () => ({
    success: true, entityId: "NPEL-FOREIGN", data: { admission: { status: "admitted" }, lease: { leaseId: "NPEL-FOREIGN" } },
  }) }), error => error.reason === "claim-identity-conflict" && error.leaseId === fixture.row.leaseId);
});

for (const [reason, result] of Object.entries({
  "producer-failed": { status: 1, stdout: "", stderr: "fixture-secret" },
  "producer-timeout": { status: null, stdout: "", error: { code: "ETIMEDOUT" } },
  "producer-output-limit": { status: null, stdout: "", error: { code: "ENOBUFS" } },
  "empty-output": { status: 0, stdout: "" },
  "malformed-output": { status: 0, stdout: '[{"CommandLine":"fixture-secret"' },
  "invalid-rows": { status: 0, stdout: '[{"ProcessId":"wrong","ParentProcessId":0,"CommandLine":"fixture-secret"}]' },
})) {
  test(`process inventory ${reason} blocks admission with redacted diagnostics`, () => {
    assert.throws(() => readProcessRows({ platform: "win32", spawnSyncImpl: () => result }), error => {
      assert.equal(error.code, "host_inventory_unavailable");
      assert.equal(error.reason, reason);
      assert.ok(error.message.length < 300);
      assert.doesNotMatch(error.message, /fixture-secret/);
      return true;
    });
  });
}

test("a control character in one Windows command line does not make the whole inventory unusable (BI-97430AD3)", () => {
  const raw = "[{\"ProcessId\":42,\"ParentProcessId\":1,\"CommandLine\":\"node bad\u0001line\"}]";
  const rows = readProcessRows({
    platform: "win32",
    spawnSyncImpl: (command, args) => {
      assert.equal(command, "powershell.exe");
      assert.match(args.at(-1), /\\u0000-\\u001F/);
      return { status: 0, stdout: raw };
    },
  });
  assert.deepEqual(rows, [{ pid: 42, parentPid: 1, commandLine: "node badline" }]);
});

test("process inventory preserves Unicode commands and enforces producer bounds", () => {
  const rows = readProcessRows({ platform: "win32", spawnSyncImpl: (command, args, options) => {
    assert.equal(command, "powershell.exe");
    assert.match(args.at(-1), /OutputEncoding/);
    assert.match(args.at(-1), /ErrorActionPreference/);
    assert.ok(options.timeout > 0 && options.timeout <= 30000);
    assert.ok(options.maxBuffer > 0 && options.maxBuffer <= 16 * 1024 * 1024);
    return { status: 0, stdout: '\ufeff[{"ProcessId":42,"ParentProcessId":1,"CommandLine":"node café"}]' };
  }});
  assert.deepEqual(rows, [{ pid: 42, parentPid: 1, commandLine: "node café" }]);
});

test("POSIX process inventory rejects partial malformed output instead of dropping rows", () => {
  assert.throws(() => readProcessRows({ platform: "linux", spawnSyncImpl: () => ({ status: 0, stdout: "42 1 node\ninvalid fixture-secret\n" }) }),
    error => error.code === "host_inventory_unavailable" && error.reason === "invalid-rows" && !error.message.includes("fixture-secret"));
});

test("real runner resumes one mock lease across processes and never runs terminal or drifted work", { timeout: 60000 }, async t => {
  const cwd = mkdtempSync(join(tmpdir(), "host-resume-test-"));
  const git = args => execFileSync("git", args, { cwd, windowsHide: true, stdio: "pipe" });
  git(["init"]);
  writeFileSync(join(cwd, "input.txt"), "original");
  git(["add", "."]);
  git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture"]);
  writeFileSync(join(cwd, "input.txt"), "dirty baseline");
  const calls = [];
  const leases = new Map();
  let status = "queued";
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    calls.push(rpc.params);
    const claim = rpc.params.arguments;
    if (rpc.params.name === "claim_nonprod_environment_lease" && !leases.has(claim.claimKey)) {
      leases.set(claim.claimKey, `NPEL-TEST-${leases.size + 1}`);
    }
    const leaseId = leases.get(claim.claimKey) ?? claim.leaseId;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: status === "terminal" ? {
      success: false, error: "lease_terminal", entityId: leaseId,
      data: { lease: { leaseId }, reason: "released", retryable: false },
    } : {
      success: true, entityId: leaseId,
      data: { admission: { status }, lease: { leaseId, expiresAt: new Date(Date.now() + 600000).toISOString() } },
    } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  // Never inherit real credentials or connect to the install from this test.
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|comspec|temp|tmp|pathext)$/i.test(key))),
    DPF_MCP_URL: `http://127.0.0.1:${server.address().port}/api/mcp/v1`,
    DPF_MCP_BEARER_TOKEN: "fixture-only", DPF_MCP_CLIENT_CREDENTIALS_FILE: join(cwd, "absent-credentials"),
    DPF_DURABLE_RESUMER: "off", DPF_GATE_OWNER_SESSION_ID: "fixture-session",
  };
  const command = [process.execPath, "-e", "process.stdout.write('EXECUTED')"];
  const run = (pin, extra = {}) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./host-resource-runner.mjs", import.meta.url)),
      "--class", "vitest", ...(pin ? ["--resume-pin", pin] : []), "--", ...command],
    { cwd, env: { ...env, ...extra }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", value => { stdout += value; });
    child.stderr.on("data", value => { stderr += value; });
    child.once("error", reject);
    child.once("close", code => resolve({ code, stdout, stderr }));
  });
  const first = await run();
  assert.equal(first.code, 75, first.stderr);
  const packet = JSON.parse(first.stderr.trim());
  assert.equal(packet.resumeOwner, "caller");
  const retry = await run(packet.resumePin, { DPF_DURABLE_RESUME: "1" });
  assert.equal(retry.code, 75, retry.stderr);
  assert.equal(leases.size, 1);
  assert.notEqual(calls[0].arguments.ownerProcessId, calls[1].arguments.ownerProcessId);
  assert.equal(calls[1].arguments.resumeLeaseId, packet.leaseId);
  status = "admitted";
  const admitted = await run(packet.resumePin, { DPF_DURABLE_RESUME: "1" });
  assert.equal(admitted.code, 0, admitted.stderr);
  assert.equal(admitted.stdout, "EXECUTED");
  assert.equal(calls.at(-1).name, "release_nonprod_environment_lease");
  status = "terminal";
  const terminal = await run(packet.resumePin);
  assert.equal(terminal.code, 81, terminal.stderr);
  assert.equal(terminal.stdout, "");
  const beforeDrift = calls.length;
  const foreign = await run(packet.resumePin, { DPF_GATE_OWNER_SESSION_ID: "different" });
  assert.equal(foreign.code, 82);
  assert.equal(calls.length, beforeDrift);
  writeFileSync(join(cwd, "input.txt"), "changed");
  const drifted = await run(packet.resumePin);
  assert.equal(drifted.code, 82);
  assert.equal(calls.length, beforeDrift);
  assert.equal(drifted.stdout, "");
  status = "queued";
  assert.equal((await run()).code, 75);
  assert.equal(leases.size, 2);
});

test("new invocations have distinct attempt identities, but a replay preserves the pin", () => {
  const context = { source: "sha", command: ["node", "test"], owner: "s1", budget: 8 };
  const first = resolveHostAttempt(context);
  const next = resolveHostAttempt(context);
  assert.notEqual(first.claimKey, next.claimKey);
  const retry = resolveHostAttempt(context, hostResumePin(first, "NPEL-1"));
  assert.equal(retry.claimKey, first.claimKey);
  assert.equal(retry.leaseId, "NPEL-1");
  for (const key of Object.keys(context)) {
    assert.throws(() => resolveHostAttempt({ ...context, [key]: "changed" }, hostResumePin(first, "NPEL-1")), /identity_changed/);
  }
  assert.throws(() => resolveHostAttempt(context, JSON.stringify(first)), /identity_changed/);
});

test("a detached retry preserves the logical claim despite a new PID", () => {
  const input = {
    resourceClass: "vitest", ownerProvider: "codex", ownerSessionId: "s1",
    worktreePath: "D:/wt", branchName: "fix/retry", now: new Date(),
    attempt: { claimKey: "host-resource:v2:attempt:digest", leaseId: "NPEL-1" },
  };
  const first = buildHostResourceClaim({ ...input, pid: 1, processIdentity: "process-1" });
  const retry = buildHostResourceClaim({ ...input, pid: 2, processIdentity: "process-2" });
  assert.equal(first.claimKey, retry.claimKey);
  assert.equal(retry.resumeLeaseId, "NPEL-1");
  assert.equal(retry.ownerProcessId, 2);
});

test("resume metadata stays before the command separator", () => {
  const pin = JSON.stringify({ attemptId: "one", fingerprint: "digest", leaseId: "NPEL-1" });
  const parsed = parseHostResourceArgs(["--class", "vitest", "--resume-pin", pin, "--", "node", "test.mjs", "--resume-pin", "child-value"]);
  assert.equal(parsed.resumePin, pin);
  assert.deepEqual(parsed.commandArgs, ["test.mjs", "--resume-pin", "child-value"]);
});

test("parses one declared resource class and a command without shell interpolation", () => {
  assert.deepEqual(
    parseHostResourceArgs(["--class", "vitest", "--", "pnpm", "--filter", "web", "test"]),
    {
      resourceClass: "vitest",
      command: "pnpm",
      commandArgs: ["--filter", "web", "test"],
    },
  );
});

test("rejects obsolete polling wait flags because queued work resumes through durable events", () => {
  assert.throws(
    () => parseHostResourceArgs(["--class", "vitest", "--wait-seconds", "30", "--", "pnpm", "test"]),
    /unknown argument: --wait-seconds/,
  );
});

test("queued host work preserves its durable lease and exits without a release or retry timer", () => {
  const source = readFileSync(new URL("./host-resource-runner.mjs", import.meta.url), "utf8");
  const queuedBranch = source.slice(
    source.indexOf('if (claim?.data?.admission?.status === "queued")'),
    source.indexOf('if (claim?.data?.admission?.status !== "admitted")'),
  );
  assert.match(queuedBranch, /host_resource_durable_wait/);
  assert.doesNotMatch(queuedBranch, /release_nonprod_environment_lease/);
  assert.doesNotMatch(queuedBranch, /setTimeout|retryAfterSeconds/);
});

test("rejects an undeclared command", () => {
  assert.throws(() => parseHostResourceArgs(["--", "pnpm", "test"]), /--class is required/);
});

test("classifies canonical heavyweight process families", () => {
  assert.equal(classifyHeavyProcess("node node_modules/typescript/bin/tsc --noEmit"), "typescript");
  assert.equal(classifyHeavyProcess("node node_modules/vitest/vitest.mjs run"), "vitest");
  assert.equal(classifyHeavyProcess("node node_modules/next/dist/bin/next build"), "next-build");
  assert.equal(classifyHeavyProcess("docker buildx build --load ."), "docker-build");
  assert.equal(classifyHeavyProcess("next dev --port 3100"), "preview");
  assert.equal(classifyHeavyProcess("node scripts/check-doc-links.mjs"), null);
});

test("reports stray heavy processes as evidence and never returns a kill instruction", () => {
  const findings = findUngovernedHeavyProcesses([
    { pid: 10, parentPid: 1, commandLine: "node node_modules/vitest/vitest.mjs run" },
    { pid: 11, parentPid: 1, commandLine: "node scripts/check-doc-links.mjs" },
  ], { governedPids: [] });

  assert.deepEqual(findings, [{
    pid: 10,
    parentPid: 1,
    resourceClass: "vitest",
    commandLine: "node node_modules/vitest/vitest.mjs run",
    disposition: "evidence-only",
  }]);
  assert.equal(JSON.stringify(findings).includes("kill"), false);
  assert.equal(JSON.stringify(findings).includes("terminate"), false);
});

test("builds one typed durable claim with host and inference evidence", () => {
  const claim = buildHostResourceClaim({
    resourceClass: "next-build",
    attempt: { claimKey: "host-resource:v2:invocation:digest" },
    ownerProvider: "codex",
    ownerSessionId: "thread-1",
    worktreePath: "D:/wt",
    branchName: "feat/x",
    pid: 42,
    processIdentity: "win32:638917704000000000",
    now: new Date("2026-08-25T10:00:00.000Z"),
    totalMemoryBytes: 64 * GiB,
    availableMemoryBytes: 24 * GiB,
    inferenceResident: true,
    ungovernedProcesses: [{ pid: 9, resourceClass: "vitest", disposition: "evidence-only" }],
  });

  assert.deepEqual(claim, {
    environmentKey: "host-heavy-resource",
    ownerProvider: "codex",
    ownerSessionId: "thread-1",
    claimKey: "host-resource:v2:invocation:digest",
    purpose: "host-resource:next-build",
    url: "host://localhost",
    ports: [],
    expiresAt: "2026-08-25T10:10:00.000Z",
    requestedTtlMs: 600_000,
    waitDeadlineAt: "2026-08-25T10:10:00.000Z",
    worktreePath: "D:/wt",
    branchName: "feat/x",
    resourceClass: "next-build",
    expectedMemoryBytes: 16 * GiB,
    ownerProcessId: 42,
    ownerProcessIdentity: "win32:638917704000000000",
    hostResource: {
      totalMemoryBytes: 64 * GiB,
      availableMemoryBytes: 24 * GiB,
      inferenceResident: true,
      ungovernedProcesses: [{ pid: 9, resourceClass: "vitest", disposition: "evidence-only" }],
    },
  });
});

test("canonical heavyweight package scripts cannot bypass the governed runner", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(manifest.scripts.typecheck, /host-resource-runner\.mjs --class typescript/);
  assert.match(manifest.scripts.test, /host-resource-runner\.mjs --class vitest/);
  assert.match(manifest.scripts.build, /host-resource-runner\.mjs --class next-build/);
  assert.match(manifest.scripts.dev, /host-resource-runner\.mjs --class preview/);
});


test("the loopback endpoints scripts/sync-mcp-worktrees.ps1 writes are accepted", () => {
  for (const url of [
    "http://127.0.0.1:3000/api/mcp/v1",
    "http://localhost:3000/api/mcp/v1",
    "https://127.0.0.1:3443/api/mcp/v1",
    "http://[::1]:3000/api/mcp/v1",
    "http://127.0.0.1/api/mcp/v1",
  ]) {
    assert.equal(isAllowedMcpEndpoint(url), true, url);
  }
});

test("an endpoint that would put the bearer token on another host is rejected", () => {
  for (const url of [
    "http://example.com/api/mcp/v1",
    "https://mcp.example.com/api/mcp/v1",
    // Loopback literal as userinfo -- the authority is example.com.
    "http://127.0.0.1@example.com/api/mcp/v1",
    "http://127.0.0.1:3000@example.com/api/mcp/v1",
    // Loopback literal as a subdomain label or path, not the host.
    "http://127.0.0.1.example.com/api/mcp/v1",
    "http://localhost.example.com/api/mcp/v1",
    "http://example.com/127.0.0.1/api/mcp/v1",
    // 127.0.0.2 is loopback to the kernel but is not an endpoint DPF publishes.
    "http://127.0.0.2:3000/api/mcp/v1",
    // Non-HTTP schemes never carry an Authorization header the way this client does.
    "file:///etc/passwd",
    "ftp://127.0.0.1/api/mcp/v1",
    "not a url",
    "",
  ]) {
    assert.equal(isAllowedMcpEndpoint(url), false, url);
  }
  assert.equal(isAllowedMcpEndpoint(undefined), false);
  assert.equal(isAllowedMcpEndpoint({ toString: () => "http://127.0.0.1:3000/" }), false);
});


// BI-5201141C: the admission connection no longer reads a project .mcp.json --
// on https no writer produces one, and it was ambient state copied between
// worktrees. It resolves like every other gate script (scripts/pregate.mjs):
// DPF_MCP_URL, else the local default, with the credential from
// scripts/lib/mcp-credential.mjs (client_credentials, then the legacy PAT).
// An env with no credential file keeps the operator's real one out of the test.
const NO_CLIENT_FILE = { DPF_MCP_CLIENT_CREDENTIALS_FILE: join(tmpdir(), "dpf-no-such-client-credentials.json") };

test("a project .mcp.json is not a credential source", () => {
  const cwd = mkdtempSync(join(tmpdir(), "dpf-mcp-config-"));
  writeFileSync(join(cwd, ".mcp.json"), JSON.stringify({
    mcpServers: { dpf: { url: "http://127.0.0.1:3000/api/mcp/v1", headers: { Authorization: "Bearer dpfmcp_seeded" } } },
  }));
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    assert.equal(readMcpConnection({ ...NO_CLIENT_FILE }), null);
  } finally {
    process.chdir(previous);
  }
});

test("no credential is an admission failure", () => {
  assert.equal(readMcpConnection({ ...NO_CLIENT_FILE }), null);
});

test("the legacy PAT reaches the local default endpoint when DPF_MCP_URL is unset", () => {
  assert.deepEqual(readMcpConnection({ ...NO_CLIENT_FILE, DPF_MCP_BEARER_TOKEN: "dpfmcp_env" }), {
    mcpUrl: "http://127.0.0.1:3000/api/mcp/v1",
    bearerToken: "dpfmcp_env",
  });
});

test("DPF_MCP_URL stays operator intent and is not narrowed to loopback", () => {
  assert.deepEqual(
    readMcpConnection({ ...NO_CLIENT_FILE, DPF_MCP_BEARER_TOKEN: "dpfmcp_env", DPF_MCP_URL: "https://mcp.example.com/api/mcp/v1" }),
    { mcpUrl: "https://mcp.example.com/api/mcp/v1", bearerToken: "dpfmcp_env" },
  );
});

test("a client_credentials client wins over the PAT", () => {
  const connection = readMcpConnection({
    ...NO_CLIENT_FILE,
    DPF_MCP_CLIENT_ID: "client-1",
    DPF_MCP_CLIENT_SECRET: "secret-1",
    DPF_MCP_BEARER_TOKEN: "dpfmcp_env",
  });
  assert.equal(connection.mcpUrl, "http://127.0.0.1:3000/api/mcp/v1");
  assert.equal(typeof connection.bearerToken.get, "function");
});
