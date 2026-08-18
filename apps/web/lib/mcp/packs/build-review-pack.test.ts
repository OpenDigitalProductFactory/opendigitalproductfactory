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
const mockSaveBuildArtifactRevision = vi.fn(async (args: { buildId: string; field: string; value: unknown }) => {
  await mockPrisma.featureBuild.update({
    where: { buildId: args.buildId },
    data: { [args.field]: args.value },
  });

  return {
    revisionId: "BAR-1",
    revisionNumber: 1,
    status: "accepted",
    warnings: [],
    errors: [],
    receiptIds: [],
  };
});

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

vi.mock("@/lib/build/build-artifact-provenance", () => ({
  saveBuildArtifactRevision: mockSaveBuildArtifactRevision,
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
    const { executeTool } = await import("@/lib/mcp-tools");

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
    const { executeTool } = await import("@/lib/mcp-tools");

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

  // Regression: a writer once stored a backlog claim summary under taskResults,
  // causing the Build Studio process graph to crash with "Cannot read
  // properties of undefined (reading 'split')". Reject that shape at the
  // boundary so it can't reach the column.
  it("rejects taskResults entries that lack title/specialist", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");

    const result = await executeTool(
      "saveBuildEvidence",
      {
        field: "taskResults",
        value: {
          tasks: [{ status: "claimed_by_ai_coworker", item_id: "BI-B6423E18" }],
        },
      },
      "user-1",
      { threadId: "thread-1", routeContext: "/build" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing title\/specialist/);
    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalled();
  });

  it("accepts taskResults with the canonical orchestrator shape", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");

    const result = await executeTool(
      "saveBuildEvidence",
      {
        field: "taskResults",
        value: {
          completedTasks: 1,
          totalTasks: 1,
          tasks: [
            { title: "Add schema", specialist: "data-architect", outcome: "DONE", durationMs: 1200 },
          ],
        },
      },
      "user-1",
      { threadId: "thread-1", routeContext: "/build" },
    );

    expect(result.success).toBe(true);
  });

  // Regression: coworker was taught to pass {summary, files, approach} from a
  // stale prompt example. Those keys don't exist on BuildDesignDoc, so
  // doc.problemStatement was undefined and `${doc.problemStatement}` in the
  // review prompt became the literal string "undefined", causing every review
  // to fail and the coworker to retry in an infinite loop.
  it("rejects designDoc with wrong field names (summary/approach instead of problemStatement/proposedApproach)", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");

    const result = await executeTool(
      "saveBuildEvidence",
      {
        field: "designDoc",
        value: {
          summary: "A customer complaint tracker.",
          files: ["apps/web/app/complaints/page.tsx"],
          approach: "Add a new route and model.",
          existingFunctionalityAudit: "apps/web/app/api/quality/report/route.ts handles quality reports.",
        },
      },
      "user-1",
      { threadId: "thread-1", routeContext: "/build" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/problemStatement/);
    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalled();
  });

  it("rejects designDoc when value is undefined", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");

    const result = await executeTool(
      "saveBuildEvidence",
      {
        field: "designDoc",
        // value is intentionally omitted — no top-level fields either
      },
      "user-1",
      { threadId: "thread-1", routeContext: "/build" },
    );

    expect(result.success).toBe(false);
    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalled();
  });

  it("returns saved:true with length on successful designDoc save", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");

    const result = await executeTool(
      "saveBuildEvidence",
      {
        field: "designDoc",
        value: {
          problemStatement: "Customers need complaint intake and tracking.",
          existingFunctionalityAudit: "apps/web/app/api/quality/report/route.ts handles quality reports.",
          reusePlan: "Reuse auth and list/detail page patterns.",
          proposedApproach: "Add complaint records, API routes, and a Build Studio-managed UI flow.",
          acceptanceCriteria: ["Users can log complaints", "Owners can track complaint status"],
        },
      },
      "user-1",
      { threadId: "thread-1", routeContext: "/build" },
    );

    expect(result.success).toBe(true);
    expect(result.data?.saved).toBe(true);
    expect(typeof result.data?.length).toBe("number");
  });

  it("accepts taskResults summary writes that omit the tasks array", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");

    const result = await executeTool(
      "saveBuildEvidence",
      {
        field: "taskResults",
        value: {
          agenticResult: "Build complete",
          toolsExecuted: ["generate_code"],
          filesChanged: 3,
          ranTests: true,
        },
      },
      "user-1",
      { threadId: "thread-1", routeContext: "/build" },
    );

    expect(result.success).toBe(true);
  });
});
