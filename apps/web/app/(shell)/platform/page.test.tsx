import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GovernanceOverviewPanel } from "@/components/platform/GovernanceOverviewPanel";

describe("GovernanceOverviewPanel", () => {
  it("renders governance counts and recent delegation grants", () => {
    const html = renderToStaticMarkup(
      <GovernanceOverviewPanel
        summary={{ teams: 2, governedAgents: 5, activeGrants: 1, pendingApprovals: 0 }}
        recentGrants={[
          {
            grantId: "DGR-001",
            agentName: "Ops Agent",
            grantorLabel: "manager@example.com",
            status: "active",
          },
        ]}
      />,
    );

    expect(html).toContain("Governed agents");
    expect(html).toContain("DGR-001");
    expect(html).toContain("Ops Agent");
  });
});
