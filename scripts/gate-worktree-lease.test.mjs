import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
  });
}

function isolatedFencePath() {
  return join(mkdtempSync(join(tmpdir(), "dpf-gate-fence-")), "owner.json");
}

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
      "--worktree", process.cwd(),
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

test("queue wait does not consume the lease TTL granted at claim time", async () => {
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
      const result = tool === "claim_nonprod_environment_lease" && claims.length === 1
        ? { success: false, error: "lease_conflict" }
        : tool === "claim_nonprod_environment_lease"
          ? { success: true, entityId: "NPEL-QUEUE-TEST" }
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
        DPF_LOCAL_SANDBOX_FENCE_PATH: isolatedFencePath(),
      },
    });

    assert.ok([0, 3].includes(result.code), result.output);
    assert.equal(claims.length, 2);
    const grantedMs = Date.parse(claims[1].args.expiresAt) - claims[1].receivedAt;
    assert.ok(grantedMs >= 2_800, `expected a fresh ~3s TTL, got ${grantedMs}ms`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("renewal loss kills the real child process tree before later mutation", async () => {
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
          ? { success: false, error: "lease_lost" }
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
      "--worktree", process.cwd(),
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

test("POSIX entry point renews, fences the process tree, and traps cleanup", async () => {
  const source = await readFile("scripts/gate-worktree.sh", "utf8");
  assert.match(source, /renew_nonprod_environment_lease/);
  assert.match(source, /terminate_process_tree/);
  assert.match(source, /trap cleanup_gate EXIT/);
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
    const result = await run(shell, [
      "scripts/gate-worktree.sh",
      "--branch", "fix/sandbox-lease-fencing",
      "--worktree", process.cwd(),
      "--expires-minutes", "0.05",
      "--mcp-url", `http://127.0.0.1:${address.port}`,
      "--no-push",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "test-token",
        DPF_LOCAL_CI_COMMAND: "node -e 'setTimeout(() => {}, 2500)'",
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
