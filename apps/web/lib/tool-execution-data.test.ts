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
import { getToolExecutions } from "./tool-execution-data";

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
});
