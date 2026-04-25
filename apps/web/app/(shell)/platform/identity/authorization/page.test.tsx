import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/authority/bindings", () => ({
  listAuthorityBindings: vi.fn(),
  getAuthorityBinding: vi.fn(),
  getAuthorityBindingEvidence: vi.fn(),
}));

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
import { getAuthorityBinding, getAuthorityBindingEvidence, listAuthorityBindings } from "@/lib/authority/bindings";

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
    vi.mocked(listAuthorityBindings).mockResolvedValue({
      pivot: "subject",
      rows: [
        {
          bindingId: "AB-000001",
          name: "Finance workspace controller",
          pivotKind: "subject",
          pivotLabel: "HR-200",
          status: "active",
          scopeType: "route",
          resourceType: "route",
          resourceRef: "/finance",
          approvalMode: "proposal-required",
          sensitivityCeiling: "confidential",
          appliedAgentId: "AGT-FIN-001",
          appliedAgentName: "Finance Specialist",
          subjectLabels: ["HR-200"],
          subjectCount: 1,
          grantModes: ["ledger_write:require-approval"],
        },
      ],
    });
    vi.mocked(getAuthorityBinding).mockResolvedValue(null);
    vi.mocked(getAuthorityBindingEvidence).mockResolvedValue([]);

    const { default: PlatformIdentityAuthorizationPage } = await import("./page");
    const html = renderToStaticMarkup(
      await PlatformIdentityAuthorizationPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Authorization");
    expect(html).toContain("Authorization Bindings");
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

  it("opens the shared binding editor inline when a binding query param is present", async () => {
    vi.mocked(prisma.platformRole.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.userGroup.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.team.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([] as never);
    vi.mocked(listAuthorityBindings).mockResolvedValue({ pivot: "subject", rows: [] });
    vi.mocked(getAuthorityBinding).mockResolvedValue({
      bindingId: "AB-000001",
      name: "Finance workspace controller",
      scopeType: "route",
      status: "active",
      resourceType: "route",
      resourceRef: "/finance",
      approvalMode: "proposal-required",
      sensitivityCeiling: null,
      appliedAgent: null,
      subjects: [],
      grants: [],
    } as never);
    vi.mocked(getAuthorityBindingEvidence).mockResolvedValue([]);

    const { default: PlatformIdentityAuthorizationPage } = await import("./page");
    const html = renderToStaticMarkup(
      await PlatformIdentityAuthorizationPage({
        searchParams: Promise.resolve({ binding: "AB-000001" }),
      }),
    );

    expect(html).toContain("Editing binding AB-000001");
    expect(html).toContain("Save changes");
  });
});
