import { describe, expect, it } from "vitest";

import {
  MCP_PROTOCOL_VERSION_2026,
  cacheableCompleteResult,
  isModernMcpRequest,
  readModernRequestMetadata,
  withModernServerMetadata,
  validateToolParameterHeaders,
  validateModernHttpHeaders,
} from "./protocol-2026";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION_2026,
  "io.modelcontextprotocol/clientInfo": { name: "codex", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {
    extensions: { "io.modelcontextprotocol/tasks": {} },
  },
};

function body(
  method: string,
  params: Record<string, unknown> = {},
) {
  return {
    jsonrpc: "2.0" as const,
    id: 1,
    method,
    params: { ...params, _meta: metadata },
  };
}

describe("MCP 2026-07-28 request metadata", () => {
  it("recognizes the modern era from either mirrored version location", () => {
    expect(isModernMcpRequest(new Headers(), body("ping"))).toBe(true);
    expect(
      isModernMcpRequest(
        new Headers({ "MCP-Protocol-Version": MCP_PROTOCOL_VERSION_2026 }),
        { method: "ping" },
      ),
    ).toBe(true);
  });

  it("parses required client identity and extension capabilities per request", () => {
    expect(readModernRequestMetadata(body("ping").params)).toEqual({
      protocolVersion: MCP_PROTOCOL_VERSION_2026,
      clientInfo: { name: "codex", version: "1.0.0" },
      clientCapabilities: {
        extensions: { "io.modelcontextprotocol/tasks": {} },
      },
    });
  });

  it("rejects incomplete per-request metadata", () => {
    expect(
      readModernRequestMetadata({
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION_2026,
        },
      }),
    ).toBeNull();
  });

  it("accepts an omitted clientInfo while retaining per-request capabilities", () => {
    expect(
      readModernRequestMetadata({
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION_2026,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      }),
    ).toEqual({
      protocolVersion: MCP_PROTOCOL_VERSION_2026,
      clientInfo: undefined,
      clientCapabilities: {},
    });
  });
});

describe("MCP 2026-07-28 Streamable HTTP mirrored headers", () => {
  it("accepts matching protocol, method, and tool name headers", () => {
    const result = validateModernHttpHeaders(
      new Headers({
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION_2026,
        "Mcp-Method": "tools/call",
        "Mcp-Name": "query_backlog",
      }),
      body("tools/call", { name: "query_backlog", arguments: {} }),
    );
    expect(result).toEqual({ ok: true });
  });

  it.each([
    ["MCP-Protocol-Version", { "Mcp-Method": "ping" }],
    ["Mcp-Method", { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION_2026 }],
  ])("rejects a missing %s header", (_name, headerValues) => {
    const result = validateModernHttpHeaders(new Headers(headerValues), body("ping"));
    expect(result).toMatchObject({ ok: false, code: -32020 });
  });

  it("rejects header/body version and method disagreement", () => {
    const version = validateModernHttpHeaders(
      new Headers({
        "MCP-Protocol-Version": "2025-11-25",
        "Mcp-Method": "ping",
      }),
      body("ping"),
    );
    expect(version).toMatchObject({ ok: false, code: -32020 });

    const method = validateModernHttpHeaders(
      new Headers({
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION_2026,
        "Mcp-Method": "tools/list",
      }),
      body("ping"),
    );
    expect(method).toMatchObject({ ok: false, code: -32020 });
  });

  it("requires and decodes Mcp-Name for named requests", () => {
    const missing = validateModernHttpHeaders(
      new Headers({
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION_2026,
        "Mcp-Method": "tools/call",
      }),
      body("tools/call", { name: "Hello, 世界", arguments: {} }),
    );
    expect(missing).toMatchObject({ ok: false, code: -32020 });

    const encoded = validateModernHttpHeaders(
      new Headers({
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION_2026,
        "Mcp-Method": "tools/call",
        "Mcp-Name": "=?base64?SGVsbG8sIOS4lueVjA==?=",
      }),
      body("tools/call", { name: "Hello, 世界", arguments: {} }),
    );
    expect(encoded).toEqual({ ok: true });
  });

  it("requires taskId as Mcp-Name for official task lifecycle methods", () => {
    const result = validateModernHttpHeaders(
      new Headers({
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION_2026,
        "Mcp-Method": "tasks/get",
        "Mcp-Name": "TR-WRONG",
      }),
      body("tasks/get", { taskId: "TR-123" }),
    );
    expect(result).toMatchObject({ ok: false, code: -32020 });
  });
});

describe("MCP 2026 cacheable complete results", () => {
  it("adds the required complete discriminator and private cache hints", () => {
    expect(cacheableCompleteResult({ tools: [] }, 30_000, "private")).toEqual({
      resultType: "complete",
      tools: [],
      ttlMs: 30_000,
      cacheScope: "private",
    });
  });

  it("stamps server identity in result _meta without overwriting handler metadata", () => {
    expect(
      withModernServerMetadata(
        { resultType: "complete", _meta: { correlationId: "req-1" } },
        { name: "dpf-platform", version: "1.0.0" },
      ),
    ).toEqual({
      resultType: "complete",
      _meta: {
        correlationId: "req-1",
        "io.modelcontextprotocol/serverInfo": {
          name: "dpf-platform",
          version: "1.0.0",
        },
      },
    });
  });
});

describe("MCP 2026 schema-declared tool parameter headers", () => {
  const inputSchema = {
    type: "object",
    properties: {
      region: { type: "string", "x-mcp-header": "Region" },
      retry: { type: "integer", "x-mcp-header": "Retry" },
      dryRun: { type: "boolean", "x-mcp-header": "Dry-Run" },
      nested: {
        type: "object",
        properties: {
          greeting: { type: "string", "x-mcp-header": "Greeting" },
        },
      },
    },
  };

  it("validates primitive values at their exact schema property path", () => {
    const result = validateToolParameterHeaders(
      new Headers({
        "Mcp-Param-Region": "us-west1",
        "Mcp-Param-Retry": "42",
        "Mcp-Param-Dry-Run": "true",
        "Mcp-Param-Greeting": "=?base64?SGVsbG8sIOS4lueVjA==?=",
      }),
      inputSchema,
      {
        region: "us-west1",
        retry: 42,
        dryRun: true,
        nested: { greeting: "Hello, 世界" },
      },
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects a missing or disagreeing declared parameter header", () => {
    const missing = validateToolParameterHeaders(
      new Headers(),
      inputSchema,
      { region: "us-west1" },
    );
    expect(missing).toMatchObject({ ok: false, code: -32020 });

    const disagreeing = validateToolParameterHeaders(
      new Headers({ "Mcp-Param-Retry": "41" }),
      inputSchema,
      { retry: 42 },
    );
    expect(disagreeing).toMatchObject({ ok: false, code: -32020 });
  });

  it("does not expect a header for null or absent values", () => {
    expect(
      validateToolParameterHeaders(new Headers(), inputSchema, { region: null }),
    ).toEqual({ ok: true });
    expect(validateToolParameterHeaders(new Headers(), inputSchema, {})).toEqual({ ok: true });
  });
});
