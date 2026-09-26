import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { buildJsonRpcBody, mcpCall, mcpPost } from "./mcp-client.mjs";

test("MCP calls abort within the configured transport deadline", async () => {
  const server = createServer((_request, _response) => {
    // Deliberately leave the request open. The client owns the deadline.
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const startedAt = Date.now();

  try {
    await assert.rejects(
      mcpCall("test_tool", {}, {
        mcpUrl: `http://127.0.0.1:${address.port}`,
        bearerToken: "test-token",
        timeoutMs: 50,
      }),
      /timed out after 50ms/,
    );
    assert.ok(Date.now() - startedAt < 1_000);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

// A bearer token is a live `dpfmcp_...` credential. isAllowedMcpEndpoint has
// documented that rule for a while, but only one of the sixteen mcpCall sites
// ever ran it, so for the rest it was a convention rather than an invariant --
// which is what CodeQL's js/file-access-to-http reports on this module. These
// pin the enforcement now that mcpCall owns it.

const REMOTE = "http://evil.example.com/api/mcp/v1";

/** Run with a temporarily patched process.env, restoring it afterwards. */
async function withEnv(patch, run) {
  const saved = new Map(Object.keys(patch).map((key) => [key, process.env[key]]));
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  try {
    await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("refuses to send a bearer token to a non-loopback endpoint", async () => {
  await withEnv({ DPF_MCP_URL: undefined, DPF_MCP_ENDPOINT: undefined }, async () => {
    await assert.rejects(
      mcpCall("test_tool", {}, { mcpUrl: REMOTE, bearerToken: "dpfmcp_test" }),
      /refusing to send a bearer token/,
    );
  });
});

test("refuses a credentials-in-authority endpoint that only looks like loopback", async () => {
  await withEnv({ DPF_MCP_URL: undefined, DPF_MCP_ENDPOINT: undefined }, async () => {
    await assert.rejects(
      mcpCall("test_tool", {}, {
        mcpUrl: "http://127.0.0.1@evil.example.com/api/mcp/v1",
        bearerToken: "dpfmcp_test",
      }),
      /refusing to send a bearer token/,
    );
  });
});

test("honours a non-loopback endpoint the operator set explicitly", async () => {
  // Operator intent, not ambient state. It must fail on transport, not policy.
  await withEnv({ DPF_MCP_URL: REMOTE, DPF_MCP_ENDPOINT: undefined }, async () => {
    await assert.rejects(
      mcpCall("test_tool", {}, { mcpUrl: REMOTE, bearerToken: "dpfmcp_test", timeoutMs: 50 }),
      (error) => !/refusing to send a bearer token/.test(error.message),
    );
  });
});

test("refuses an endpoint that differs from the one the operator set", async () => {
  // The tampered/stale .mcp.json case: something on disk names another host.
  await withEnv({ DPF_MCP_URL: "http://10.0.0.5:3000/api/mcp/v1", DPF_MCP_ENDPOINT: undefined }, async () => {
    await assert.rejects(
      mcpCall("test_tool", {}, { mcpUrl: REMOTE, bearerToken: "dpfmcp_test" }),
      /refusing to send a bearer token/,
    );
  });
});

test("an explicit call-site opt-in still allows a non-loopback endpoint", async () => {
  await withEnv({ DPF_MCP_URL: undefined, DPF_MCP_ENDPOINT: undefined }, async () => {
    await assert.rejects(
      mcpCall("test_tool", {}, {
        mcpUrl: REMOTE,
        bearerToken: "dpfmcp_test",
        timeoutMs: 50,
        allowNonLoopbackEndpoint: true,
      }),
      (error) => !/refusing to send a bearer token/.test(error.message),
    );
  });
});

// Plan 2026-09-08 §10.5 S8: one client for every script. mcpPost is the raw
// layer the fail-open call sites use; mcpCall unwraps on top of it.

test("buildJsonRpcBody writes a JSON-RPC 2.0 envelope with a fresh id", () => {
  const first = JSON.parse(buildJsonRpcBody("tools/call", { name: "t", arguments: {} }));
  const second = JSON.parse(buildJsonRpcBody("tools/list"));
  assert.equal(first.jsonrpc, "2.0");
  assert.equal(first.method, "tools/call");
  assert.deepEqual(first.params, { name: "t", arguments: {} });
  assert.ok(second.id > first.id);
  assert.equal("params" in second, false);
});

test("mcpPost returns the raw reply without interpreting the HTTP status", async () => {
  let seen = null;
  const reply = await mcpPost("tools/call", { name: "list_workrooms", arguments: {} }, {
    mcpUrl: "http://127.0.0.1:3000/api/mcp/v1",
    bearerToken: "dpfmcp_test",
    accept: "application/json, text/event-stream",
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response("unauthorized", { status: 401 });
    },
  });
  assert.equal(reply.status, 401);
  assert.equal(reply.text, "unauthorized");
  assert.equal(seen.init.headers.Authorization, "Bearer dpfmcp_test");
  assert.equal(seen.init.headers.Accept, "application/json, text/event-stream");
  assert.equal(JSON.parse(seen.init.body).params.name, "list_workrooms");
});

test("mcpPost enforces the loopback rule on the fetchImpl path too", async () => {
  await withEnv({ DPF_MCP_URL: undefined, DPF_MCP_ENDPOINT: undefined }, async () => {
    await assert.rejects(
      mcpPost("tools/call", { name: "t", arguments: {} }, {
        mcpUrl: REMOTE,
        bearerToken: "dpfmcp_test",
        fetchImpl: async () => { throw new Error("must not be called"); },
      }),
      /refusing to send a bearer token/,
    );
  });
});

test("mcpCall unwraps the text content of a tool result", async () => {
  const result = await mcpCall("t", {}, {
    mcpUrl: "http://127.0.0.1:3000/api/mcp/v1",
    bearerToken: "dpfmcp_test",
    fetchImpl: async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: JSON.stringify({ success: true, data: 7 }) }] },
    }), { status: 200 }),
  });
  assert.deepEqual(result, { success: true, data: 7 });
});

test("mcpCall keeps its invalid-JSON error text, which retry classifiers match", async () => {
  await assert.rejects(
    mcpCall("t", {}, {
      mcpUrl: "http://127.0.0.1:3000/api/mcp/v1",
      bearerToken: "dpfmcp_test",
      fetchImpl: async () => new Response("<html>", { status: 502 }),
    }),
    /mcpCall: invalid JSON response from http:\/\/127\.0\.0\.1:3000\/api\/mcp\/v1 \(status 502\)/,
  );
});
