// scripts/hooks/mcp-health.test.mjs
//
// BI-8A562681 (S4, design 12.4.5): the SessionStart MCP health hook resolves the
// endpoint the client actually uses -- DPF_MCP_URL, then the default written in
// the shipped plugin descriptor -- and no longer warns when the repo .mcp.json
// is absent. The session-reaper's https MCP calls pass the install CA bundle.
//
// Hermetic: every run gets a temporary project root, HOME and a fake `curl` on
// PATH that records its argv and answers nothing, so no network is touched.
// POSIX-only (the .sh twins); skipped where `sh` is unavailable.
//
// Run: node --test scripts/hooks/mcp-health.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// An argv element compared by equality: curl receives the endpoint as one argument.
const CANONICAL_MCP_URL = "https://dpf.example.lan/api/mcp/v1";

const here = dirname(fileURLToPath(import.meta.url));
const healthHook = join(here, "mcp-health.sh");
const reaperHook = join(here, "session-reaper.sh");
const posix = process.platform !== "win32";
const hasJq = posix && spawnSync("sh", ["-c", "command -v jq"], { stdio: "ignore" }).status === 0;

const PLUGIN_DEFAULT = "https://plugin-default.example.test/api/mcp/v1?tier=full";

function makeSandbox({ pluginUrl = `\${DPF_MCP_URL:-${PLUGIN_DEFAULT}}`, repoMcpJson } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-mcp-health-"));
  const root = join(dir, "root");
  const bin = join(dir, "bin");
  const home = join(dir, "home");
  mkdirSync(join(root, "packages", "dpf-skill-pack"), { recursive: true });
  mkdirSync(bin);
  mkdirSync(home);
  if (pluginUrl !== null) {
    writeFileSync(
      join(root, "packages", "dpf-skill-pack", "claude.mcp.json"),
      JSON.stringify({ mcpServers: { dpf: { type: "http", url: pluginUrl } } }, null, 2),
    );
  }
  if (repoMcpJson) writeFileSync(join(root, ".mcp.json"), JSON.stringify(repoMcpJson, null, 2));
  const curlLog = join(dir, "curl.log");
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${curlLog}"; done\nprintf '%s\\n' '--END--' >> "${curlLog}"\nexit 7\n`,
  );
  chmodSync(join(bin, "curl"), 0o755);
  const caBundle = join(dir, "org-root.pem");
  writeFileSync(caBundle, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");
  return {
    dir,
    root,
    caBundle,
    env(extra = {}) {
      const env = {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: home,
        CLAUDE_PROJECT_DIR: root,
      };
      for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
      return env;
    },
    curlCalls() {
      if (!existsSync(curlLog)) return [];
      return readFileSync(curlLog, "utf8")
        .split("--END--\n")
        .filter((chunk) => chunk.length > 0)
        .map((chunk) => chunk.split("\n").filter((line) => line.length > 0));
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function runHealth(sandbox, env) {
  const result = spawnSync("sh", [healthHook], { env: sandbox.env(env), encoding: "utf8", input: "" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("mcp-health probes DPF_MCP_URL first", { skip: !posix }, () => {
  const sb = makeSandbox();
  try {
    const url = "https://dpf.example.lan/api/mcp/v1?tier=full";
    const out = runHealth(sb, { DPF_MCP_URL: url });
    assert.ok(sb.curlCalls().some((argv) => argv.includes(url)), JSON.stringify(sb.curlCalls()));
    assert.match(out, /dpf\.example\.lan/);
  } finally {
    sb.cleanup();
  }
});

test("mcp-health falls back to the plugin descriptor's default", { skip: !posix }, () => {
  const sb = makeSandbox();
  try {
    runHealth(sb, {});
    assert.ok(sb.curlCalls().some((argv) => argv.includes(PLUGIN_DEFAULT)), JSON.stringify(sb.curlCalls()));
  } finally {
    sb.cleanup();
  }
});

test("mcp-health uses the local bind when neither DPF_MCP_URL nor a descriptor exists", { skip: !posix }, () => {
  const sb = makeSandbox({ pluginUrl: null });
  try {
    runHealth(sb, { DPF_MCP_BEARER_TOKEN: "dpfmcp_test" });
    assert.ok(
      sb.curlCalls().some((argv) => argv.includes("http://127.0.0.1:3000/api/mcp/v1")),
      JSON.stringify(sb.curlCalls()),
    );
  } finally {
    sb.cleanup();
  }
});

test("mcp-health does not warn about a repo .mcp.json that is absent", { skip: !posix }, () => {
  const sb = makeSandbox({ pluginUrl: "${DPF_MCP_URL:-http://127.0.0.1:3000/api/mcp/v1?tier=full}" });
  try {
    const out = runHealth(sb, { DPF_MCP_BEARER_TOKEN: "dpfmcp_test" });
    assert.doesNotMatch(out, /\.mcp\.json/);
  } finally {
    sb.cleanup();
  }
});

test("mcp-health still diagnoses a repo .mcp.json that is present", { skip: !posix }, () => {
  const sb = makeSandbox({
    repoMcpJson: { mcpServers: { dpf: { type: "http", url: "http://127.0.0.1:3000/api/mcp/v1" } } },
  });
  try {
    const out = runHealth(sb, { DPF_MCP_URL: "http://127.0.0.1:3000/api/mcp/v1" });
    assert.match(out, /WARNING: DPF MCP -- \.mcp\.json configures dpf on plain-http/);
  } finally {
    sb.cleanup();
  }
});

test("mcp-health passes the install CA bundle on https", { skip: !posix }, () => {
  const sb = makeSandbox();
  try {
    runHealth(sb, { DPF_MCP_URL: CANONICAL_MCP_URL, NODE_EXTRA_CA_CERTS: sb.caBundle });
    const call = sb.curlCalls().find((argv) => argv.some((arg) => arg === CANONICAL_MCP_URL));
    assert.ok(call, JSON.stringify(sb.curlCalls()));
    assert.equal(call[call.indexOf("--cacert") + 1], sb.caBundle);
  } finally {
    sb.cleanup();
  }
});

function runReaper(sb, env) {
  const payload = JSON.stringify({ session_id: "sess-test", cwd: sb.root, hook_event_name: "SessionEnd" });
  const result = spawnSync("sh", [reaperHook], { env: sb.env(env), encoding: "utf8", input: payload });
  assert.equal(result.status, 0, result.stderr);
}

test("session-reaper passes --cacert on its https MCP calls", { skip: !hasJq }, () => {
  const sb = makeSandbox();
  try {
    runReaper(sb, {
      DPF_MCP_URL: CANONICAL_MCP_URL,
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
      NODE_EXTRA_CA_CERTS: sb.caBundle,
    });
    const calls = sb.curlCalls();
    assert.ok(calls.length > 0, "reaper made no MCP call");
    for (const argv of calls) {
      assert.equal(argv[argv.indexOf("--cacert") + 1], sb.caBundle, JSON.stringify(argv));
      assert.ok(argv.some((arg) => arg === CANONICAL_MCP_URL), JSON.stringify(argv));
    }
  } finally {
    sb.cleanup();
  }
});

test("session-reaper adds no --cacert on a plain-http loopback endpoint", { skip: !hasJq }, () => {
  const sb = makeSandbox();
  try {
    runReaper(sb, {
      DPF_MCP_URL: "http://127.0.0.1:3000/api/mcp/v1",
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
      NODE_EXTRA_CA_CERTS: sb.caBundle,
    });
    const calls = sb.curlCalls();
    assert.ok(calls.length > 0, "reaper made no MCP call");
    for (const argv of calls) assert.ok(!argv.includes("--cacert"), JSON.stringify(argv));
  } finally {
    sb.cleanup();
  }
});
