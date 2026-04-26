import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  featureBuild: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  buildActivity: {
    create: vi.fn(),
  },
};

const mockAdvanceBuildPhase = vi.fn();
const mockEmit = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/actions/build", () => ({
  advanceBuildPhase: mockAdvanceBuildPhase,
}));

vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: {
    emit: mockEmit,
  },
}));

describe("saveBuildEvidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.featureBuild.findFirst.mockResolvedValue({
      buildId: "FB-12345678",
    });
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      buildId: "FB-12345678",
      title: "Customer complaint tracker",
      brief: null,
      phase: "ideate",
      designDoc: null,
      designReview: null,
      buildPlan: null,
      planReview: null,
      taskResults: null,
      verificationOut: null,
      acceptanceMet: null,
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});
    mockPrisma.buildActivity.create.mockResolvedValue({});
    mockAdvanceBuildPhase.mockResolvedValue(undefined);
  });

  it("accepts top-level designDoc fields when value is omitted", async () => {
    const { executeTool } = await import("./mcp-tools");

    const result = await executeTool(
      "saveBuildEvidence",
      {
        field: "designDoc",
        problemStatement: "Customers need complaint intake and tracking.",
        existingFunctionalityAudit:
          "apps/web/app/api/quality/report/route.ts handles quality reports, packages/db/prisma/schema.prisma shows User email and platformRole fields, and route handlers use auth() from @/lib/auth.",
        externalResearch: "Complaint workflows need triage, assignment, SLA tracking, and escalation.",
        alternativesConsidered: "Extend quality reports versus build a complaint-specific workflow.",
        reusePlan: "Reuse auth, route, and list/detail page patterns from existing operational features.",
        newCodeJustification: "A complaint tracker needs dedicated lifecycle, ownership, and customer communication history.",
        proposedApproach: "Add complaint records, API routes, and a Build Studio-managed UI flow.",
        acceptanceCriteria: ["Users can log complaints", "Owners can track complaint status"],
      },
      "user-1",
      { threadId: "thread-1", routeContext: "/build" },
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-12345678" },
        data: expect.objectContaining({
          designDoc: expect.objectContaining({
            problemStatement: "Customers need complaint intake and tracking.",
            existingFunctionalityAudit: expect.stringContaining("quality/report/route.ts"),
            proposedApproach: expect.stringContaining("Build Studio-managed UI flow"),
          }),
        }),
      }),
    );
  });

  it("canonicalizes legacy Build Studio file paths before persisting buildPlan", async () => {
    const { executeTool } = await import("./mcp-tools");

    const result = await executeTool(
      "saveBuildEvidence",
      {
        field: "buildPlan",
        value: {
          fileStructure: [
            {
              path: "apps/web/components/build-studio/WorkflowGraphPanel.tsx",
              action: "modify",
              purpose: "Constrain graph canvas",
            },
          ],
          tasks: [
            {
              title: "Constrain graph canvas",
              testFirst: "Inspect apps/web/components/build-studio/WorkflowGraphPanel.tsx",
              implement: "Update apps/web/components/build-studio/WorkflowGraphPanel.tsx",
              verify: "Graph stays in bounds",
            },
          ],
        },
      },
      "user-1",
      { threadId: "thread-1", routeContext: "/build" },
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-12345678" },
        data: expect.objectContaining({
          buildPlan: expect.objectContaining({
            fileStructure: [
              expect.objectContaining({
                path: "apps/web/components/build/ProcessGraph.tsx",
              }),
            ],
            tasks: [
              expect.objectContaining({
                implement: "Update apps/web/components/build/ProcessGraph.tsx",
              }),
            ],
          }),
        }),
      }),
    );
  });
});
