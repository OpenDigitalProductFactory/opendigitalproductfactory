import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/mcp-api-token", () => ({
  resolveMcpApiToken: vi.fn(),
}));

vi.mock("@/lib/mcp/session-token", () => ({
  verifyMcpSessionToken: vi.fn(),
}));

vi.mock("@/lib/mcp-governed-execute", () => ({
  governedExecuteTool: vi.fn(),
}));

const { getQuiescenceConfigMock } = vi.hoisted(() => ({
  getQuiescenceConfigMock: vi.fn(),
}));
const { enqueueRemoteTaskExecutionMock } = vi.hoisted(() => ({
  enqueueRemoteTaskExecutionMock: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceConfig: getQuiescenceConfigMock,
}));

vi.mock("@/lib/queue/mcp-task-dispatch", () => ({
  enqueueRemoteTaskExecution: enqueueRemoteTaskExecutionMock,
}));

vi.mock("@/lib/tak/autonomous-work-run", () => ({
  createAutonomousWorkRun: vi.fn(),
  executeAutonomousAgenticLoop: vi.fn(),
  resolveAutonomousWorkAgent: vi.fn(),
  resolveAutonomousWorkTools: vi.fn(),
}));

vi.mock("@/lib/tak/task-records", () => ({
  createTaskMessage: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    taskRun: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    agentThread: { upsert: vi.fn() },
    taskMessage: { create: vi.fn() },
    mcpToolSession: { findUnique: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
    mcpProtocolTelemetry: { create: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { resolveMcpApiToken } from "@/lib/auth/mcp-api-token";
import { verifyMcpSessionToken } from "@/lib/mcp/session-token";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import {
  createAutonomousWorkRun,
  executeAutonomousAgenticLoop,
  resolveAutonomousWorkAgent,
  resolveAutonomousWorkTools,
} from "@/lib/tak/autonomous-work-run";
import { createTaskMessage } from "@/lib/tak/task-records";
import { POST } from "./route";

const resolveMock = resolveMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const verifySessionMock = verifyMcpSessionToken as unknown as ReturnType<typeof vi.fn>;
const govMock = governedExecuteTool as unknown as ReturnType<typeof vi.fn>;
const userMock = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const taskRunFindFirstMock = prisma.taskRun.findFirst as unknown as ReturnType<typeof vi.fn>;
const taskRunFindUniqueMock = prisma.taskRun.findUnique as unknown as ReturnType<typeof vi.fn>;
const taskRunUpdateMock = prisma.taskRun.update as unknown as ReturnType<typeof vi.fn>;
const taskRunCountMock = prisma.taskRun.count as unknown as ReturnType<typeof vi.fn>;
const telemetryCreateMock = prisma.mcpProtocolTelemetry.create as unknown as ReturnType<typeof vi.fn>;
const agentThreadUpsertMock = prisma.agentThread.upsert as unknown as ReturnType<typeof vi.fn>;
const createRunMock = createAutonomousWorkRun as unknown as ReturnType<typeof vi.fn>;
const executeLoopMock = executeAutonomousAgenticLoop as unknown as ReturnType<typeof vi.fn>;
const resolveAgentMock = resolveAutonomousWorkAgent as unknown as ReturnType<typeof vi.fn>;
const resolveToolsMock = resolveAutonomousWorkTools as unknown as ReturnType<typeof vi.fn>;
const createTaskMessageMock = createTaskMessage as unknown as ReturnType<typeof vi.fn>;

function makeRequest(opts: {
  url?: string;
  method?: string;
  bearer?: string | null;
  sessionJwt?: string | null;
  origin?: string | null;
  body?: unknown;
  forwardedProto?: string;
  forwardedHost?: string;
  hostHeader?: string;
  userAgent?: string;
  headers?: Record<string, string>;
}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Default the caller to Claude Code so tools/list returns the FULL granted
  // surface (BI-88681BE0: tools/list defaults non-Claude-Code clients to the
  // lean core tier). Tests asserting a specific tool is exposed assume the full
  // surface; the client-aware default is covered explicitly below and in
  // tool-tier.test.ts. Pass userAgent to exercise a different client.
  headers["User-Agent"] = opts.userAgent ?? "claude-code/2.1 (test)";
  if (opts.bearer !== null && opts.bearer !== undefined) {
    headers["Authorization"] = `Bearer ${opts.bearer}`;
  }
  if (opts.sessionJwt !== null && opts.sessionJwt !== undefined) {
    headers["X-MCP-Session"] = opts.sessionJwt;
  }
  if (opts.origin !== null && opts.origin !== undefined) {
    headers["Origin"] = opts.origin;
  }
  if (opts.forwardedProto) headers["X-Forwarded-Proto"] = opts.forwardedProto;
  if (opts.forwardedHost) headers["X-Forwarded-Host"] = opts.forwardedHost;
  if (opts.hostHeader) headers["Host"] = opts.hostHeader;
  Object.assign(headers, opts.headers);
  return new Request(opts.url ?? "http://localhost:3000/api/mcp/v1", {
    method: opts.method ?? "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  getQuiescenceConfigMock.mockResolvedValue({ level: "normal", runId: null, enteredAt: null });
  userMock.mockResolvedValue({
    isSuperuser: true,
    groups: [{ platformRole: { roleId: "HR-000" } }],
  } as never);
  taskRunFindFirstMock.mockResolvedValue(null);
  taskRunFindUniqueMock.mockResolvedValue(null);
  taskRunUpdateMock.mockResolvedValue({} as never);
  taskRunCountMock.mockResolvedValue(0 as never);
  telemetryCreateMock.mockResolvedValue({} as never);
  agentThreadUpsertMock.mockResolvedValue({ id: "thread-remote-1" } as never);
  createRunMock.mockResolvedValue({ id: "task-row-1", taskRunId: "TR-MCP-12345678", contextId: "thread-remote-1" } as never);
  resolveAgentMock.mockResolvedValue({
    agentId: "AGT-REMOTE",
    systemPrompt: "You are a governed autonomous coworker.",
    sensitivity: "internal",
    displayName: "Remote Coworker",
  } as never);
  resolveToolsMock.mockResolvedValue({ tools: [], toolsForProvider: [] } as never);
  executeLoopMock.mockResolvedValue({ content: "Done.", executedTools: [] } as never);
  createTaskMessageMock.mockResolvedValue(undefined as never);
  enqueueRemoteTaskExecutionMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetAllMocks();
});


describe("POST — MCP 2026-07-28 stateless core", () => {
  const modernMeta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "codex", version: "1.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const modernTasksMeta = {
    ...modernMeta,
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
  };

  beforeEach(() => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_modern",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
    });
  });

  it("discovers the modern server without initialize", async () => {
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        headers: {
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "server/discover",
        },
        body: {
          jsonrpc: "2.0",
          id: "discover-1",
          method: "server/discover",
          params: { _meta: modernMeta },
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toMatchObject({
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: {
        tools: expect.any(Object),
        extensions: { "io.modelcontextprotocol/tasks": {} },
      },
      ttlMs: 0,
      cacheScope: "private",
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: "dpf-platform",
          version: "1.0.0",
        },
      },
    });
    expect(body.result.serverInfo).toBeUndefined();
  });

  it("rejects official task methods when the current request omitted the Tasks extension", async () => {
    const res = await POST(makeRequest({
      bearer: "dpfmcp_X",
      headers: {
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tasks/get",
        "Mcp-Name": "TR-1",
      },
      body: {
        jsonrpc: "2.0",
        id: "task-no-capability",
        method: "tasks/get",
        params: { taskId: "TR-1", _meta: modernMeta },
      },
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: {
        code: -32003,
        data: {
          requiredCapabilities: {
            extensions: { "io.modelcontextprotocol/tasks": {} },
          },
        },
      },
    });
    expect(taskRunFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns an official task handle for a task-augmented governed tool", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_modern",
      userId: "u1",
      agentId: "AGT-CALLER",
      scopes: ["thread_write"],
      capability: "write",
      scope: "write",
    });
    govMock.mockResolvedValue({
      success: true,
      message: "Started child thread.",
      data: { taskRunId: "TR-1", child: { id: "thread-child" } },
    });
    const taskRow = {
      id: "row-1",
      taskRunId: "TR-1",
      userId: "u1",
      contextId: "thread-child",
      initiatingAgentId: "AGT-CALLER",
      currentAgentId: "AGT-WORKER",
      mcpOwnerTokenId: null,
      title: "Child task",
      objective: "Do the work",
      status: "working",
      a2aMetadata: null,
      progressPayload: null,
      cancellationRequestedAt: null,
      cancellationRequestedByUserId: null,
      createdAt: new Date("2026-08-08T12:00:00.000Z"),
      updatedAt: new Date("2026-08-08T12:00:01.000Z"),
      completedAt: null,
    };
    taskRunFindUniqueMock.mockResolvedValue(taskRow as never);
    taskRunUpdateMock.mockResolvedValue({ ...taskRow, mcpOwnerTokenId: "tok_modern" } as never);

    const res = await POST(makeRequest({
      bearer: "dpfmcp_X",
      headers: {
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "spawn_work_thread",
      },
      body: {
        jsonrpc: "2.0",
        id: "task-create",
        method: "tools/call",
        params: {
          name: "spawn_work_thread",
          arguments: { objective: "Do the work" },
          _meta: modernTasksMeta,
        },
      },
    }));
    const body = await res.json();
    expect(body.result).toMatchObject({
      resultType: "task",
      taskId: "TR-1",
      status: "working",
      ttlMs: null,
      pollIntervalMs: 2_000,
    });
    expect(taskRunUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: { mcpOwnerTokenId: "tok_modern" },
    }));
  });

  it("acknowledges cooperative task cancellation without returning a terminal claim", async () => {
    const taskRow = {
      id: "row-1",
      taskRunId: "TR-1",
      userId: "u1",
      contextId: null,
      initiatingAgentId: null,
      currentAgentId: null,
      mcpOwnerTokenId: "tok_modern",
      title: "Long task",
      objective: "Work",
      status: "working",
      a2aMetadata: null,
      progressPayload: null,
      cancellationRequestedAt: null,
      cancellationRequestedByUserId: null,
      createdAt: new Date("2026-08-08T12:00:00.000Z"),
      updatedAt: new Date("2026-08-08T12:00:01.000Z"),
      completedAt: null,
    };
    taskRunFindUniqueMock.mockResolvedValue(taskRow as never);
    taskRunUpdateMock.mockResolvedValue(taskRow as never);
    const res = await POST(makeRequest({
      bearer: "dpfmcp_X",
      headers: {
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tasks/cancel",
        "Mcp-Name": "TR-1",
      },
      body: {
        jsonrpc: "2.0",
        id: "task-cancel",
        method: "tasks/cancel",
        params: { taskId: "TR-1", _meta: modernTasksMeta },
      },
    }));
    const body = await res.json();
    expect(body.result).toMatchObject({ resultType: "complete" });
    expect(taskRunUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cancellationRequestedAt: expect.any(Date) }),
    }));
  });

  it("lists authorized tools on a self-contained request and stamps cache/server metadata", async () => {
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        headers: {
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "tools/list",
        },
        body: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: { _meta: modernMeta },
        },
      }),
    );
    const body = await res.json();
    expect(body.result.resultType).toBe("complete");
    expect(body.result.ttlMs).toBe(0);
    expect(body.result.cacheScope).toBe("private");
    expect(body.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("dpf-platform");
    expect(body.result.tools.some((tool: { name: string }) => tool.name === "query_backlog")).toBe(true);
  });

  it("returns HeaderMismatch before dispatch when required mirrored headers are absent", async () => {
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/list",
          params: { _meta: modernMeta },
        },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32020);
    expect(govMock).not.toHaveBeenCalled();
  });

  it("returns UnsupportedProtocolVersion for a self-consistent unknown modern version", async () => {
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        headers: {
          "MCP-Protocol-Version": "2099-01-01",
          "Mcp-Method": "ping",
        },
        body: {
          jsonrpc: "2.0",
          id: 4,
          method: "ping",
          params: {
            _meta: {
              ...modernMeta,
              "io.modelcontextprotocol/protocolVersion": "2099-01-01",
            },
          },
        },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatchObject({
      code: -32022,
      data: { requested: "2099-01-01", supported: ["2026-07-28"] },
    });
  });

  it("rejects a mismatched Mcp-Name before invoking a governed tool", async () => {
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        headers: {
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "tools/call",
          "Mcp-Name": "get_backlog_item",
        },
        body: {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "query_backlog",
            arguments: {},
            _meta: modernMeta,
          },
        },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32020);
    expect(govMock).not.toHaveBeenCalled();
  });

  it("enforces schema-declared Mcp-Param headers before governed execution", async () => {
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        headers: {
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "tools/call",
          "Mcp-Name": "get_backlog_item",
        },
        body: {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: "get_backlog_item",
            arguments: { itemId: "BI-214CB18D" },
            _meta: modernMeta,
          },
        },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32020);
    expect(govMock).not.toHaveBeenCalled();
  });

  it("executes a fully mirrored tool call and stamps modern result metadata", async () => {
    govMock.mockResolvedValue({ success: true, message: "ok", data: { itemId: "BI-214CB18D" } });
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        headers: {
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "tools/call",
          "Mcp-Name": "get_backlog_item",
          "Mcp-Param-Item-Id": "BI-214CB18D",
        },
        body: {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "get_backlog_item",
            arguments: { itemId: "BI-214CB18D" },
            _meta: modernMeta,
          },
        },
      }),
    );
    const body = await res.json();
    expect(body.result.resultType).toBe("complete");
    expect(body.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("dpf-platform");
    expect(govMock).toHaveBeenCalledOnce();
  });

  it("reauthenticates every stateless request", async () => {
    const first = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        headers: { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "ping" },
        body: { jsonrpc: "2.0", id: 8, method: "ping", params: { _meta: modernMeta } },
      }),
    );
    expect(first.status).toBe(200);

    resolveMock.mockResolvedValueOnce(null);
    const revoked = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        headers: { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "ping" },
        body: { jsonrpc: "2.0", id: 9, method: "ping", params: { _meta: modernMeta } },
      }),
    );
    expect(revoked.status).toBe(401);
    expect(resolveMock).toHaveBeenCalledTimes(2);
  });

  it("records a payload-free compatibility observation for each request", async () => {
    taskRunCountMock.mockResolvedValue(7 as never);
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_SECRET",
        userAgent: "codex/9.4.1",
        headers: { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "ping" },
        body: {
          jsonrpc: "2.0",
          id: 10,
          method: "ping",
          params: {
            prompt: "confidential acquisition plan",
            gaid: "gaid_internal_worker",
            _meta: modernMeta,
          },
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(telemetryCreateMock).toHaveBeenCalledOnce();
    const call = telemetryCreateMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({
      protocolVersion: "2026-07-28",
      protocolEra: "modern",
      clientKind: "codex",
      clientVersion: "1.0.0",
      authSource: "bearer",
      method: "ping",
      resultClass: "success",
      suspendedTaskCount: 7,
    });
    const serialized = JSON.stringify(call.data, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(serialized).not.toContain("dpfmcp_SECRET");
    expect(serialized).not.toContain("confidential acquisition plan");
    expect(serialized).not.toContain("gaid_internal_worker");
  });
});


describe("POST — tasks/submit", () => {
  it("returns invalid_params when idempotencyKey or riskClass is missing", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: "AGT-REMOTE",
      scopes: ["backlog_read"],
      capability: "read",
    });

    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 11,
          method: "tasks/submit",
          params: {
            agentId: "AGT-REMOTE",
            routeContext: "/platform/tools/discovery",
            objective: "Investigate discovery backlog.",
            prompt: "Summarize discovery backlog.",
          },
        },
      }),
    );

    const body = await res.json();
    expect(body.error.code).toBe(-32602);
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it("rejects write-risk submissions from read-only tokens before creating a TaskRun", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_read",
      userId: "u1",
      agentId: "AGT-REMOTE",
      scopes: ["backlog_read"],
      capability: "read",
    });

    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 12,
          method: "tasks/submit",
          params: {
            agentId: "AGT-REMOTE",
            routeContext: "/platform/tools/discovery",
            objective: "Prepare a backlog update.",
            prompt: "Create a backlog item if needed.",
            idempotencyKey: "remote-read-denied-1",
            riskClass: "bounded-write",
          },
        },
      }),
    );

    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/read-only/i);
    expect(body.result.structuredContent).toMatchObject({
      error: "insufficient_token_scope",
      requiredScope: "write",
      tokenScope: "read",
    });
    expect(createRunMock).not.toHaveBeenCalled();
    expect(executeLoopMock).not.toHaveBeenCalled();
  });

  it("replays an existing TaskRun for the same idempotencyKey without re-running the coworker", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_write",
      userId: "u1",
      agentId: "AGT-REMOTE",
      scopes: ["backlog_read", "backlog_write"],
      capability: "write",
    });
    taskRunFindFirstMock.mockResolvedValue({
      taskRunId: "TR-MCP-OLD",
      status: "completed",
      progressPayload: { summary: "Already done." },
      a2aMetadata: { idempotencyKey: "remote-replay-1", riskClass: "read" },
    } as never);

    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 13,
          method: "tasks/submit",
          params: {
            agentId: "AGT-REMOTE",
            routeContext: "/platform/tools/discovery",
            objective: "Summarize current state.",
            prompt: "Summarize current state.",
            idempotencyKey: "remote-replay-1",
            riskClass: "read",
          },
        },
      }),
    );

    const body = await res.json();
    expect(body.result.taskRunId).toBe("TR-MCP-OLD");
    expect(body.result.idempotentReplay).toBe(true);
    expect(createRunMock).not.toHaveBeenCalled();
    expect(executeLoopMock).not.toHaveBeenCalled();
  });

  it("creates an external-mcp TaskRun and returns before asynchronous execution", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_read",
      userId: "u1",
      agentId: "AGT-REMOTE",
      scopes: ["backlog_read"],
      capability: "read",
    });

    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 14,
          method: "tasks/submit",
          params: {
            agentId: "AGT-REMOTE",
            routeContext: "/platform/tools/discovery",
            title: "Remote discovery summary",
            objective: "Summarize discovery backlog.",
            prompt: "Summarize discovery backlog and cite what you used.",
            idempotencyKey: "remote-read-1",
            riskClass: "read",
            authorityScope: ["backlog_read", "build_promote"],
          },
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(createRunMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: "external-mcp",
      userId: "u1",
      agentId: "AGT-REMOTE",
      routeContext: "/platform/tools/discovery",
      sourceRef: { kind: "mcp-token", id: "tok_read" },
      authorityScope: ["backlog_read"],
      metadata: expect.objectContaining({
        idempotencyKey: "remote-read-1",
        riskClass: "read",
        apiTokenId: "tok_read",
      }),
    }));
    expect(resolveToolsMock).not.toHaveBeenCalled();
    expect(executeLoopMock).not.toHaveBeenCalled();
    expect(enqueueRemoteTaskExecutionMock).toHaveBeenCalledWith("TR-MCP-12345678");
    expect(taskRunUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskRunId: "TR-MCP-12345678" },
      data: expect.objectContaining({ mcpOwnerTokenId: "tok_read" }),
    }));
    const body = await res.json();
    expect(body.error).toBeUndefined();
    expect(body.result.taskRunId).toBe("TR-MCP-12345678");
    expect(body.result.status).toBe("working");
    expect(body.result.idempotentReplay).toBe(false);
    expect(body.result.requiresApproval).toBe(false);
  });

  it("pauses high-risk submissions before executing tools", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_write",
      userId: "u1",
      agentId: "AGT-REMOTE",
      scopes: ["backlog_read", "backlog_write"],
      capability: "write",
    });

    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 15,
          method: "tasks/submit",
          params: {
            agentId: "AGT-REMOTE",
            routeContext: "/platform/tools/discovery",
            objective: "Make broad production changes.",
            prompt: "Make broad production changes.",
            idempotencyKey: "remote-high-risk-1",
            riskClass: "high-risk",
          },
        },
      }),
    );

    const body = await res.json();
    expect(body.result.taskRunId).toBe("TR-MCP-12345678");
    expect(body.result.requiresApproval).toBe(true);
    expect(body.result.status).toBe("input-required");
    expect(taskRunUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskRunId: "TR-MCP-12345678" },
      data: expect.objectContaining({ status: "input-required" }),
    }));
    expect(executeLoopMock).not.toHaveBeenCalled();
  });
});
