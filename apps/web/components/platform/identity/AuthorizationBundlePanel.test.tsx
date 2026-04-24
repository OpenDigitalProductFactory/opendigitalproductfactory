import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AuthorizationBundlePanel } from "./AuthorizationBundlePanel";

describe("AuthorizationBundlePanel", () => {
  it("renders role bundles, assignments, teams, and coworker authority coverage", () => {
    const html = renderToStaticMarkup(
      <AuthorizationBundlePanel
        roleBundles={[
          {
            roleId: "HR-200",
            name: "Business Operations",
            description: "Finance and customer operations.",
            hitlTierMin: 2,
            capabilityCount: 8,
            capabilities: ["view_customer", "view_finance", "manage_finance"],
            routes: [
              { label: "Customer", href: "/customer" },
              { label: "Finance", href: "/finance" },
              { label: "Platform Hub", href: "/platform" },
            ],
          },
        ]}
        roleAssignments={[
          {
            roleId: "HR-200",
            roleName: "Business Operations",
            assignedCount: 2,
            people: [
              { displayName: "Ava Green", secondaryLabel: "ava@dpf.local" },
              { displayName: "Sam Cho", secondaryLabel: "sam@dpf.local" },
            ],
          },
        ]}
        teamSummaries={[
          {
            teamId: "TEAM-FIN",
            name: "Finance",
            memberCount: 3,
            leads: ["Ava Green"],
            coworkerCount: 1,
          },
        ]}
        coworkerCoverage={[
          {
            agentId: "AGT-FIN-001",
            name: "Finance Specialist",
            lifecycleStage: "production",
            supervisorRef: "HR-200",
            ownershipTeams: ["Finance"],
            capabilityClassName: "Payables",
            directivePolicyClassName: "Approval Required",
          },
        ]}
      />,
    );

    expect(html).toContain("Authorization");
    expect(html).toContain("Role bundles");
    expect(html).toContain("Current human assignments");
    expect(html).toContain("Team memberships");
    expect(html).toContain("AI coworker authority coverage");
    expect(html).toContain("HR-200");
    expect(html).toContain("/finance");
    expect(html).toContain("Ava Green");
    expect(html).toContain("Finance Specialist");
    expect(html).toContain("Approval Required");
  });
});
