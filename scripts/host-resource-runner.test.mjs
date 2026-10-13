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
} from "./host-resource-runner.mjs";
import { isAllowedMcpEndpoint } from "./lib/mcp-client.mjs";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolveHostAttempt, hostResumePin } from "./lib/host-resource-attempt.mjs";

const GiB = 1024 ** 3;

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
