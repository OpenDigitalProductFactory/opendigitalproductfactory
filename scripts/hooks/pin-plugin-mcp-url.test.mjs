import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  EXIT_LEFT_ALONE,
  EXIT_NOTHING,
  EXIT_PINNED,
  pinPluginMcpUrl,
  resolvePinTarget,
} from "./lib/pin-plugin-mcp-url.mjs";

const TEMPLATE = "${DPF_CLAUDE_MCP_URL:-https://localhost/api/mcp/v1?tier=full}";
const LEGACY_TEMPLATE = "${DPF_MCP_URL:-https://localhost/api/mcp/v1?tier=full}";

function sandbox(server) {
  const home = mkdtempSync(join(tmpdir(), "dpf-pin-url-"));
  const root = join(home, "repo");
  const installPath = join(home, "cache", "dpf-platform", "0.2.8");
  mkdirSync(root, { recursive: true });
  mkdirSync(installPath, { recursive: true });
  const descriptorPath = join(installPath, "claude.mcp.json");
  writeFileSync(descriptorPath, JSON.stringify({ mcpServers: { dpf: server } }, null, 2));
  const installedPath = join(home, "installed_plugins.json");
  writeFileSync(installedPath, JSON.stringify({
    plugins: { "dpf-platform@dpf-platform-local": [{ scope: "project", projectPath: root, version: "0.2.8", installPath }] },
  }));
  return {
    root,
    installedPath,
    descriptor: () => JSON.parse(readFileSync(descriptorPath, "utf8")).mcpServers.dpf,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

const oauthServer = (url) => ({ type: "http", url, oauth: { scopes: "dpf.read dpf.work dpf.build" } });

test("the templated URL is pinned to DPF_CLAUDE_MCP_URL, keeping the OAuth scope pin", () => {
  const sb = sandbox(oauthServer(TEMPLATE));
  try {
    const env = { DPF_CLAUDE_MCP_URL: "https://dpf.example.lan/api/mcp/v1?tier=full" };
    const result = pinPluginMcpUrl({ installedPath: sb.installedPath, root: sb.root, env });
    assert.equal(result.code, EXIT_PINNED);
    assert.equal(sb.descriptor().url, "https://dpf.example.lan/api/mcp/v1?tier=full");
    assert.deepEqual(sb.descriptor().oauth, { scopes: "dpf.read dpf.work dpf.build" });
    assert.equal(pinPluginMcpUrl({ installedPath: sb.installedPath, root: sb.root, env }).code, EXIT_NOTHING);
  } finally {
    sb.cleanup();
  }
});

test("without DPF_CLAUDE_MCP_URL the template's own https default is pinned", () => {
  const sb = sandbox(oauthServer(TEMPLATE));
  try {
    assert.equal(pinPluginMcpUrl({ installedPath: sb.installedPath, root: sb.root, env: {} }).code, EXIT_PINNED);
    assert.equal(sb.descriptor().url, "https://localhost/api/mcp/v1?tier=full");
  } finally {
    sb.cleanup();
  }
});

test("a pinned literal follows a changed machine endpoint", () => {
  const sb = sandbox(oauthServer("https://localhost/api/mcp/v1?tier=full"));
  try {
    const env = { DPF_CLAUDE_MCP_URL: "https://dpf.example.lan/api/mcp/v1?tier=full" };
    assert.equal(pinPluginMcpUrl({ installedPath: sb.installedPath, root: sb.root, env }).code, EXIT_PINNED);
    assert.equal(sb.descriptor().url, env.DPF_CLAUDE_MCP_URL);
  } finally {
    sb.cleanup();
  }
});

test("a bearer descriptor is left alone", () => {
  const sb = sandbox({ type: "http", url: TEMPLATE, headers: { Authorization: "Bearer ${DPF_MCP_BEARER_TOKEN:-}" } });
  try {
    const result = pinPluginMcpUrl({ installedPath: sb.installedPath, root: sb.root, env: { DPF_CLAUDE_MCP_URL: "https://localhost/api/mcp/v1?tier=full" } });
    assert.equal(result.code, EXIT_LEFT_ALONE);
    assert.equal(sb.descriptor().url, TEMPLATE);
  } finally {
    sb.cleanup();
  }
});

test("an http or credential-bearing endpoint is never pinned", () => {
  assert.equal(resolvePinTarget("${DPF_MCP_URL:-http://127.0.0.1:3000/api/mcp/v1}", {}), null);
  assert.equal(resolvePinTarget(TEMPLATE, { DPF_CLAUDE_MCP_URL: "https://user:pw@localhost/api/mcp/v1" }), "https://localhost/api/mcp/v1?tier=full");
  assert.equal(resolvePinTarget("https://localhost/api/mcp/v1", { DPF_CLAUDE_MCP_URL: "http://localhost/api/mcp/v1" }), null);
});

test("no install record for this project means nothing to do", () => {
  const sb = sandbox(oauthServer(TEMPLATE));
  try {
    const result = pinPluginMcpUrl({ installedPath: sb.installedPath, root: join(sb.root, "elsewhere"), env: {} });
    assert.equal(result.code, EXIT_NOTHING);
    assert.equal(sb.descriptor().url, TEMPLATE);
  } finally {
    sb.cleanup();
  }
});

test("the SessionStart reconcile hook pins the URL even with no claude CLI on PATH", { skip: process.platform === "win32" }, async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { dirname: dirOf } = await import("node:path");
  const repoRoot = join(dirOf(fileURLToPath(import.meta.url)), "..", "..");
  const home = mkdtempSync(join(tmpdir(), "dpf-pin-hook-"));
  try {
    const installPath = join(home, ".claude", "plugins", "cache", "dpf-platform-local", "dpf-platform", "0.2.8");
    mkdirSync(installPath, { recursive: true });
    const descriptorPath = join(installPath, "claude.mcp.json");
    writeFileSync(descriptorPath, JSON.stringify({ mcpServers: { dpf: oauthServer(TEMPLATE) } }));
    writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
      plugins: { "dpf-platform@dpf-platform-local": [{ scope: "project", projectPath: repoRoot, version: "0.2.8", installPath }] },
    }));
    const nodeDir = dirOf(process.execPath);
    const result = spawnSync("sh", [join(repoRoot, "scripts", "hooks", "reconcile-claude-plugin.sh")], {
      encoding: "utf8",
      env: { HOME: home, PATH: `${nodeDir}:/usr/bin:/bin`, CLAUDE_PROJECT_DIR: repoRoot, DPF_CLAUDE_MCP_URL: "https://dpf.example.lan/api/mcp/v1?tier=full" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /pinned the dpf-platform plugin connector/);
    assert.equal(JSON.parse(readFileSync(descriptorPath, "utf8")).mcpServers.dpf.url, "https://dpf.example.lan/api/mcp/v1?tier=full");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// BI-8FD7C0C9: the desktop app inherited DPF_MCP_URL=http://[::1]:3000/... from
// launchd. Neither an inherited plain-http value nor an IPv6 literal (Docker
// publishes the portal on IPv4 only) may become the pinned connector.
test("an inherited plain-http or IPv6-literal DPF_MCP_URL pins the template's https default", () => {
  for (const DPF_MCP_URL of ["http://[::1]:3000/api/mcp/v1?tier=full", "https://[::1]/api/mcp/v1?tier=full"]) {
    const sb = sandbox(oauthServer(TEMPLATE));
    try {
      const result = pinPluginMcpUrl({ installedPath: sb.installedPath, root: sb.root, env: { DPF_MCP_URL } });
      assert.equal(result.code, EXIT_PINNED, DPF_MCP_URL);
      assert.equal(sb.descriptor().url, "https://localhost/api/mcp/v1?tier=full");
    } finally {
      sb.cleanup();
    }
  }
});

test("an OAuth descriptor already holding a plain-http literal is repinned to https", () => {
  // OAuth over http cannot authenticate by any path (BI-46B636B0), so a
  // literal http OAuth descriptor is never a choice worth keeping.
  const sb = sandbox(oauthServer("http://[::1]:3000/api/mcp/v1?tier=full"));
  try {
    const env = { DPF_MCP_URL: "http://[::1]:3000/api/mcp/v1?tier=full" };
    assert.equal(pinPluginMcpUrl({ installedPath: sb.installedPath, root: sb.root, env }).code, EXIT_PINNED);
    assert.equal(sb.descriptor().url, "https://localhost/api/mcp/v1?tier=full");
    assert.deepEqual(sb.descriptor().oauth, { scopes: "dpf.read dpf.work dpf.build" });
  } finally {
    sb.cleanup();
  }
});

// BI-D6A6462A: Claude's connector has its own variable. The shared DPF_MCP_URL
// is written by every client, gate and stale checkout (a test in pre-#6301
// worktrees set it to http://[::1]:3000), so it never steers Claude's pin.
test("the pin follows DPF_CLAUDE_MCP_URL and ignores the shared DPF_MCP_URL", () => {
  const sb = sandbox(oauthServer(TEMPLATE));
  try {
    const env = { DPF_MCP_URL: "https://codex-only.example.lan/api/mcp/v1", DPF_CLAUDE_MCP_URL: "https://desk.lan/api/mcp/v1?tier=full" };
    assert.equal(pinPluginMcpUrl({ installedPath: sb.installedPath, root: sb.root, env }).code, EXIT_PINNED);
    assert.equal(sb.descriptor().url, "https://desk.lan/api/mcp/v1?tier=full");
  } finally {
    sb.cleanup();
  }
  const only = sandbox(oauthServer(TEMPLATE));
  try {
    pinPluginMcpUrl({ installedPath: only.installedPath, root: only.root, env: { DPF_MCP_URL: "https://codex-only.example.lan/api/mcp/v1" } });
    assert.equal(only.descriptor().url, "https://localhost/api/mcp/v1?tier=full");
  } finally {
    only.cleanup();
  }
});

test("a copy still on the legacy ${DPF_MCP_URL:-...} template is pinned from its own default", () => {
  const sb = sandbox(oauthServer(LEGACY_TEMPLATE));
  try {
    pinPluginMcpUrl({ installedPath: sb.installedPath, root: sb.root, env: { DPF_MCP_URL: "http://[::1]:3000/api/mcp/v1?tier=full" } });
    assert.equal(sb.descriptor().url, "https://localhost/api/mcp/v1?tier=full");
  } finally {
    sb.cleanup();
  }
});
