// Tests for the hand-rolled MCP JSON-RPC ratchet (plan 2026-09-08 §10.5 S8).
// Run: node --test scripts/check-no-hand-rolled-mcp-jsonrpc.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWLIST,
  findEnvelopeLines,
  findStaleAllowlist,
  scanRepo,
} from "./check-no-hand-rolled-mcp-jsonrpc.mjs";

test("flags each way of writing a JSON-RPC 2.0 envelope", () => {
  assert.equal(findEnvelopeLines('body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call" })').length, 1);
  assert.equal(findEnvelopeLines("    jsonrpc: '2.0',").length, 1);
  assert.equal(findEnvelopeLines('{"jsonrpc":"2.0","id":1,"method":"tools/list"}').length, 1);
  assert.equal(findEnvelopeLines('  "jsonrpc" : "2.0",').length, 1);
});

test("ignores comments and unrelated text", () => {
  assert.equal(findEnvelopeLines('// jsonrpc: "2.0"').length, 0);
  assert.equal(findEnvelopeLines(' * { jsonrpc: "2.0", id }').length, 0);
  assert.equal(findEnvelopeLines("  // 401 with { jsonrpc, id: null, error }").length, 0);
  assert.equal(findEnvelopeLines('await mcpPost("tools/call", { name, arguments: args })').length, 0);
});

test("every allowlist entry carries a reason", () => {
  for (const [file, reason] of ALLOWLIST) {
    assert.ok(typeof reason === "string" && reason.length >= 40, `${file} needs a reason`);
  }
});

test("repo: no hand-rolled envelope outside the client and the allowlist; allowlist not stale", () => {
  assert.deepEqual(scanRepo(), []);
  assert.deepEqual(findStaleAllowlist(), []);
});
