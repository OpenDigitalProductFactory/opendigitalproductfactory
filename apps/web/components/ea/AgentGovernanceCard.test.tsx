import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentGovernanceCard } from "@/components/ea/AgentGovernanceCard";

describe("AgentGovernanceCard", () => {
  it("renders governance metadata for an agent", () => {
    const html = renderToStaticMarkup(
      <AgentGovernanceCard
        agent={{
          id: "agent-1",
          agentId: "AGT-OPS-001",
          name: "Ops Agent",
          description: "Coordinates platform operations.",
          tier: 1,
          portfolioName: "Operations",
          portfolioSlug: "ops",
          capabilityClassName: "Operations Specialist",
          autonomyLevel: "supervised_execute",
          owningTeamName: "Operations Team",
          activeGrantCount: 2,
        }}
      />,
    );

    expect(html).toContain("AGT-OPS-001");
    expect(html).toContain("Operations Specialist");
    expect(html).toContain("2 active grants");
  });
});
