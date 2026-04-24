import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    agent: {
      findMany: vi.fn(),
    },
    modelProvider: {
      findMany: vi.fn(),
    },
    agentModelConfig: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: any }) => <a href={href}>{children}</a>,
}));

vi.mock("@/components/ea/AgentGovernanceCard", () => ({
  AgentGovernanceCard: ({ agent }: { agent: { name: string; agentId: string } }) => (
    <div>
      <span>{agent.name}</span>
      <span>{agent.agentId}</span>
    </div>
  ),
}));

vi.mock("@/components/platform/AgentProviderSelect", () => ({
  AgentProviderSelect: () => <div>provider-select</div>,
}));

vi.mock("@/lib/agent-grants", () => ({
  getAgentGrantSummaries: vi.fn(),
}));

vi.mock("@/lib/identity/principal-linking", () => ({
  getAgentGaidMap: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { getAgentGrantSummaries } from "@/lib/agent-grants";
import { getAgentGaidMap } from "@/lib/identity/principal-linking";

describe("PlatformAiPage", () => {
  it("shows GAID identity references for AI workforce cards", async () => {
    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      {
        id: "agent-db-1",
        agentId: "hr-specialist",
        slugId: "hr-specialist",
        name: "HR Specialist",
        tier: 2,
        description: "HR help",
        valueStream: "operate",
        sensitivity: "restricted",
        lifecycleStage: "production",
        portfolio: null,
        ownerships: [],
        governanceProfile: null,
        delegationGrants: [],
        _count: {
          skills: 1,
          toolGrants: 2,
          performanceProfiles: 0,
          degradationMappings: 0,
        },
      },
    ] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.agentModelConfig.findMany).mockResolvedValue([] as never);
    vi.mocked(getAgentGrantSummaries).mockResolvedValue([]);
    vi.mocked(getAgentGaidMap).mockResolvedValue(
      new Map([["hr-specialist", "gaid:priv:dpf.internal:hr-specialist"]]),
    );

    const { default: PlatformAiPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformAiPage());

    expect(html).toContain("HR Specialist");
    expect(html).toContain("gaid:priv:dpf.internal:hr-specialist");
  });
});
