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

const GiB = 1024 ** 3;

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
    source.indexOf("const child = createOwnedChild"),
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
    claimKey: "host-resource:thread-1:42",
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


// scripts/lib/mcp-client.mjs's own test file is a live-socket timing test held out
// of CI by scripts/ci-policy-test-inventory-allowlist.txt, so the endpoint guard is
// covered here -- next to the .mcp.json reader that is the reason it exists.

function seedMcpConfig(url, token = "dpfmcp_seeded") {
  const dir = mkdtempSync(join(tmpdir(), "dpf-mcp-config-"));
  writeFileSync(join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: { dpf: { url, headers: { Authorization: `Bearer ${token}` } } },
  }));
  return dir;
}

function withoutMcpEnv(run) {
  const { DPF_MCP_BEARER_TOKEN: token, DPF_MCP_URL: url } = process.env;
  delete process.env.DPF_MCP_BEARER_TOKEN;
  delete process.env.DPF_MCP_URL;
  try {
    return run();
  } finally {
    if (token === undefined) delete process.env.DPF_MCP_BEARER_TOKEN;
    else process.env.DPF_MCP_BEARER_TOKEN = token;
    if (url === undefined) delete process.env.DPF_MCP_URL;
    else process.env.DPF_MCP_URL = url;
  }
}

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

test("a seeded loopback .mcp.json still yields a usable connection", () => {
  const cwd = seedMcpConfig("http://127.0.0.1:3000/api/mcp/v1");
  assert.deepEqual(withoutMcpEnv(() => readMcpConnection(cwd)), {
    mcpUrl: "http://127.0.0.1:3000/api/mcp/v1",
    bearerToken: "dpfmcp_seeded",
  });
});

test("a .mcp.json naming a remote endpoint stops rather than sending the token off-box", () => {
  const cwd = seedMcpConfig("https://mcp.example.com/api/mcp/v1");
  assert.throws(
    () => withoutMcpEnv(() => readMcpConnection(cwd)),
    /not a local endpoint; refusing to send the bearer token off-box/,
  );
});

test("an absent .mcp.json is still an admission failure, not an endpoint refusal", () => {
  const cwd = mkdtempSync(join(tmpdir(), "dpf-mcp-config-"));
  assert.equal(withoutMcpEnv(() => readMcpConnection(cwd)), null);
});

test("DPF_MCP_URL stays operator intent and is not narrowed to loopback", () => {
  const cwd = seedMcpConfig("https://mcp.example.com/api/mcp/v1");
  const previous = { ...process.env };
  process.env.DPF_MCP_BEARER_TOKEN = "dpfmcp_env";
  process.env.DPF_MCP_URL = "https://mcp.example.com/api/mcp/v1";
  try {
    assert.deepEqual(readMcpConnection(cwd), {
      mcpUrl: "https://mcp.example.com/api/mcp/v1",
      bearerToken: "dpfmcp_env",
    });
  } finally {
    if (previous.DPF_MCP_BEARER_TOKEN === undefined) delete process.env.DPF_MCP_BEARER_TOKEN;
    else process.env.DPF_MCP_BEARER_TOKEN = previous.DPF_MCP_BEARER_TOKEN;
    if (previous.DPF_MCP_URL === undefined) delete process.env.DPF_MCP_URL;
    else process.env.DPF_MCP_URL = previous.DPF_MCP_URL;
  }
});
