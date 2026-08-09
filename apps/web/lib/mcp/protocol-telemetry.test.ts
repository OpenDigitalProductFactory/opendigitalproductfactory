import { describe, expect, it } from "vitest";
import { buildMcpTelemetryRecord } from "./protocol-telemetry";

describe("MCP protocol telemetry projection", () => {
  it("records bounded 2026 compatibility/resource labels without payload or identity", () => {
    const record = buildMcpTelemetryRecord({
      headers: new Headers({
        "MCP-Protocol-Version": "2026-07-28",
        "User-Agent": "codex-cli/1.4.2 (windows)",
        Authorization: "Bearer must-never-appear",
      }),
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "secret_tool_name",
          arguments: { prompt: "private prompt", gaid: "gaid_private" },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "codex", version: "1.4.2" },
            "io.modelcontextprotocol/clientCapabilities": {
              extensions: { "io.modelcontextprotocol/tasks": {} },
            },
          },
        },
      },
      responseBody: { jsonrpc: "2.0", id: 1, result: { resultType: "task", taskId: "TR-SECRET" } },
      httpStatus: 200,
      latencyMs: 37,
      activeRequestCount: 2,
      suspendedTaskCount: 7,
      processRssBytes: 1234n,
    });
    expect(record).toMatchObject({
      protocolVersion: "2026-07-28",
      protocolEra: "modern",
      clientKind: "codex",
      clientVersion: "1.4.2",
      method: "tools/call",
      methodFamily: "tools",
      tasksExtensionUsed: true,
      resultClass: "task",
      activeRequestCount: 2,
      suspendedTaskCount: 7,
      processRssBytes: 1234n,
    });
    const serialized = JSON.stringify(record, (_key, value) => typeof value === "bigint" ? value.toString() : value);
    for (const secret of ["must-never-appear", "secret_tool_name", "private prompt", "gaid_private", "TR-SECRET"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("classifies a legacy initialize client and a compatibility failure", () => {
    const record = buildMcpTelemetryRecord({
      headers: new Headers({ "User-Agent": "claude-code/2.1" }),
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      },
      responseBody: { error: { code: -32601, message: "unsupported" } },
      httpStatus: 404,
      latencyMs: 4,
      activeRequestCount: 1,
      suspendedTaskCount: null,
      processRssBytes: null,
    });
    expect(record).toMatchObject({
      protocolVersion: "2025-11-25",
      protocolEra: "legacy",
      clientKind: "claude-code",
      clientVersion: "2.1",
      methodFamily: "lifecycle",
      resultClass: "protocol_error",
      compatibilityFailure: "-32601",
    });
  });
});
