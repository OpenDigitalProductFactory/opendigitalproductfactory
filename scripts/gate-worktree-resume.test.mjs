// BI-D35B85BF — the whole gate against a stub MCP server: a cancelled wait
// stays cancelled, and a resumed gate whose source moved claims nothing.
// The pure decisions behind both are in lib/gate-resume-pin.test.mjs.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EXIT_SOURCE_DRIFT, EXIT_WAIT_CANCELLED } from "./lib/sandbox-freshness.mjs";

// No real resumer may outlive a test that talks to a stub server.
process.env.DPF_DURABLE_RESUMER = "off";

const HOST_PRESSURE = {
  observedAt: "2026-09-24T00:00:00.000Z",
  availableMemoryBytes: 16 * 1024 ** 3,
  sustainedCpuPercent: 20,
  diskFreeBytes: 500 * 1024 ** 3,
  dockerHealthy: true,
  convergenceActive: false,
  fencesHealthy: true,
  evidenceIsolationHealthy: true,
};

function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env, NODE_ENV: "test", DPF_LOCAL_CI_HOST_PRESSURE_JSON: JSON.stringify(HOST_PRESSURE) },
    });
    let output = "";
    const timeout = setTimeout(() => { child.kill(); resolve({ code: -1, output: `${output}\n[harness] timed out` }); }, 20_000);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code) => { clearTimeout(timeout); resolve({ code, output }); });
  });
}

function makeWorktree() {
  const dir = mkdtempSync(join(tmpdir(), "dpf-gate-resume-"));
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  git(["init", "-q", "-b", "fix/resume"]);
  git(["config", "user.name", "DPF Test"]);
  git(["config", "user.email", "dpf-test@example.invalid"]);
  writeFileSync(join(dir, "README.md"), "resume\n");
  git(["add", "README.md"]);
  git(["commit", "-q", "-m", "init"]);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  return { dir, sha: git(["rev-parse", "HEAD"]) };
}

async function stubServer(answer) {
  const claims = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      if (tool === "claim_nonprod_environment_lease") claims.push(payload.params.arguments);
      const result = answer(tool, claims.length);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    claims,
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); },
  };
}

const baseEnv = () => ({
  DPF_MCP_BEARER_TOKEN: "test-token",
  DPF_ALLOW_LOCAL_CI_STUB: "1",
  DPF_GATE_RETRY_JITTER: "0",
  DPF_LOCAL_SANDBOX_FENCE_PATH: join(mkdtempSync(join(tmpdir(), "dpf-gate-fence-")), "owner.json"),
});

test("AC-DW-01: a queued wait that is cancelled stays cancelled; no replacement claim is made", async () => {
  const server = await stubServer((tool, claimCount) => {
    if (tool !== "claim_nonprod_environment_lease") return { success: true };
    return claimCount === 1
      ? { success: true, entityId: "NPEL-QUEUED", data: { lease: { leaseId: "NPEL-QUEUED" }, admission: { status: "queued", queuePosition: 2, waitAgeMs: 10 } } }
      : { success: false, error: "lease_terminal", entityId: "NPEL-QUEUED", data: { reason: "cancelled", lease: { leaseId: "NPEL-QUEUED", status: "cancelled" } } };
  });
  try {
    const worktree = makeWorktree();
    const result = await run([
      "scripts/gate-worktree.mjs", "--branch", "fix/resume", "--worktree", worktree.dir,
      "--owner-provider", "claude", "--owner-session-id", "session-1",
      "--expires-minutes", "0.05", "--poll-seconds", "0.01", "--mcp-url", server.url, "--no-push",
    ], baseEnv());
    assert.equal(result.code, EXIT_WAIT_CANCELLED, result.output);
    assert.equal(server.claims.length, 2, "the queued claim and the one that learned it was cancelled");
    assert.equal(server.claims[1].resumeLeaseId, "NPEL-QUEUED", "the re-claim names the lease it waits on");
    assert.doesNotMatch(result.output, /creating fresh admission attempt/);
    assert.match(result.output, /local_ci_wait_cancelled/);
  } finally {
    await server.close();
  }
});

test("AC-DW-03: a resumed gate whose worktree moved claims nothing and never falls back to a legacy key", async () => {
  const server = await stubServer(() => ({ success: true }));
  try {
    const worktree = makeWorktree();
    const result = await run([
      "scripts/gate-worktree.mjs", "--branch", "fix/resume", "--worktree", worktree.dir,
      "--owner-provider", "claude", "--owner-session-id", "session-1",
      "--sha", "a".repeat(40), "--resume-lease-id", "NPEL-PINNED",
      "--expires-minutes", "0.05", "--poll-seconds", "0.01", "--mcp-url", server.url, "--no-push",
    ], baseEnv());
    assert.equal(result.code, EXIT_SOURCE_DRIFT, result.output);
    assert.equal(server.claims.length, 0);
    assert.match(result.output, /local_ci_resume_source_drift/);
    assert.match(result.output, /head-moved/);
  } finally {
    await server.close();
  }
});

test("a resumed gate with a dirty worktree is drift too", async () => {
  const server = await stubServer(() => ({ success: true }));
  try {
    const worktree = makeWorktree();
    writeFileSync(join(worktree.dir, "uncommitted.txt"), "dirt\n");
    const result = await run([
      "scripts/gate-worktree.mjs", "--branch", "fix/resume", "--worktree", worktree.dir,
      "--owner-provider", "claude", "--owner-session-id", "session-1",
      "--sha", worktree.sha, "--resume-lease-id", "NPEL-PINNED",
      "--expires-minutes", "0.05", "--poll-seconds", "0.01", "--mcp-url", server.url, "--no-push",
    ], baseEnv());
    assert.equal(result.code, EXIT_SOURCE_DRIFT, result.output);
    assert.equal(server.claims.length, 0);
    assert.match(result.output, /worktree-dirty/);
  } finally {
    await server.close();
  }
});
