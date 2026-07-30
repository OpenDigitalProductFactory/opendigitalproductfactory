import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { mcpCall } from "./mcp-client.mjs";

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
