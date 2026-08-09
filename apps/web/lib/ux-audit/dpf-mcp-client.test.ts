import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callDpfMcpTool,
  expandEnvPlaceholders,
  getDpfMcpTask,
  resolveDpfMcpConfig,
} from "./dpf-mcp-client";

const MCP_JSON = JSON.stringify({
  mcpServers: {
    dpf: {
      url: "http://127.0.0.1:3000/api/mcp/v1",
      headers: { Authorization: "Bearer ${DPF_MCP_BEARER_TOKEN}" },
    },
  },
});

async function writeConfig(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dpf-mcp-"));
  const path = join(dir, ".mcp.json");
  await writeFile(path, contents, "utf8");
  return path;
}

describe("expandEnvPlaceholders", () => {
  it("substitutes known variables and leaves unknown ones intact", () => {
    expect(expandEnvPlaceholders("Bearer ${TOK}", { TOK: "abc" })).toBe("Bearer abc");
    expect(expandEnvPlaceholders("Bearer ${TOK}", {})).toBe("Bearer ${TOK}");
  });
});

describe("resolveDpfMcpConfig", () => {
  it("expands the committed placeholder from the environment", async () => {
    const path = await writeConfig(MCP_JSON);
    await expect(resolveDpfMcpConfig(path, { DPF_MCP_BEARER_TOKEN: "tok-123" })).resolves.toEqual({
      url: "http://127.0.0.1:3000/api/mcp/v1",
      authorization: "Bearer tok-123",
    });
  });

  it("returns null rather than sending an unexpanded placeholder", async () => {
    const path = await writeConfig(MCP_JSON);
    await expect(resolveDpfMcpConfig(path, {})).resolves.toBeNull();
  });

  it("accepts a bare token and adds the Bearer prefix", async () => {
    const path = await writeConfig(MCP_JSON);
    const config = await resolveDpfMcpConfig(path, { DPF_MCP_TOKEN: "raw-token" });
    expect(config?.authorization).toBe("Bearer raw-token");
  });

  it("lets an explicit env URL override the file", async () => {
    const path = await writeConfig(MCP_JSON);
    const config = await resolveDpfMcpConfig(path, {
      DPF_MCP_URL: "http://elsewhere/api/mcp/v1",
      DPF_MCP_BEARER_TOKEN: "tok",
    });
    expect(config?.url).toBe("http://elsewhere/api/mcp/v1");
  });

  it("resolves from env alone when no config file exists", async () => {
    await expect(
      resolveDpfMcpConfig("/definitely/missing/.mcp.json", {
        DPF_MCP_URL: "http://127.0.0.1:3000/api/mcp/v1",
        DPF_MCP_BEARER_TOKEN: "tok",
      }),
    ).resolves.toEqual({
      url: "http://127.0.0.1:3000/api/mcp/v1",
      authorization: "Bearer tok",
    });
  });

  it("returns null when the file is malformed and env is empty", async () => {
    const path = await writeConfig("{ not json");
    await expect(resolveDpfMcpConfig(path, {})).resolves.toBeNull();
  });
});

describe("callDpfMcpTool", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses a self-contained 2026 request and releases on a durable task handle", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: "call-1",
      result: {
        resultType: "task",
        taskId: "TR-1",
        status: "working",
        pollIntervalMs: 2_000,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callDpfMcpTool(
      { url: "http://localhost/api/mcp/v1", authorization: "Bearer secret" },
      "spawn_work_thread",
      { objective: "Run independently" },
      { id: "call-1" },
    );

    expect(result).toMatchObject({
      isError: false,
      task: { taskId: "TR-1", status: "working", pollIntervalMs: 2_000 },
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": "spawn_work_thread",
    });
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      method: "tools/call",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "dpf-ux-audit", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: { "io.modelcontextprotocol/tasks": {} },
          },
        },
      },
    });
  });

  it("reauthenticates an official tasks/get poll as another stateless request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: "task-TR-1",
      result: {
        resultType: "complete",
        taskId: "TR-1",
        status: "working",
        pollIntervalMs: 4_000,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getDpfMcpTask(
      { url: "http://localhost/api/mcp/v1", authorization: "Bearer fresh" },
      "TR-1",
    )).resolves.toMatchObject({ taskId: "TR-1", status: "working", pollIntervalMs: 4_000 });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({
      Authorization: "Bearer fresh",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tasks/get",
      "Mcp-Name": "TR-1",
    });
  });
});
