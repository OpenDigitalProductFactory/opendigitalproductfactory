import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    agent: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: any }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/identity/principal-linking", () => ({
  getAgentGaidMap: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { getAgentGaidMap } from "@/lib/identity/principal-linking";

describe("AgentDetailPage", () => {
  it("shows the GAID identity reference for the selected coworker", async () => {
    vi.mocked(prisma.agent.findFirst).mockResolvedValue({
      id: "agent-db-1",
      agentId: "hr-specialist",
      slugId: "hr-specialist",
      name: "HR Specialist",
      tier: 2,
      type: "specialist",
      description: "HR help",
      status: "active",
      valueStream: "operate",
      sensitivity: "restricted",
      humanSupervisorId: "HR-100",
      escalatesTo: null,
      delegatesTo: [],
      lifecycleStage: "production",
      hitlTierDefault: 2,
      portfolio: null,
      executionConfig: null,
      skills: [],
      toolGrants: [],
      performanceProfiles: [],
      degradationMappings: [],
      promptContext: null,
      governanceProfile: null,
    } as never);
    vi.mocked(getAgentGaidMap).mockResolvedValue(
      new Map([["hr-specialist", "gaid:priv:dpf.internal:hr-specialist"]]),
    );

    const { default: AgentDetailPage } = await import("./page");
    const html = renderToStaticMarkup(
      await AgentDetailPage({ params: Promise.resolve({ agentId: "hr-specialist" }) }),
    );

    expect(html).toContain("GAID:");
    expect(html).toContain("gaid:priv:dpf.internal:hr-specialist");
  });
});
