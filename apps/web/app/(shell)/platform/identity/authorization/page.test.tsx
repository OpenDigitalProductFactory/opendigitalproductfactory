import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    platformRole: {
      findMany: vi.fn(),
    },
    userGroup: {
      findMany: vi.fn(),
    },
    team: {
      findMany: vi.fn(),
    },
    agent: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("PlatformIdentityAuthorizationPage", () => {
  it("shows role bundles, assignments, teams, and coworker authority coverage", async () => {
    vi.mocked(prisma.platformRole.findMany).mockResolvedValue([
      {
        id: "role-db-1",
        roleId: "HR-200",
        name: "Business Operations",
        description: "Finance and customer operations",
        hitlTierMin: 2,
        slaDurationH: null,
      },
    ] as never);

    vi.mocked(prisma.userGroup.findMany).mockResolvedValue([
      {
        id: "ug-1",
        userId: "user-1",
        platformRoleId: "role-db-1",
        platformRole: {
          id: "role-db-1",
          roleId: "HR-200",
          name: "Business Operations",
          description: "Finance and customer operations",
          hitlTierMin: 2,
          slaDurationH: null,
        },
        user: {
          email: "ava@dpf.local",
          employeeProfile: {
            displayName: "Ava Green",
          },
        },
      },
    ] as never);

    vi.mocked(prisma.team.findMany).mockResolvedValue([
      {
        id: "team-db-1",
        teamId: "TEAM-FIN",
        name: "Finance",
        slug: "finance",
        description: null,
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

    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      {
        id: "agent-db-1",
        agentId: "AGT-FIN-001",
        name: "Finance Specialist",
        status: "active",
        lifecycleStage: "production",
        humanSupervisorId: "HR-200",
        governanceProfile: {
          capabilityClass: {
            name: "Payables",
          },
          directivePolicyClass: {
            name: "Approval Required",
          },
        },
        ownerships: [
          {
            team: {
              name: "Finance",
            },
          },
        ],
      },
    ] as never);

    const { default: PlatformIdentityAuthorizationPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformIdentityAuthorizationPage());

    expect(html).toContain("Authorization");
    expect(html).toContain("Role bundles");
    expect(html).toContain("Current human assignments");
    expect(html).toContain("Team memberships");
    expect(html).toContain("AI coworker authority coverage");
    expect(html).toContain("HR-200");
    expect(html).toContain("Business Operations");
    expect(html).toContain("/finance");
    expect(html).toContain("Ava Green");
    expect(html).toContain("Finance Specialist");
  });
});
