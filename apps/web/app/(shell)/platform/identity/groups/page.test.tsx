import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    platformRole: {
      findMany: vi.fn(),
    },
    team: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("PlatformIdentityGroupsPage", () => {
  it("shows role groups and business groups from the current identity plane", async () => {
    vi.mocked(prisma.platformRole.findMany).mockResolvedValue([
      {
        id: "role-db-1",
        roleId: "HR-200",
        name: "Business Operations",
        description: "Finance and customer operations",
        hitlTierMin: 2,
        slaDurationH: null,
        users: [
          {
            id: "ug-1",
            userId: "user-1",
            platformRoleId: "role-db-1",
            user: {
              email: "ava@dpf.local",
              employeeProfile: {
                displayName: "Ava Green",
              },
            },
          },
        ],
      },
    ] as never);

    vi.mocked(prisma.team.findMany).mockResolvedValue([
      {
        id: "team-db-1",
        teamId: "TEAM-FIN",
        name: "Finance",
        slug: "finance",
        description: "Accounts payable and treasury",
        status: "active",
        createdAt: new Date("2026-04-23T12:00:00Z"),
        updatedAt: new Date("2026-04-23T12:00:00Z"),
        memberships: [
          {
            id: "tm-1",
            teamId: "team-db-1",
            userId: "user-1",
            role: "lead",
            isPrimary: true,
            createdAt: new Date("2026-04-23T12:00:00Z"),
            user: {
              email: "ava@dpf.local",
              employeeProfile: {
                displayName: "Ava Green",
              },
            },
          },
        ],
        ownerships: [
          {
            id: "own-1",
            agentId: "agent-db-1",
            teamId: "team-db-1",
            responsibility: "approvals",
            createdAt: new Date("2026-04-23T12:00:00Z"),
            agent: {
              agentId: "AGT-FIN-001",
              name: "Finance Specialist",
            },
          },
        ],
      },
    ] as never);

    const { default: PlatformIdentityGroupsPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformIdentityGroupsPage());

    expect(html).toContain("Groups");
    expect(html).toContain("Role groups");
    expect(html).toContain("Business groups");
    expect(html).toContain("Business Operations");
    expect(html).toContain("Finance");
    expect(html).toContain("Finance Specialist");
  });
});
