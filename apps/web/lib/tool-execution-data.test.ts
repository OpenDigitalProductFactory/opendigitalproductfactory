import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  };
});

vi.mock("@dpf/db", () => ({
  prisma: {
    toolExecution: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
    principalAlias: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { getJournalToolExecutions, getToolExecutions } from "./tool-execution-data";

describe("getToolExecutions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates GAID-backed identity references for agent executions", async () => {
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([
      {
        id: "exec-1",
        threadId: "thread-1",
        agentId: "hr-specialist",
        userId: "user-1",
        toolName: "create_backlog_item",
        parameters: {},
        result: {},
        success: true,
        executionMode: "immediate",
        routeContext: "/employee",
        durationMs: 125,
        createdAt: new Date("2026-04-23T00:00:00Z"),
        auditClass: "ledger",
        capabilityId: "backlog:write",
        summary: null,
      },
    ] as never);
    vi.mocked(prisma.principalAlias.findMany)
      .mockResolvedValueOnce([
        {
          id: "alias-agent-1",
          principalId: "principal-1",
          aliasType: "agent",
          aliasValue: "hr-specialist",
          issuer: "",
          createdAt: new Date("2026-04-23T00:00:00Z"),
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: "alias-gaid-1",
          principalId: "principal-1",
          aliasType: "gaid",
          aliasValue: "gaid:priv:dpf.internal:hr-specialist",
          issuer: "",
          createdAt: new Date("2026-04-23T00:00:00Z"),
        },
      ] as never);

    const rows = await getToolExecutions(20);

    expect(rows[0]?.agentIdentityRef).toBe("gaid:priv:dpf.internal:hr-specialist");
  });

  it("includes a focused receipt execution even when it is outside the default journal filter", async () => {
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([]);
    vi.mocked(prisma.toolExecution.findUnique).mockResolvedValue({
      id: "exec-focused",
      threadId: "thread-2",
      agentId: "build-specialist",
      userId: "user-1",
      toolName: "run_sandbox_tests",
      parameters: { buildId: "BUILD-1" },
      result: { success: true },
      success: true,
      executionMode: "immediate",
      routeContext: "/build",
      durationMs: 1200,
      createdAt: new Date("2026-05-20T16:00:00Z"),
      auditClass: "metrics_only",
      capabilityId: "build:verify",
      summary: null,
    } as never);
    vi.mocked(prisma.principalAlias.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const rows = await getJournalToolExecutions(500, "exec-focused");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("exec-focused");
    expect(prisma.toolExecution.findUnique).toHaveBeenCalledWith({
      where: { id: "exec-focused" },
      select: expect.any(Object),
    });
  });
});
