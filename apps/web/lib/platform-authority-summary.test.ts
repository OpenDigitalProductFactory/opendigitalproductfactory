import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  delegationGrant: {
    count: vi.fn(),
  },
  agentToolGrant: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));

import {
  buildAuthoritySummaryMetrics,
  getPlatformAuthoritySummary,
} from "./platform-authority-summary";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPlatformAuthoritySummary", () => {
  it("separates temporary delegation grants from standing tool grants", async () => {
    mockPrisma.delegationGrant.count.mockResolvedValue(0);
    mockPrisma.agentToolGrant.count.mockResolvedValue(12);
    mockPrisma.agentToolGrant.findMany.mockResolvedValue([{ agentId: "agent-a" }, { agentId: "agent-b" }]);

    const summary = await getPlatformAuthoritySummary(new Date("2026-05-14T00:00:00Z"));

    expect(summary).toEqual({
      temporaryDelegationGrants: 0,
      standingToolGrants: 12,
      governedAgents: 2,
    });
    expect(mockPrisma.delegationGrant.count).toHaveBeenCalledWith({
      where: {
        status: "active",
        expiresAt: { gt: new Date("2026-05-14T00:00:00Z") },
      },
    });
    expect(mockPrisma.agentToolGrant.findMany).toHaveBeenCalledWith({
      distinct: ["agentId"],
      select: { agentId: true },
    });
  });
});

describe("buildAuthoritySummaryMetrics", () => {
  it("uses accurate labels and live-db provenance", () => {
    const metrics = buildAuthoritySummaryMetrics({
      temporaryDelegationGrants: 0,
      standingToolGrants: 12,
      governedAgents: 2,
    });

    expect(metrics.map((metric) => metric.label)).toEqual([
      "Temporary delegation grants",
      "Standing tool grants",
    ]);
    expect(metrics[0].note).toContain("0 is normal");
    expect(metrics[0].provenance.sourceTable).toBe("DelegationGrant");
    expect(metrics[1].provenance.sourceTable).toBe("AgentToolGrant");
  });
});
