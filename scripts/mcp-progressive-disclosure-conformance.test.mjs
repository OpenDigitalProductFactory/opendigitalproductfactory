import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_PROFILES,
  parseMcpMessages,
  sameToolNames,
} from "./mcp-progressive-disclosure-conformance.mjs";

test("client matrix covers supported and notification-blind MCP profiles", () => {
  assert.deepEqual(
    CLIENT_PROFILES.map((profile) => profile.name),
    ["Codex Desktop", "Codex CLI", "Claude Code", "Generic MCP"],
  );
  assert.equal(CLIENT_PROFILES.find((profile) => profile.name === "Claude Code").expectedDefault, "full");
  assert.equal(CLIENT_PROFILES.find((profile) => profile.name === "Codex CLI").expectedDefault, "core");
});

test("parses JSON and list_changed SSE response shapes without exposing headers", () => {
  const json = parseMcpMessages("application/json", '{"jsonrpc":"2.0","id":1,"result":{}}');
  assert.equal(json[0].id, 1);

  const sse = parseMcpMessages(
    "text/event-stream",
    'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n'
      + 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n',
  );
  assert.equal(sse[0].method, "notifications/tools/list_changed");
  assert.equal(sse[1].result.ok, true);
});

test("compares disclosure tiers by exact tool names, not count alone", () => {
  assert.equal(sameToolNames(new Set(["a", "b"]), new Set(["b", "a"])), true);
  assert.equal(sameToolNames(new Set(["a", "b"]), new Set(["a", "c"])), false);
});
