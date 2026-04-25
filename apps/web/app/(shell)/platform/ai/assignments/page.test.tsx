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
  getAuthorityBinding: vi.fn(),
  getAuthorityBindingEvidence: vi.fn(),
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
import { getAuthorityBinding, getAuthorityBindingEvidence, listAuthorityBindings } from "@/lib/authority/bindings";

describe("AssignmentsPage", () => {
  it("renders coworker bindings without replacing model assignment", async () => {
    vi.mocked(prisma.agentModelConfig.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.agentToolGrant.groupBy).mockResolvedValue([] as never);
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
    vi.mocked(getAuthorityBinding).mockResolvedValue(null);
    vi.mocked(getAuthorityBindingEvidence).mockResolvedValue([]);

    const { default: AssignmentsPage } = await import("./page");
    const html = renderToStaticMarkup(await AssignmentsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("AI Coworker Model Assignment");
    expect(html).toContain("Resource Bindings");
    expect(html).toContain("Finance Controller");
    expect(html).toContain("/finance");
  });

  it("opens the shared binding editor inline when a binding query param is present", async () => {
    vi.mocked(prisma.agentModelConfig.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.agentToolGrant.groupBy).mockResolvedValue([] as never);
    vi.mocked(listAuthorityBindings).mockResolvedValue({ pivot: "coworker", rows: [] });
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

    const { default: AssignmentsPage } = await import("./page");
    const html = renderToStaticMarkup(
      await AssignmentsPage({ searchParams: Promise.resolve({ binding: "AB-000001" }) }),
    );

    expect(html).toContain("Editing binding AB-000001");
    expect(html).toContain("Save changes");
  });
});
