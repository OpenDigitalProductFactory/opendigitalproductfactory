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
