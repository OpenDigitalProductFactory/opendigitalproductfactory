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

vi.mock("@dpf/db", () => ({
  prisma: {
    agentModelConfig: {
      findMany: vi.fn(),
    },
    modelProvider: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
    agentToolGrant: {
      groupBy: vi.fn(),
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

describe("AssignmentsPage", () => {
  it("renders coworker bindings without replacing model assignment", async () => {
    vi.mocked(prisma.agentModelConfig.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.agentToolGrant.groupBy).mockResolvedValue([] as never);
    vi.mocked(listAuthorityBindingRecords).mockResolvedValue([] as never);
    vi.mocked(listAuthorityBindings).mockResolvedValue({
      pivot: "coworker",
      rows: [
        {
          bindingId: "AB-000001",
          name: "Finance workspace controller",
          pivotKind: "coworker",
          pivotLabel: "Finance Controller",
          status: "active",
          scopeType: "route",
          resourceType: "route",
          resourceRef: "/finance",
          approvalMode: "proposal-required",
          sensitivityCeiling: "confidential",
          appliedAgentId: "finance-controller",
          appliedAgentName: "Finance Controller",
          subjectLabels: ["HR-400"],
          subjectCount: 1,
          grantModes: ["ledger_write:require-approval"],
        },
      ],
    });
    vi.mocked(parseAuthorityBindingFilters).mockReturnValue({});
    vi.mocked(getAuthorityBindingFilterOptions).mockReturnValue({
      statuses: ["active"],
      resourceRefs: ["/finance"],
      appliedAgents: [{ agentId: "finance-controller", agentName: "Finance Controller" }],
      subjectRefs: ["HR-400"],
    });
    vi.mocked(getAuthorityBinding).mockResolvedValue(null);
    vi.mocked(getAuthorityBindingEvidence).mockResolvedValue([]);
    vi.mocked(getAuthorityBindingBootstrapState).mockResolvedValue({
      autoApplied: false,
      totalBindings: 1,
      report: null,
    });

    const { default: AssignmentsPage } = await import("./page");
    const html = renderToStaticMarkup(await AssignmentsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("AI Coworker Model Assignment");
    expect(html).toContain("Resource Bindings");
    expect(html).toContain("Filter bindings");
    expect(html).toContain("Refresh inferred bindings");
    expect(html).toContain("Finance Controller");
    expect(html).toContain("/finance");
  });

  it("opens the shared binding editor inline when a binding query param is present", async () => {
    vi.mocked(prisma.agentModelConfig.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.agentToolGrant.groupBy).mockResolvedValue([] as never);
    vi.mocked(listAuthorityBindingRecords).mockResolvedValue([] as never);
    vi.mocked(listAuthorityBindings).mockResolvedValue({ pivot: "coworker", rows: [] });
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
      appliedAgent: {
        agentId: "finance-controller",
        name: "Finance Controller",
        governanceProfile: null,
        toolGrants: [{ grantKey: "backlog_read" }],
      },
      subjects: [],
      grants: [],
    } as never);
    vi.mocked(getAuthorityBindingEvidence).mockResolvedValue([]);
    vi.mocked(getAuthorityBindingBootstrapState).mockResolvedValue({
      autoApplied: false,
      totalBindings: 1,
      report: null,
    });

    const { default: AssignmentsPage } = await import("./page");
    const html = renderToStaticMarkup(
      await AssignmentsPage({ searchParams: Promise.resolve({ binding: "AB-000001" }) }),
    );

    expect(html).toContain("Editing binding AB-000001");
    expect(html).toContain("Save changes");
  });

  it("shows low-confidence review guidance from the coworker-first surface", async () => {
    vi.mocked(prisma.agentModelConfig.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.agentToolGrant.groupBy).mockResolvedValue([] as never);
    vi.mocked(listAuthorityBindingRecords).mockResolvedValue([] as never);
    vi.mocked(listAuthorityBindings).mockResolvedValue({ pivot: "coworker", rows: [] });
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
      autoApplied: false,
      totalBindings: 0,
      report: {
        created: 0,
        skippedExisting: 0,
        wouldCreate: 0,
        candidates: [],
        lowConfidence: [{ resourceRef: "/setup", agentId: "onboarding-coo", reason: "ungated-route" }],
      },
    });

    const { default: AssignmentsPage } = await import("./page");
    const html = renderToStaticMarkup(await AssignmentsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Bootstrap coverage");
    expect(html).toContain("No authority bindings are active yet");
    expect(html).toContain("/setup");
  });
});
