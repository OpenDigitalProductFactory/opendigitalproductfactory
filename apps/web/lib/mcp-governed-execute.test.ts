import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _setGovernanceForTests,
  governedExecuteTool,
} from "./mcp-governed-execute";
import type { ToolResult } from "./mcp-tools";

type AuditRow = Record<string, unknown>;

function captureAudit(rows: AuditRow[]) {
  return async (data: AuditRow) => {
    rows.push(data);
  };
}

const NORMAL_USER = {
  platformRole: "ceo",
  isSuperuser: true,
};

type ExecuteFn = (
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
  ctx?: {
    agentId?: string;
    threadId?: string;
    routeContext?: string;
    taskRunId?: string;
  },
) => Promise<ToolResult>;

let auditRows: AuditRow[];
let executeMock: ReturnType<typeof vi.fn> & ExecuteFn;

beforeEach(() => {
  auditRows = [];
  executeMock = vi.fn(
    async (): Promise<ToolResult> => ({
      success: true,
      message: "ok",
      entityId: "BI-FAKE",
    }),
  ) as ReturnType<typeof vi.fn> & ExecuteFn;
  _setGovernanceForTests({
    resolveAgentGrants: async () => ["backlog_read", "backlog_write"],
    isAllowedByGrants: () => true,
    executeTool: executeMock,
    toolExecutionCreate: captureAudit(auditRows),
  });
});

afterEach(() => {
  _setGovernanceForTests({
    resolveAgentGrants: null,
    isAllowedByGrants: null,
    executeTool: null,
    toolExecutionCreate: null,
  });
});

describe("governedExecuteTool — happy path", () => {
  it("invokes executeTool, audits with the correct executionMode, and returns the result", async () => {
    const result = await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: { status: "open" },
      userId: "user-1",
      userContext: NORMAL_USER,
      context: { agentId: "AGT-100", threadId: "thread-1" },
      source: "rest",
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe("ok");
    expect(executeMock).toHaveBeenCalledOnce();
    expect(executeMock).toHaveBeenCalledWith(
      "query_backlog",
      { status: "open" },
      "user-1",
      expect.objectContaining({ agentId: "AGT-100", threadId: "thread-1" }),
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.toolName).toBe("query_backlog");
    expect(auditRows[0]!.executionMode).toBe("rest");
    expect(auditRows[0]!.success).toBe(true);
    expect(auditRows[0]!.userId).toBe("user-1");
    expect(auditRows[0]!.agentId).toBe("AGT-100");
  });

  it("propagates the source field unchanged for each transport", async () => {
    for (const source of ["rest", "jsonrpc", "external-jsonrpc", "agentic-loop"] as const) {
      auditRows.length = 0;
      await governedExecuteTool({
        toolName: "query_backlog",
        rawParams: {},
        userId: "u",
        userContext: NORMAL_USER,
        source,
      });
      expect(auditRows[0]?.executionMode).toBe(source);
    }
  });

  it("writes apiTokenId from context when set (external-jsonrpc transport)", async () => {
    await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "u",
      userContext: NORMAL_USER,
      context: { apiTokenId: "tok_abc" },
      source: "external-jsonrpc",
    });
    expect(auditRows[0]?.apiTokenId).toBe("tok_abc");
  });

  it("writes apiTokenId=null when context has no token (in-portal transports)", async () => {
    await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "u",
      userContext: NORMAL_USER,
      source: "agentic-loop",
    });
    expect(auditRows[0]?.apiTokenId).toBeNull();
  });
});

describe("governedExecuteTool — rejection paths", () => {
  it("returns unknown_tool without invoking executeTool", async () => {
    const result = await governedExecuteTool({
      toolName: "totally_made_up_tool",
      rawParams: {},
      userId: "u",
      userContext: NORMAL_USER,
      source: "rest",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("unknown_tool");
    expect(executeMock).not.toHaveBeenCalled();
    // unknown_tool is rejected before audit write
    expect(auditRows).toHaveLength(0);
  });

  it("rejects on forbidden_grant and audits the failure (executeTool never runs)", async () => {
    _setGovernanceForTests({
      resolveAgentGrants: async () => ["registry_read"], // no backlog_write
      isAllowedByGrants: () => false,
      executeTool: executeMock,
      toolExecutionCreate: captureAudit(auditRows),
    });
    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "x", type: "product", source: "user-request" },
      userId: "u",
      userContext: NORMAL_USER,
      context: { agentId: "AGT-100" },
      source: "rest",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("forbidden_grant");
    expect(executeMock).not.toHaveBeenCalled();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.success).toBe(false);
    expect(auditRows[0]?.toolName).toBe("create_backlog_item");
  });

  it("rejects on forbidden_capability and audits the failure", async () => {
    const lowPrivilege = { platformRole: "viewer", isSuperuser: false };
    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "x", type: "product", source: "user-request" },
      userId: "u",
      userContext: lowPrivilege,
      source: "rest",
    });
    // viewer doesn't have manage_backlog
    expect(result.success).toBe(false);
    expect(result.error).toBe("forbidden_capability");
    expect(executeMock).not.toHaveBeenCalled();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.success).toBe(false);
  });
});

describe("governedExecuteTool — resilience", () => {
  it("does not throw to the caller when audit write fails", async () => {
    _setGovernanceForTests({
      resolveAgentGrants: async () => ["backlog_read"],
      isAllowedByGrants: () => true,
      executeTool: executeMock,
      toolExecutionCreate: async () => {
        throw new Error("DB exploded");
      },
    });
    const result = await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "u",
      userContext: NORMAL_USER,
      source: "rest",
    });
    // Tool ran successfully even though audit write failed
    expect(result.success).toBe(true);
  });

  it("converts a thrown executeTool into a structured failure result + audit", async () => {
    _setGovernanceForTests({
      resolveAgentGrants: async () => ["backlog_read"],
      isAllowedByGrants: () => true,
      executeTool: async () => {
        throw new Error("kaboom");
      },
      toolExecutionCreate: captureAudit(auditRows),
    });
    const result = await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "u",
      userContext: NORMAL_USER,
      source: "rest",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("tool_threw");
    expect(result.message).toContain("kaboom");
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.success).toBe(false);
  });
});
