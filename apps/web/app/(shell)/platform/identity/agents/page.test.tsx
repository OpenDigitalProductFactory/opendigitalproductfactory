import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    agent: {
      findMany: vi.fn(),
    },
    principalAlias: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("PlatformIdentityAgentsPage", () => {
  it("shows agent identity coverage across the AI workforce", async () => {
    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      {
        id: "agent-db-1",
        agentId: "AGT-100",
        name: "Finance Specialist",
        status: "active",
        lifecycleStage: "production",
        humanSupervisorId: "HR-100",
      },
      {
        id: "agent-db-2",
        agentId: "AGT-200",
        name: "HR Assistant",
        status: "active",
        lifecycleStage: "production",
        humanSupervisorId: "HR-300",
      },
    ] as never);
    vi.mocked(prisma.principalAlias.findMany).mockResolvedValue([
      {
        id: "alias-agent-1",
        principalId: "principal-2",
        aliasType: "agent",
        aliasValue: "AGT-100",
        issuer: "",
        createdAt: new Date("2026-04-23T00:00:00Z"),
      },
      {
        id: "alias-gaid-1",
        principalId: "principal-2",
        aliasType: "gaid",
        aliasValue: "gaid:priv:dpf.internal:agt-100",
        issuer: "",
        createdAt: new Date("2026-04-23T00:00:00Z"),
      },
    ] as never);

    const { default: PlatformIdentityAgentsPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformIdentityAgentsPage());

    expect(html).toContain("Agent Identity");
    expect(html).toContain("Finance Specialist");
    expect(html).toContain("HR Assistant");
    expect(html).toContain("principal linked");
    expect(html).toContain("needs linking");
    expect(html).toContain("gaid:priv:dpf.internal:agt-100");
  });
});
