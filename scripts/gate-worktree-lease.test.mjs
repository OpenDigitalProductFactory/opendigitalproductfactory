import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  collectDescendantPids,
  createProcessTreeTracker,
  defaultDescendantPollMs,
  defaultProcessScanMs,
  findConflictingLocalCiMutatorPids,
  findLiveLocalCiMutatorPids,
  executionPressureFenceReason,
} from "./gate-worktree.mjs";
import { readProcessIdentity } from "./lib/local-sandbox-fence.mjs";

const TEST_HOST_PRESSURE = {
  observedAt: "2026-07-30T05:00:00.000Z",
  availableMemoryBytes: 16 * 1024 ** 3,
  sustainedCpuPercent: 20,
  diskFreeBytes: 500 * 1024 ** 3,
  dockerHealthy: true,
  convergenceActive: false,
  fencesHealthy: true,
  evidenceIsolationHealthy: true,
};

test("active pressure fencing reacts only to hard execution-safety losses", () => {
  for (const reason of [
    "host-memory-low",
    "host-memory-unmeasurable",
    "host-disk-low",
    "host-disk-unmeasurable",
    "docker-unhealthy",
    "slot-fence-unhealthy",
    "evidence-isolation-unproven",
  ]) {
    assert.equal(
      executionPressureFenceReason({ rollbackReason: reason }),
      `host-capacity-lost:${reason}`,
    );
  }
  assert.equal(executionPressureFenceReason({ rollbackReason: "host-cpu-high" }), null);
  assert.equal(executionPressureFenceReason({ rollbackReason: "requested-singleton" }), null);
  assert.equal(executionPressureFenceReason(null), null);
});

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      env: {
        ...options.env,
        NODE_ENV: "test",
        DPF_LOCAL_CI_HOST_PRESSURE_JSON: JSON.stringify(TEST_HOST_PRESSURE),
      },
    });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      resolve({
        code: -1,
        output: `${output}\n[test harness] gate child timed out after 20s`,
      });
    }, 20_000);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });
}

function isolatedFencePath() {
  return join(mkdtempSync(join(tmpdir(), "dpf-gate-fence-")), "owner.json");
}

function makeTempWorktree() {
  const dir = mkdtempSync(join(tmpdir(), "dpf-gate-worktree-"));
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    }
  };
  git(["init", "-q"]);
  git(["config", "user.name", "DPF Test"]);
  git(["config", "user.email", "dpf-test@example.invalid"]);
  writeFileSync(join(dir, "README.md"), "gate test\n");
  git(["add", "README.md"]);
  git(["commit", "-q", "-m", "init"]);
  return dir;
}

function makeDocumentationWorktree() {
  const dir = mkdtempSync(join(tmpdir(), "dpf-gate-doc-worktree-"));
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout.trim();
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "DPF Test"]);
  git(["config", "user.email", "dpf-test@example.invalid"]);
  spawnSync(process.execPath, ["-e", [
    "const { mkdirSync, writeFileSync } = require('node:fs');",
    "mkdirSync('scripts', { recursive: true });",
    "writeFileSync('README.md', 'base\\n');",
    "writeFileSync('scripts/ci-evidence-plan.mjs', `import { writeFileSync } from 'node:fs'; const i=process.argv.indexOf('--output'); writeFileSync(process.argv[i+1], JSON.stringify({executionLane:'documentation',digest:'doc-plan',fullSuite:false,scope:{docsOnly:true},headTreeSha:process.env.DPF_TEST_HEAD_TREE})+'\\n');`);",
    "for (const name of ['gen-doc-index.mjs','check-doc-links.mjs','check-guards.mjs']) writeFileSync(`scripts/${name}`, 'process.exit(0);\\n');",
  ].join(" ")], { cwd: dir, encoding: "utf8" });
  git(["add", "."]);
  git(["commit", "-q", "-m", "base"]);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(["switch", "-q", "-c", "docs/lease-bypass"]);
  writeFileSync(join(dir, "README.md"), "base\ndocumentation change\n");
  git(["add", "README.md"]);
  git(["commit", "-q", "-m", "docs"]);
  return { dir, sha: git(["rev-parse", "HEAD"]), tree: git(["rev-parse", "HEAD^{tree}"]) };
}

test("documentation evidence completes without claiming a heavyweight lease", async () => {
  const calls = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      calls.push(payload.params.name);
      const result = payload.params.name === "record_local_integration_result"
        ? { success: true, entityId: "EVIDENCE-DOC-LANE" }
        : { success: true, data: { level: "normal" } };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const worktree = makeDocumentationWorktree();

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "docs/lease-bypass",
      "--sha", worktree.sha,
      "--worktree", worktree.dir,
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_GATE_OWNER_PROVIDER: "codex",
        DPF_GATE_OWNER_SESSION_ID: "doc-lane-test",
        DPF_TEST_HEAD_TREE: worktree.tree,
      },
    });

    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /documentation evidence passed without heavyweight admission/);
    assert.equal(calls.includes("claim_nonprod_environment_lease"), false, calls.join(", "));
    assert.equal(calls.includes("renew_nonprod_environment_lease"), false, calls.join(", "));
    assert.equal(calls.filter((tool) => tool === "record_local_integration_result").length, 1);
  } finally {
    rmSync(worktree.dir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
});

test("canonical gate heartbeats during a long command and releases once", async () => {
  const calls = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      calls.push(tool);
      const result = tool === "claim_nonprod_environment_lease"
        ? { success: true, entityId: "NPEL-TEST" }
        : tool === "record_local_integration_result"
          ? { success: true, entityId: "EVIDENCE-TEST" }
          : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const delayCommand = `"${process.execPath}" -e "setTimeout(() => {}, 1300)"`;
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/sandbox-lease-fencing",
      "--worktree", makeTempWorktree(),
      "--expires-minutes", "0.05",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_LOCAL_CI_COMMAND: delayCommand,
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    assert.ok(calls.includes("renew_nonprod_environment_lease"), `${calls.join(", ")}\n${result.output}`);
    assert.equal(calls.filter((tool) => tool === "release_nonprod_environment_lease").length, 1);
    assert.ok(calls.indexOf("renew_nonprod_environment_lease") < calls.indexOf("release_nonprod_environment_lease"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("durable queue observation reuses claimKey and grants a fresh admitted TTL", async () => {
  const claims = [];
  let leaseLists = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      if (tool === "list_nonprod_environment_leases") leaseLists += 1;
      if (tool === "claim_nonprod_environment_lease") {
        claims.push({ receivedAt: Date.now(), args: payload.params.arguments });
      }
      const result = tool === "claim_nonprod_environment_lease" && claims.length === 1
        ? {
          success: true,
          entityId: "NPEL-QUEUE-TEST",
          data: {
            lease: { leaseId: "NPEL-QUEUE-TEST" },
            admission: { status: "queued", queuePosition: 2, waitAgeMs: 20 },
          },
        }
        : tool === "claim_nonprod_environment_lease"
          ? {
            success: true,
            entityId: "NPEL-QUEUE-TEST",
            data: {
              lease: { leaseId: "NPEL-QUEUE-TEST" },
              admission: { status: "admitted", slotKey: "slot-0", waitAgeMs: 80 },
            },
          }
          : tool === "record_local_integration_result"
            ? { success: true, entityId: "EVIDENCE-QUEUE-TEST" }
            : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/sandbox-lease-fencing",
      "--worktree", makeTempWorktree(),
      "--expires-minutes", "0.05",
      "--poll-seconds", "0.05",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_GATE_RETRY_JITTER: "0",
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    assert.equal(claims.length, 2);
    assert.equal(leaseLists, 1, "queue reconciliation should be cached across a short admission retry");
    assert.equal(claims[0].args.claimKey, claims[1].args.claimKey);
    assert.match(
      claims[0].args.claimKey,
      /^local-ci:[^:]+:[0-9a-f]{40}$/,
    );
    const grantedMs = Date.parse(claims[1].args.expiresAt) - claims[1].receivedAt;
    assert.ok(grantedMs >= 2_800, `expected a fresh ~3s TTL, got ${grantedMs}ms`);
    assert.match(result.output, /queued at position 2/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a server-owned durable queue response checkpoints once and exits without polling or releasing", async () => {
  const calls = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      calls.push(payload.params.name);
      const result = payload.params.name === "claim_nonprod_environment_lease"
        ? {
          success: true,
          entityId: "NPEL-DURABLE",
          data: {
            lease: { leaseId: "NPEL-DURABLE" },
            admission: {
              status: "queued", queuePosition: 3, waitAgeMs: 20,
              resumeMode: "durable-task", taskRunId: "TR-NONPROD-DURABLE",
            },
          },
        }
        : { success: true, data: { leases: [], queued: [] } };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0", id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const worktree = makeTempWorktree();
  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs", "--branch", "fix/durable-wait", "--worktree", worktree,
      "--lease-wait-seconds", "60", "--mcp-url", `http://127.0.0.1:${address.port}`, "--no-push",
    ], { cwd: process.cwd(), env: {
      ...process.env, DPF_MCP_BEARER_TOKEN: "test-token", DPF_ALLOW_LOCAL_CI_STUB: "1",
      DPF_GATE_RETRY_JITTER: "0", DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
    } });
    assert.equal(result.code, 75, result.output);
    assert.equal(calls.filter((tool) => tool === "claim_nonprod_environment_lease").length, 1);
    assert.equal(calls.includes("renew_nonprod_environment_lease"), false);
    assert.equal(calls.includes("release_nonprod_environment_lease"), false);
    assert.match(result.output, /TR-NONPROD-DURABLE/);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a subscriber observes the canonical run and reuses its terminal evidence without authority", async () => {
  const calls = [];
  let claims = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      calls.push(tool);
      if (tool === "claim_nonprod_environment_lease") claims += 1;
      const result = tool === "claim_nonprod_environment_lease" && claims === 1
        ? {
          success: true,
          entityId: "NPEL-WINNER",
          data: {
            gateKey: "a".repeat(64),
            lease: { leaseId: "NPEL-WINNER" },
            admission: { status: "subscribed", executionStatus: "admitted" },
          },
        }
        : tool === "claim_nonprod_environment_lease"
          ? {
            success: true,
            entityId: "EXT-WINNER",
            data: {
              gateKey: "a".repeat(64),
              lease: { leaseId: "NPEL-WINNER" },
              admission: {
                status: "reused",
                evidenceRecordId: "EXT-WINNER",
                resultClass: "pass",
              },
            },
          }
          : { success: true, data: { level: "normal" } };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const worktree = makeTempWorktree();

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/subscriber-reuse",
      "--worktree", worktree,
      "--poll-seconds", "0.01",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_GATE_RETRY_JITTER: "0",
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /owned by another caller/);
    assert.match(result.output, /reused canonical local-CI pass evidence: EXT-WINNER/);
    assert.equal(calls.filter((tool) => tool === "claim_nonprod_environment_lease").length, 2);
    assert.equal(calls.includes("renew_nonprod_environment_lease"), false);
    assert.equal(calls.includes("release_nonprod_environment_lease"), false);
    assert.equal(calls.includes("record_local_integration_result"), false);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("released terminal claim from a prior run gets a fresh rerun claimKey", async () => {
  const claims = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      if (tool === "claim_nonprod_environment_lease") {
        claims.push(payload.params.arguments);
      }
      const result = tool === "claim_nonprod_environment_lease" && claims.length === 1
        ? {
          success: false,
          error: "lease_terminal",
          entityId: "NPEL-PRIOR-RUN",
          data: {
            reason: "released",
            lease: {
              leaseId: "NPEL-PRIOR-RUN",
              status: "released",
            },
          },
        }
        : tool === "claim_nonprod_environment_lease"
          ? {
            success: true,
            entityId: "NPEL-RERUN",
            data: {
              lease: { leaseId: "NPEL-RERUN" },
              admission: { status: "admitted", slotKey: "slot-0", waitAgeMs: 0 },
            },
          }
          : tool === "record_local_integration_result"
            ? { success: true, entityId: "EVIDENCE-RERUN" }
            : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/sandbox-lease-fencing",
      "--worktree", makeTempWorktree(),
      "--expires-minutes", "0.05",
      "--poll-seconds", "0.01",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_GATE_RETRY_JITTER: "0",
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    assert.equal(claims.length, 2);
    assert.notEqual(claims[0].claimKey, claims[1].claimKey);
    assert.match(claims[1].claimKey, /:rerun-1$/);
    assert.match(result.output, /creating fresh admission attempt 1/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("terminal claim replacement advances past an expired rerun from a prior process", async () => {
  const claims = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      if (tool === "claim_nonprod_environment_lease") {
        claims.push(payload.params.arguments);
      }
      const claimNumber = claims.length;
      const result = tool === "claim_nonprod_environment_lease" && claimNumber === 1
        ? {
          success: false,
          error: "lease_terminal",
          entityId: "NPEL-PRIOR-RUN",
          data: {
            reason: "released",
            lease: {
              leaseId: "NPEL-PRIOR-RUN",
              claimKey: claims[0].claimKey,
              status: "released",
            },
          },
        }
        : tool === "claim_nonprod_environment_lease" && claimNumber === 2
          ? {
            success: false,
            error: "lease_terminal",
            entityId: "NPEL-EXPIRED-RERUN",
            data: {
              reason: "expired",
              lease: {
                leaseId: "NPEL-EXPIRED-RERUN",
                claimKey: claims[1].claimKey,
                status: "expired",
              },
            },
          }
          : tool === "claim_nonprod_environment_lease"
            ? {
              success: true,
              entityId: "NPEL-FRESH-RERUN",
              data: {
                lease: { leaseId: "NPEL-FRESH-RERUN" },
                admission: { status: "admitted", slotKey: "slot-0", waitAgeMs: 0 },
              },
            }
            : tool === "record_local_integration_result"
              ? { success: true, entityId: "EVIDENCE-FRESH-RERUN" }
              : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const worktree = makeTempWorktree();
  const stateFile = join(worktree, ".git", "dpf-local-ci-gate.json");

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/sandbox-lease-fencing",
      "--worktree", worktree,
      "--expires-minutes", "0.05",
      "--poll-seconds", "0.01",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_GATE_RETRY_JITTER: "0",
        DPF_GATE_OWNER_PROVIDER: "codex",
        DPF_GATE_OWNER_SESSION_ID: "test-terminal-claim-owner",
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    assert.equal(claims.length, 3);
    assert.match(claims[0].claimKey, /^local-ci:[^:]+:[0-9a-f]{40}$/);
    assert.match(claims[1].claimKey, /:rerun-1$/);
    assert.match(claims[2].claimKey, /:rerun-2$/);
    assert.ok(claims.every((claim) => claim.ownerProvider === "codex"));
    assert.ok(claims.every(
      (claim) => claim.ownerSessionId === "test-terminal-claim-owner",
    ));
    assert.match(result.output, /creating fresh admission attempt 2/);
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.deepEqual(
      state.leaseEvents
        .filter((event) => event.type === "terminal-claim-replaced")
        .map((event) => ({
          terminalReason: event.terminalReason,
          terminalAttemptSequence: event.terminalAttemptSequence,
          priorClaimKey: event.priorClaimKey,
          replacementClaimKey: event.replacementClaimKey,
          interruptedByQuiescence: event.interruptedByQuiescence,
        })),
      [
        {
          terminalReason: "released",
          terminalAttemptSequence: 1,
          priorClaimKey: claims[0].claimKey,
          replacementClaimKey: claims[1].claimKey,
          interruptedByQuiescence: false,
        },
        {
          terminalReason: "expired",
          terminalAttemptSequence: 2,
          priorClaimKey: claims[1].claimKey,
          replacementClaimKey: claims[2].claimKey,
          interruptedByQuiescence: false,
        },
      ],
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("cancelled terminal claim from an interrupted run gets a fresh rerun claimKey", async () => {
  const claims = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      if (tool === "claim_nonprod_environment_lease") {
        claims.push(payload.params.arguments);
      }
      const result = tool === "claim_nonprod_environment_lease" && claims.length === 1
        ? {
          success: false,
          error: "lease_terminal",
          entityId: "NPEL-INTERRUPTED-RUN",
          data: {
            reason: "cancelled",
            lease: {
              leaseId: "NPEL-INTERRUPTED-RUN",
              status: "cancelled",
            },
          },
        }
        : tool === "claim_nonprod_environment_lease"
          ? {
            success: true,
            entityId: "NPEL-RERUN",
            data: {
              lease: { leaseId: "NPEL-RERUN" },
              admission: { status: "admitted", slotKey: "slot-0", waitAgeMs: 0 },
            },
          }
          : tool === "record_local_integration_result"
            ? { success: true, entityId: "EVIDENCE-RERUN" }
            : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/sandbox-lease-fencing",
      "--worktree", makeTempWorktree(),
      "--expires-minutes", "0.05",
      "--poll-seconds", "0.01",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_GATE_RETRY_JITTER: "0",
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    assert.equal(claims.length, 2);
    assert.notEqual(claims[0].claimKey, claims[1].claimKey);
    assert.match(claims[1].claimKey, /:rerun-1$/);
    assert.match(result.output, /previous local-CI lease claim was cancelled/);
    assert.match(result.output, /creating fresh admission attempt 1/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("queued admission writes recoverable gate state before waiting", async () => {
  const claims = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      if (tool === "claim_nonprod_environment_lease") {
        claims.push(payload.params.arguments);
      }
      const result = tool === "claim_nonprod_environment_lease"
        ? {
          success: true,
          entityId: "NPEL-QUEUED-STATE",
          data: {
            lease: { leaseId: "NPEL-QUEUED-STATE" },
            admission: { status: "queued", queuePosition: 1, waitAgeMs: 10 },
          },
        }
        : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const worktree = makeTempWorktree();
  const stateFile = join(worktree, ".git", "dpf-local-ci-gate.json");

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/sandbox-lease-fencing",
      "--worktree", worktree,
      "--lease-wait-seconds", "0.02",
      "--expires-minutes", "0.05",
      "--poll-seconds", "0.01",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_GATE_RETRY_JITTER: "0",
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.notEqual(result.code, 0, result.output);
    assert.ok(claims.length >= 1);
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.equal(state.status, "queued");
    assert.equal(state.leaseId, "NPEL-QUEUED-STATE");
    assert.equal(state.leaseEvents.at(-1).type, "queued");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a queued observer re-establishes intent after quiescence expires its claim", async () => {
  const claims = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      if (tool === "claim_nonprod_environment_lease") {
        claims.push(payload.params.arguments);
      }
      const claimNumber = claims.length;
      const result = tool === "claim_nonprod_environment_lease" && claimNumber === 1
        ? {
          success: true,
          entityId: "NPEL-QUIESCENCE-EXPIRED",
          data: {
            lease: { leaseId: "NPEL-QUIESCENCE-EXPIRED" },
            admission: { status: "queued", queuePosition: 1, waitAgeMs: 20 },
          },
        }
        : tool === "claim_nonprod_environment_lease" && claimNumber === 2
          ? {
            success: false,
            error: "portal_quiescing",
            data: { retryAfterSeconds: 0.01 },
          }
          : tool === "claim_nonprod_environment_lease" && claimNumber === 3
            ? {
              success: false,
              error: "lease_terminal",
              entityId: "NPEL-QUIESCENCE-EXPIRED",
              data: {
                reason: "expired",
                lease: {
                  leaseId: "NPEL-QUIESCENCE-EXPIRED",
                  status: "expired",
                },
              },
            }
            : tool === "claim_nonprod_environment_lease"
              ? {
                success: true,
                entityId: "NPEL-QUIESCENCE-RECOVERED",
                data: {
                  lease: { leaseId: "NPEL-QUIESCENCE-RECOVERED" },
                  admission: { status: "admitted", slotKey: "slot-0", waitAgeMs: 0 },
                },
              }
              : tool === "record_local_integration_result"
                ? { success: true, entityId: "EVIDENCE-QUIESCENCE-RECOVERED" }
                : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const worktree = makeTempWorktree();
  const stateFile = join(worktree, ".git", "dpf-local-ci-gate.json");

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/sandbox-lease-fencing",
      "--worktree", worktree,
      "--expires-minutes", "0.05",
      "--poll-seconds", "0.01",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_GATE_RETRY_JITTER: "0",
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    assert.equal(claims.length, 4);
    assert.equal(claims[0].claimKey, claims[1].claimKey);
    assert.equal(claims[1].claimKey, claims[2].claimKey);
    assert.notEqual(claims[2].claimKey, claims[3].claimKey);
    assert.match(claims[3].claimKey, /:rerun-1$/);
    assert.match(result.output, /re-establishing queue intent/);
    const recoveryEvent = JSON.parse(readFileSync(stateFile, "utf8"))
      .leaseEvents
      .find((event) => event.type === "queue-intent-reestablished");
    assert.deepEqual(
      {
        terminalReason: recoveryEvent?.terminalReason,
        terminalAttemptSequence: recoveryEvent?.terminalAttemptSequence,
        priorClaimKey: recoveryEvent?.priorClaimKey,
        replacementClaimKey: recoveryEvent?.replacementClaimKey,
        interruptedByQuiescence: recoveryEvent?.interruptedByQuiescence,
      },
      {
        terminalReason: "expired",
        terminalAttemptSequence: 1,
        priorClaimKey: claims[2].claimKey,
        replacementClaimKey: claims[3].claimKey,
        interruptedByQuiescence: true,
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("canonical local-CI claims request no more than the admitted-owner recovery TTL", async () => {
  const claims = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      if (tool === "claim_nonprod_environment_lease") {
        claims.push({ receivedAt: Date.now(), args: payload.params.arguments });
      }
      const result = tool === "claim_nonprod_environment_lease"
        ? {
          success: true,
          entityId: "NPEL-SHORT-ACTIVE",
          data: {
            lease: {
              leaseId: "NPEL-SHORT-ACTIVE",
              expiresAt: payload.params.arguments.expiresAt,
            },
            admission: { status: "admitted", slotKey: "slot-0", waitAgeMs: 1 },
          },
        }
        : tool === "record_local_integration_result"
          ? { success: true, entityId: "EVIDENCE-SHORT-ACTIVE" }
          : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/admitted-owner-recovery",
      "--worktree", process.cwd(),
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    assert.equal(claims.length, 1);
    const requestedMs =
      Date.parse(claims[0].args.expiresAt) - claims[0].receivedAt;
    assert.ok(requestedMs > 119_000, `expected about two minutes, got ${requestedMs}ms`);
    assert.ok(requestedMs <= 120_000, `expected at most two minutes, got ${requestedMs}ms`);
    assert.equal(claims[0].args.slotManifestVersion, 1);
    assert.deepEqual(claims[0].args.hostPressure, TEST_HOST_PRESSURE);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("slot-1 metadata is bound through renewal before the canonical gate runs", async () => {
  const calls = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      calls.push({ tool, args: payload.params.arguments });
      const result = tool === "claim_nonprod_environment_lease"
        ? {
          success: true,
          entityId: "NPEL-SLOT-1",
          data: {
            lease: {
              leaseId: "NPEL-SLOT-1",
              expiresAt: new Date(Date.now() + 10_000).toISOString(),
            },
            admission: { status: "admitted", slotKey: "slot-1", waitAgeMs: 1 },
          },
        }
        : tool === "renew_nonprod_environment_lease"
          ? {
            success: true,
            data: {
              lease: {
                leaseId: "NPEL-SLOT-1",
                expiresAt: new Date(Date.now() + 10_000).toISOString(),
              },
            },
          }
          : tool === "record_local_integration_result"
            ? { success: true, entityId: "EVIDENCE-SLOT-1" }
            : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "feat/two-slot-binding",
      "--worktree", process.cwd(),
      "--expires-minutes", "0.05",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    const claimIndex = calls.findIndex((call) =>
      call.tool === "claim_nonprod_environment_lease");
    const bindingIndex = calls.findIndex((call) =>
      call.tool === "renew_nonprod_environment_lease"
      && call.args.slotBinding);
    const evidenceIndex = calls.findIndex((call) =>
      call.tool === "record_local_integration_result");
    assert.ok(claimIndex >= 0 && bindingIndex > claimIndex, JSON.stringify(calls));
    assert.ok(evidenceIndex > bindingIndex, JSON.stringify(calls));
    assert.deepEqual(calls[bindingIndex].args.slotBinding, {
      manifestVersion: 1,
      slotKey: "slot-1",
      url: "http://localhost:3011",
      ports: [3011, 15433],
      cleanupCommand: "node scripts/local-ci-slot-cleanup.mjs --slot-key slot-1",
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("an admitted owner renews authority while a live host fence delays the run", async () => {
  const calls = [];
  const fencePath = isolatedFencePath();
  writeFileSync(fencePath, `${JSON.stringify({
    schema: "dpf-local-sandbox-fence/v1",
    token: "prior-live-owner",
    pid: process.pid,
    processIdentity: readProcessIdentity(process.pid),
    ownerSessionId: "prior-live-owner",
    branch: "fix/prior-owner",
    acquiredAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  })}\n`);

  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      calls.push(tool);
      const result = tool === "claim_nonprod_environment_lease"
        ? {
          success: true,
          entityId: "NPEL-HOST-FENCE-WAIT",
          data: {
            lease: {
              leaseId: "NPEL-HOST-FENCE-WAIT",
              expiresAt: new Date(Date.now() + 10_000).toISOString(),
            },
            admission: { status: "admitted", slotKey: "slot-0", waitAgeMs: 1 },
          },
        }
        : tool === "renew_nonprod_environment_lease"
          ? {
            success: true,
            entityId: "NPEL-HOST-FENCE-WAIT",
            data: {
              lease: {
                leaseId: "NPEL-HOST-FENCE-WAIT",
                expiresAt: new Date(Date.now() + 10_000).toISOString(),
              },
            },
          }
          : tool === "record_local_integration_result"
            ? { success: true, entityId: "EVIDENCE-HOST-FENCE-WAIT" }
            : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const releasePriorFence = setTimeout(() => rmSync(fencePath, { force: true }), 150);

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/admitted-owner-recovery",
      "--worktree", process.cwd(),
      "--expires-minutes", "0.05",
      "--poll-seconds", "0.05",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_LOCAL_SANDBOX_FENCE_PATH: fencePath,
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    assert.ok(
      calls.indexOf("renew_nonprod_environment_lease")
        < calls.indexOf("record_local_integration_result"),
      `${calls.join(", ")}\n${result.output}`,
    );
  } finally {
    clearTimeout(releasePriorFence);
    rmSync(fencePath, { force: true });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a same-host dead queued observer is cancelled before the live waiter claims", async () => {
  const calls = [];
  const observerDirectory = mkdtempSync(join(tmpdir(), "dpf-gate-observers-"));
  const deadToken = "77777777-7777-4777-8777-777777777777";
  const deadPid = 2_147_483_000;
  const deadOwner = `gate-v2-${deadToken}-${deadPid}`;
  writeFileSync(
    join(observerDirectory, `${deadToken}.json`),
    JSON.stringify({
      schema: "dpf-local-ci-queue-observer/v1",
      observerToken: deadToken,
      pid: deadPid,
      ownerSessionId: deadOwner,
      branch: "fix/dead",
      sha: "d".repeat(40),
      registeredAt: "2026-07-29T20:00:00.000Z",
    }),
  );
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      calls.push({ tool, args: payload.params.arguments });
      const result = tool === "list_nonprod_environment_leases"
        ? {
          success: true,
          data: {
            leases: [],
            queued: [{
              leaseId: "NPEL-DEAD-OBSERVER",
              environmentKey: "local-integration-ci",
              status: "queued",
              ownerSessionId: deadOwner,
            }],
          },
        }
        : tool === "claim_nonprod_environment_lease"
          ? {
            success: true,
            entityId: "NPEL-LIVE-OBSERVER",
            data: {
              lease: { leaseId: "NPEL-LIVE-OBSERVER" },
              admission: { status: "admitted", slotKey: "slot-0", waitAgeMs: 1 },
            },
          }
          : tool === "record_local_integration_result"
            ? { success: true, entityId: "EVIDENCE-DEAD-OBSERVER" }
            : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/dead-waiter-reconciliation",
      "--worktree", makeTempWorktree(),
      "--owner-session-id", "integration-test-live-owner",
      "--expires-minutes", "0.05",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_LOCAL_QUEUE_OBSERVER_DIR: observerDirectory,
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    const deadRelease = calls.findIndex(
      (call) => call.tool === "release_nonprod_environment_lease"
        && call.args.leaseId === "NPEL-DEAD-OBSERVER",
    );
    const claim = calls.findIndex((call) => call.tool === "claim_nonprod_environment_lease");
    assert.ok(deadRelease >= 0, result.output);
    assert.ok(deadRelease < claim, JSON.stringify(calls));
    assert.match(result.output, /cancelled dead same-host queue observer NPEL-DEAD-OBSERVER/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admitted gate writes running state before starting the expensive command", async () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-gate-running-state-"));
  const observedState = join(temp, "observed-state.json");
  const childScript = join(temp, "observe-state.mjs");
  writeFileSync(
    childScript,
    [
      "import { readFileSync, writeFileSync } from \"node:fs\";",
      "writeFileSync(process.env.DPF_OBSERVED_GATE_STATE_FILE, readFileSync(process.env.DPF_LOCAL_CI_GATE_STATE_FILE, \"utf8\"));",
      "",
    ].join("\n"),
  );
  const calls = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      calls.push(tool);
      const result = tool === "claim_nonprod_environment_lease"
        ? {
          success: true,
          entityId: "NPEL-RUNNING-STATE",
          data: {
            lease: { leaseId: "NPEL-RUNNING-STATE" },
            admission: { status: "admitted", slotKey: "slot-0", waitAgeMs: 1 },
          },
        }
        : tool === "record_local_integration_result"
          ? { success: true, entityId: "EVIDENCE-RUNNING-STATE" }
          : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/local-ci-descendant-fence",
      "--worktree", makeTempWorktree(),
      "--expires-minutes", "0.05",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_LOCAL_CI_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(childScript)}`,
        DPF_OBSERVED_GATE_STATE_FILE: observedState,
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    const state = JSON.parse(await readFile(observedState, "utf8"));
    assert.equal(state.branch, "fix/local-ci-descendant-fence");
    assert.equal(state.leaseId, "NPEL-RUNNING-STATE");
    assert.equal(state.status, "running");
    assert.equal(state.gatePassed, false);
    assert.ok(calls.includes("release_nonprod_environment_lease"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rolling upgrade observes the legacy conflict contract without failing", async () => {
  const claims = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      if (tool === "claim_nonprod_environment_lease") {
        claims.push(payload.params.arguments);
      }
      const result = tool === "claim_nonprod_environment_lease" && claims.length === 1
        ? { success: false, error: "lease_conflict" }
        : tool === "claim_nonprod_environment_lease"
          ? { success: true, entityId: "NPEL-LEGACY-BRIDGE" }
          : tool === "record_local_integration_result"
            ? { success: true, entityId: "EVIDENCE-LEGACY-BRIDGE" }
            : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/sandbox-lease-fencing",
      "--worktree", makeTempWorktree(),
      "--expires-minutes", "0.05",
      "--poll-seconds", "0.01",
      "--lease-wait-seconds", "2",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_GATE_RETRY_JITTER: "0",
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    assert.equal(claims.length, 2);
    assert.equal(claims[0].claimKey, claims[1].claimKey);
    assert.match(result.output, /legacy conflict contract/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("transient admission transport reset retries the same durable claim", async () => {
  const claims = [];
  let resetOnce = false;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      if (tool === "claim_nonprod_environment_lease") {
        claims.push(payload.params.arguments);
        if (!resetOnce) {
          resetOnce = true;
          request.socket.destroy();
          return;
        }
      }
      const result = tool === "claim_nonprod_environment_lease"
        ? {
          success: true,
          entityId: "NPEL-RESET-TEST",
          data: {
            lease: { leaseId: "NPEL-RESET-TEST" },
            admission: { status: "admitted", slotKey: "slot-0", waitAgeMs: 50 },
          },
        }
        : tool === "record_local_integration_result"
          ? { success: true, entityId: "EVIDENCE-RESET-TEST" }
          : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/sandbox-lease-fencing",
      "--worktree", makeTempWorktree(),
      "--expires-minutes", "0.05",
      "--poll-seconds", "0.01",
      "--lease-wait-seconds", "2",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_GATE_RETRY_JITTER: "0",
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    assert.equal(claims.length, 2);
    assert.equal(claims[0].claimKey, claims[1].claimKey);
    assert.match(result.output, /admission transport unavailable/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test(
  "signal while queued cancels the durable claim exactly once",
  { skip: process.platform === "win32" ? "Windows child.kill terminates without delivering POSIX signal handlers" : false },
  async () => {
  const calls = [];
  let gateChild;
  let signalled = false;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      calls.push(tool);
      const result = tool === "claim_nonprod_environment_lease"
        ? {
          success: true,
          entityId: "NPEL-SIGNAL-TEST",
          data: {
            lease: { leaseId: "NPEL-SIGNAL-TEST" },
            admission: { status: "queued", queuePosition: 1, waitAgeMs: 25 },
          },
        }
        : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
      if (tool === "claim_nonprod_environment_lease" && !signalled) {
        signalled = true;
        setTimeout(() => gateChild?.kill("SIGTERM"), 25);
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const result = await new Promise((resolve, reject) => {
      gateChild = spawn(process.execPath, [
        "scripts/gate-worktree.mjs",
        "--branch", "fix/sandbox-lease-fencing",
        "--worktree", makeTempWorktree(),
        "--expires-minutes", "0.05",
        "--poll-seconds", "0.05",
        "--lease-wait-seconds", "2",
        "--mcp-url", `http://127.0.0.1:${address.port}`,
        "--no-push",
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DPF_MCP_BEARER_TOKEN: "test-token",
          DPF_ALLOW_LOCAL_CI_STUB: "1",
          DPF_GATE_RETRY_JITTER: "0",
          DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      gateChild.stdout.on("data", (chunk) => { output += chunk; });
      gateChild.stderr.on("data", (chunk) => { output += chunk; });
      gateChild.once("error", reject);
      gateChild.once("close", (code) => resolve({ code, output }));
    });

    assert.equal(result.code, 130, result.output);
    assert.equal(
      calls.filter((tool) => tool === "release_nonprod_environment_lease").length,
      1,
    );
    assert.equal(calls.includes("record_local_integration_result"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  },
);

test("hard host-pressure loss kills the real child process tree before later mutation", async () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-lease-fence-"));
  const lateWrite = join(temp, "must-not-exist.txt");
  const calls = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      calls.push(tool);
      const result = tool === "claim_nonprod_environment_lease"
        ? { success: true, entityId: "NPEL-FENCE-TEST" }
        : tool === "renew_nonprod_environment_lease"
          ? calls.filter((entry) => entry === "renew_nonprod_environment_lease").length === 1
            ? {
              success: true,
              data: {
                lease: {
                  leaseId: "NPEL-FENCE-TEST",
                  expiresAt: new Date(Date.now() + 3_000).toISOString(),
                },
              },
            }
            : {
              success: true,
              data: {
                lease: {
                  leaseId: "NPEL-FENCE-TEST",
                  expiresAt: new Date(Date.now() + 3_000).toISOString(),
                },
                poolPolicy: {
                  effectiveCapacity: 0,
                  rollbackReason: "host-memory-low",
                },
              },
            }
          : tool === "record_local_integration_result"
            ? { success: true, entityId: "EVIDENCE-FENCE-TEST" }
            : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    // Write a real child script instead of eval(base64) so CodeQL does not
    // flag improperly sanitized code construction in this contract test.
    // The child sleeps and would write a file after 2s unless the gate fences
    // and kills the process tree when renewal fails.
    const childScript = join(temp, "slow-child.mjs");
    writeFileSync(
      childScript,
      [
        "import { writeFileSync } from \"node:fs\";",
        `const target = ${JSON.stringify(lateWrite)};`,
        "await new Promise((r) => setTimeout(r, 2000));",
        "writeFileSync(target, \"late\");",
        "",
      ].join("\n"),
    );
    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/sandbox-lease-fencing",
      "--worktree", makeTempWorktree(),
      "--expires-minutes", "0.05",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        // Quote-safe: no shell interpolation of untrusted strings into -e eval.
        DPF_LOCAL_CI_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(childScript)}`,
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /lease fenced/);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(existsSync(lateWrite), false, "fenced descendant mutated after ownership loss");
    assert.equal(calls.filter((tool) => tool === "release_nonprod_environment_lease").length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("process tree tracker remembers descendants before they reparent", async () => {
  const snapshots = [
    [
      { pid: 100, parentPid: 1 },
      { pid: 101, parentPid: 100 },
      { pid: 102, parentPid: 101 },
    ],
    [
      { pid: 102, parentPid: 1 },
    ],
  ];
  const alive = new Set([102]);
  const terminated = [];
  let now = 1000;
  const tracker = createProcessTreeTracker({
    rootPid: 100,
    listProcessRows: () => snapshots.shift() || [],
    processAlive: (pid) => alive.has(pid),
    terminate: (pid) => {
      terminated.push(pid);
      alive.delete(pid);
    },
    wait: async (ms) => { now += ms; },
    now: () => now,
  });

  assert.deepEqual(collectDescendantPids(100, [
    { pid: 100, parentPid: 1 },
    { pid: 101, parentPid: 100 },
    { pid: 102, parentPid: 101 },
    { pid: 200, parentPid: 1 },
  ]), [101, 102]);

  tracker.sample();
  const leaked = await tracker.waitForQuiescence({ graceMs: 0, pollMs: 1 });

  assert.deepEqual(leaked, [102]);
  assert.deepEqual(terminated, [102]);
});

test("local-CI admission detects legacy shared mutators and their descendants only", () => {
  const processRows = [
    {
      pid: 100,
      parentPid: 1,
      commandLine: "node D:/DPF/scripts/local-ci-runner.mjs --candidate feat/previous",
    },
    {
      pid: 101,
      parentPid: 100,
      commandLine: "node D:/DPF/scripts/local-integration-ci.mjs",
    },
    {
      pid: 102,
      parentPid: 101,
      commandLine: "docker build --file Dockerfile .",
    },
    {
      pid: 103,
      parentPid: 1,
      commandLine: "docker build D:/DPF-worktrees/.local-ci-runner",
    },
    {
      pid: 200,
      parentPid: 1,
      commandLine: "docker build --file unrelated.Dockerfile .",
    },
    {
      pid: 300,
      parentPid: 1,
      commandLine: "node D:/DPF/scripts/gate-worktree.mjs --branch feat/queued",
    },
    {
      pid: 400,
      parentPid: 1,
      commandLine: "node D:/DPF/scripts/local-ci-runner.mjs --candidate feat/current",
    },
    {
      pid: 401,
      parentPid: 400,
      commandLine: "docker build --file Dockerfile .",
    },
  ];

  assert.deepEqual(
    findLiveLocalCiMutatorPids(processRows, { excludePids: [400] }),
    [100, 101, 102, 103],
  );
});

test("local-CI admission permits a proven peer slot while blocking a legacy mutator", () => {
  const processRows = [
    { pid: 100, parentPid: 1, commandLine: "node scripts/gate-worktree.mjs" },
    { pid: 101, parentPid: 100, commandLine: "node scripts/local-ci-runner.mjs" },
    { pid: 102, parentPid: 101, commandLine: "docker build D:/DPF-worktrees/.local-ci-runner-slot-1" },
    { pid: 103, parentPid: 1, commandLine: "docker build D:/DPF-worktrees/.local-ci-runner-slot-1" },
    { pid: 200, parentPid: 1, commandLine: "node scripts/local-ci-runner.mjs --candidate legacy" },
  ];

  assert.deepEqual(findConflictingLocalCiMutatorPids(processRows, {
    currentPid: 300,
    peerOwners: [{
      pid: 100,
      workspace: "D:/DPF-worktrees/.local-ci-runner-slot-1",
    }],
  }), [200]);
});

test("process tree tracker uses a slower default scan cadence on Windows", () => {
  assert.equal(defaultProcessScanMs("win32"), 5000);
  assert.equal(defaultDescendantPollMs("win32"), 1000);
  assert.equal(defaultProcessScanMs("linux"), 250);
  assert.equal(defaultDescendantPollMs("linux"), 250);
});

test("POSIX entry point delegates every lease policy to the canonical Node gate", async () => {
  const source = await readFile("scripts/gate-worktree.sh", "utf8");
  assert.match(source, /exec "\$NODE_BIN" "\$SCRIPT_DIR\/gate-worktree\.mjs" "\$@"/);
  assert.doesNotMatch(source, /claim_nonprod_environment_lease/);
});

test("POSIX gate heartbeats and releases through its injectable transport", async (context) => {
  const shell = process.platform === "win32"
    ? "C:\\Program Files\\Git\\bin\\bash.exe"
    : "sh";
  if (process.platform === "win32" && !existsSync(shell)) {
    context.skip("Git-for-Windows Bash is not installed");
    return;
  }

  const calls = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      calls.push(tool);
      const result = tool === "claim_nonprod_environment_lease"
        ? { success: true, entityId: "NPEL-SH-TEST" }
        : tool === "record_local_integration_result"
          ? { success: true, entityId: "EVIDENCE-SH-TEST" }
          : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const temp = mkdtempSync(join(tmpdir(), "dpf-posix-gate-command-"));
    const childScript = join(temp, "delay.mjs");
    writeFileSync(
      childScript,
      "await new Promise((resolve) => setTimeout(resolve, 2500));\n",
    );
    const result = await run(shell, [
      "scripts/gate-worktree.sh",
      "--branch", "fix/sandbox-lease-fencing",
      "--worktree", makeTempWorktree(),
      "--expires-minutes", "0.05",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_LOCAL_CI_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(childScript)}`,
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    assert.ok(calls.includes("renew_nonprod_environment_lease"), `${calls.join(", ")}\n${result.output}`);
    assert.equal(calls.filter((tool) => tool === "release_nonprod_environment_lease").length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a gate launch sweeps observer records leaked by a killed run (BI-2C7F51BA)", async () => {
  // Defect 1: releaseDeadLocalQueueObserversForGate was never called on the
  // success path — only from pregate's interrupted/revival recovery, which is
  // itself skipped when the worktree path cannot be resolved, i.e. on the very
  // failure the cleanup exists for. The field directory reached 192 records,
  // 185 with dead pids, the oldest six days old, throttling every session on
  // the host. Every gate launch must now self-heal the shared directory.
  const observerDirectory = mkdtempSync(join(tmpdir(), "dpf-gate-observer-dir-"));

  // A REAL process, killed — not a fabricated pid, so liveness is genuinely
  // resolved by the platform rather than by a stub.
  const victim = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
  const victimPid = victim.pid;
  await new Promise((resolve) => {
    victim.once("exit", resolve);
    victim.kill("SIGKILL");
  });

  const leakedToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const leakedPath = join(observerDirectory, `${leakedToken}.json`);
  writeFileSync(leakedPath, `${JSON.stringify({
    schema: "dpf-local-ci-queue-observer/v1",
    observerToken: leakedToken,
    pid: victimPid,
    // A DIFFERENT session: the thread that leaked the record is by definition
    // gone, so a sweep filtered to the current branch/session would never
    // reclaim it.
    ownerSessionId: "some-long-dead-session",
    branch: "feat/killed-somewhere-else",
    sha: "9".repeat(40),
    registeredAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`);

  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const tool = payload.params.name;
      const result = tool === "list_nonprod_environment_leases"
        ? { success: true, data: { leases: [], queued: [] } }
        : tool === "claim_nonprod_environment_lease"
          ? {
            success: true,
            entityId: "NPEL-SWEEP-TEST",
            data: {
              lease: { leaseId: "NPEL-SWEEP-TEST" },
              admission: { status: "admitted", slotKey: "slot-0", waitAgeMs: 0 },
            },
          }
          : tool === "record_local_integration_result"
            ? { success: true, entityId: "EVIDENCE-SWEEP-TEST" }
            : { success: true };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    assert.equal(existsSync(leakedPath), true);

    const result = await run(process.execPath, [
      "scripts/gate-worktree.mjs",
      "--branch", "fix/sandbox-lease-fencing",
      "--worktree", makeTempWorktree(),
      "--expires-minutes", "0.05",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_LOCAL_QUEUE_OBSERVER_DIR: observerDirectory,
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    assert.equal(existsSync(leakedPath), false, result.output);
    assert.match(result.output, /swept 1 leaked local-CI queue observer record/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
