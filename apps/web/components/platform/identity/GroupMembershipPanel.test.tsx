import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { GroupMembershipPanel } from "./GroupMembershipPanel";

describe("GroupMembershipPanel", () => {
  it("renders role groups and business groups with memberships", () => {
    const html = renderToStaticMarkup(
      <GroupMembershipPanel
        roleGroups={[
          {
            roleId: "HR-200",
            name: "Business Operations",
            description: "Finance and customer operations",
            hitlTierMin: 2,
            memberCount: 2,
            members: [
              { displayName: "Ava Green", secondaryLabel: "ava@dpf.local" },
              { displayName: "Sam Cho", secondaryLabel: "sam@dpf.local" },
            ],
          },
        ]}
        businessGroups={[
          {
            teamId: "TEAM-FIN",
            name: "Finance",
            description: "Accounts payable and treasury",
            memberCount: 3,
            primaryMembers: ["Ava Green"],
            coworkerCount: 1,
            coworkerNames: ["Finance Specialist"],
          },
        ]}
      />,
    );

    expect(html).toContain("Groups");
    expect(html).toContain("Role groups");
    expect(html).toContain("Business groups");
    expect(html).toContain("HR-200");
    expect(html).toContain("Business Operations");
    expect(html).toContain("TEAM-FIN");
    expect(html).toContain("Finance Specialist");
  });
});
