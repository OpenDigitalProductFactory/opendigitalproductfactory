import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(name) {
  return JSON.parse(readFileSync(join(packageRoot, name), "utf8"));
}

test("lazy-host descriptors request the full programmatic catalog", () => {
  const codex = readJson("codex.mcp.json");
  const claude = readJson("claude.mcp.json");

  assert.match(codex.mcp_servers.dpf.url, /[?&]tier=full(?:&|$)/u);
  assert.match(claude.mcpServers.dpf.url, /[?&]tier=full(?:&|\})/u);
});

test("generic Grok descriptor preserves the lean core endpoint", () => {
  const grok = readJson("grok.mcp.json");
  assert.doesNotMatch(grok.mcp_servers.dpf.url, /[?&]tier=full(?:&|$)/u);
});

// BI-5201141C (design 12.4.4): the plugin descriptor is the one dpf connector a
// client loads. Claude Code de-duplicates plugin and configured servers by
// endpoint, so the default must be the install's canonical https origin and the
// entry must carry no bearer header (a pinned header disables OAuth).
test("Claude and Antigravity descriptors are URL-only on the canonical https origin", () => {
  const claude = readJson("claude.mcp.json").mcpServers.dpf;
  const antigravity = readJson("antigravity.mcp.json").mcpServers.dpf;

  assert.equal(claude.url, "${DPF_MCP_URL:-https://localhost/api/mcp/v1?tier=full}");
  assert.equal(claude.headers, undefined);
  assert.deepEqual(claude.oauth, { scopes: "dpf.read dpf.work dpf.build" });

  assert.equal(antigravity.url, "${DPF_MCP_URL:-https://localhost/api/mcp/v1}");
  assert.equal(antigravity.headers, undefined);
});

test("Grok keeps its compatibility bearer until it has a credential without a paste", () => {
  const grok = readJson("grok.mcp.json").mcp_servers.dpf;
  assert.equal(grok.bearer_token_env_var, "DPF_MCP_BEARER_TOKEN");
});
