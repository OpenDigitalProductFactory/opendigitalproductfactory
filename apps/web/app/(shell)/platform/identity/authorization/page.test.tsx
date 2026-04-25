import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: {
      platformRole: "HR-000",
      isSuperuser: true,
    },
  }),
}));

vi.mock("@/lib/authority/bindings", () => ({
  listAuthorityBindings: vi.fn(),
  listAuthorityBindingRecords: vi.fn(),
  getAuthorityBinding: vi.fn(),
  getAuthorityBindingEvidence: vi.fn(),
  getAuthorityBindingFilterOptions: vi.fn(),
  parseAuthorityBindingFilters: vi.fn(),
}));

vi.mock("@/lib/authority/bootstrap-rollout", () => ({
  getAuthorityBindingBootstrapState: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn().mockReturnValue(true),
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
import {
  getAuthorityBinding,
  getAuthorityBindingEvidence,
  getAuthorityBindingFilterOptions,
  listAuthorityBindingRecords,
  listAuthorityBindings,
  parseAuthorityBindingFilters,
} from "@/lib/authority/bindings";
import { getAuthorityBindingBootstrapState } from "@/lib/authority/bootstrap-rollout";

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
    vi.mocked(listAuthorityBindingRecords).mockResolvedValue([] as never);
    vi.mocked(parseAuthorityBindingFilters).mockReturnValue({});
    vi.mocked(getAuthorityBindingFilterOptions).mockReturnValue({
      statuses: ["active"],
      resourceRefs: ["/finance"],
      appliedAgents: [{ agentId: "AGT-FIN-001", agentName: "Finance Specialist" }],
      subjectRefs: ["HR-200"],
    });
    vi.mocked(getAuthorityBinding).mockResolvedValue(null);
    vi.mocked(getAuthorityBindingEvidence).mockResolvedValue([]);
    vi.mocked(getAuthorityBindingBootstrapState).mockResolvedValue({
      autoApplied: false,
      totalBindings: 1,
      report: null,
    });

    const { default: PlatformIdentityAuthorizationPage } = await import("./page");
    const html = renderToStaticMarkup(
      await PlatformIdentityAuthorizationPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Authorization");
    expect(html).toContain("Authorization Bindings");
    expect(html).toContain("Filter bindings");
    expect(html).toContain("Refresh inferred bindings");
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
    vi.mocked(listAuthorityBindingRecords).mockResolvedValue([] as never);
    vi.mocked(listAuthorityBindings).mockResolvedValue({ pivot: "subject", rows: [] });
    vi.mocked(parseAuthorityBindingFilters).mockReturnValue({});
    vi.mocked(getAuthorityBindingFilterOptions).mockReturnValue({
      statuses: [],
      resourceRefs: [],
      appliedAgents: [],
      subjectRefs: [],
    });
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
    vi.mocked(getAuthorityBindingBootstrapState).mockResolvedValue({
      autoApplied: false,
      totalBindings: 1,
      report: null,
    });

    const { default: PlatformIdentityAuthorizationPage } = await import("./page");
    const html = renderToStaticMarkup(
      await PlatformIdentityAuthorizationPage({
        searchParams: Promise.resolve({ binding: "AB-000001" }),
      }),
    );

    expect(html).toContain("Editing binding AB-000001");
    expect(html).toContain("Save changes");
  });

  it("shows bootstrap coverage guidance when the first-run bootstrap had to infer or skip routes", async () => {
    vi.mocked(prisma.platformRole.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.userGroup.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.team.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([] as never);
    vi.mocked(listAuthorityBindingRecords).mockResolvedValue([] as never);
    vi.mocked(listAuthorityBindings).mockResolvedValue({ pivot: "subject", rows: [] });
    vi.mocked(parseAuthorityBindingFilters).mockReturnValue({});
    vi.mocked(getAuthorityBindingFilterOptions).mockReturnValue({
      statuses: [],
      resourceRefs: [],
      appliedAgents: [],
      subjectRefs: [],
    });
    vi.mocked(getAuthorityBinding).mockResolvedValue(null);
    vi.mocked(getAuthorityBindingEvidence).mockResolvedValue([]);
    vi.mocked(getAuthorityBindingBootstrapState).mockResolvedValue({
      autoApplied: true,
      totalBindings: 0,
      report: {
        created: 2,
        skippedExisting: 0,
        wouldCreate: 0,
        candidates: [],
        lowConfidence: [{ resourceRef: "/setup", agentId: "onboarding-coo", reason: "ungated-route" }],
      },
    });

    const { default: PlatformIdentityAuthorizationPage } = await import("./page");
    const html = renderToStaticMarkup(
      await PlatformIdentityAuthorizationPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Bootstrap coverage");
    expect(html).toContain("Auto-applied initial authority binding bootstrap");
    expect(html).toContain("/setup");
  });
});
