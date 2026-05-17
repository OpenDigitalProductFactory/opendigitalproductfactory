import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockPrisma, mockEvaluateBuildStudioPlanAdvancementGate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    featureBuild: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    platformDevConfig: {
      findUnique: vi.fn(),
    },
    buildActivity: {
      create: vi.fn(),
    },
  },
  mockEvaluateBuildStudioPlanAdvancementGate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/decision-perspective/build-studio-gate", () => ({
  evaluateBuildStudioPlanAdvancementGate: mockEvaluateBuildStudioPlanAdvancementGate,
}));

import { POST } from "./route";

function makeReq(body: unknown): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

function makePlanReadyBuild(overrides: Record<string, unknown> = {}) {
  return {
    buildId: "FB-123",
    title: "Add WWMD gate",
    phase: "plan",
    originatingBacklogItemId: "backlog-row-1",
    draftApprovedAt: new Date("2026-05-17T10:00:00.000Z"),
    designDoc: { problemStatement: "Need a decision gate." },
    designReview: { decision: "pass", summary: "ok", issues: [] },
    plan: {
      happyPathState: {
        intake: {
          status: "ready",
          taxonomyNodeId: "taxonomy-1",
          backlogItemId: "BI-WWMD",
          epicId: "EP-WWMD",
          constrainedGoal: "Add WWMD gate",
          failureReason: null,
        },
      },
    },
    buildPlan: {
      fileStructure: [{ path: "apps/web/lib/decision-perspective/build-studio-gate.ts" }],
      tasks: [{ title: "Gate", testFirst: "test", implement: "code", verify: "vitest" }],
    },
    planReview: { decision: "pass", summary: "ready", issues: [] },
    verificationOut: null,
    acceptanceMet: null,
    deliberationSummary: null,
    threadId: "thread-1",
    ...overrides,
  };
}

describe("POST /api/agent/build/advance-phase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        platformRole: "HR-000",
        isSuperuser: true,
      },
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({ governedBacklogEnabled: true });
    mockPrisma.buildActivity.create.mockResolvedValue({});
    mockPrisma.featureBuild.update.mockResolvedValue({});
    mockEvaluateBuildStudioPlanAdvancementGate.mockResolvedValue({
      allowed: true,
      interactionId: "DI-ALLOW",
      operatorMessage: "WWMD recommends starting implementation.",
      evaluation: {
        outcomeType: "recommend",
        confidenceScore: 0.9,
        coverageGap: false,
        principleConflict: false,
      },
    });
  });

  it("runs the WWMD gate before manually advancing plan to build", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(makePlanReadyBuild());

    const response = await POST(makeReq({ buildId: "FB-123", targetPhase: "build" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockEvaluateBuildStudioPlanAdvancementGate).toHaveBeenCalledWith(
      expect.objectContaining({
        build: expect.objectContaining({ buildId: "FB-123", phase: "plan" }),
      }),
    );
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith({
      where: { buildId: "FB-123" },
      data: { phase: "build" },
    });
  });

  it("returns a decision interaction payload when WWMD blocks advancement", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(makePlanReadyBuild());
    mockEvaluateBuildStudioPlanAdvancementGate.mockResolvedValue({
      allowed: false,
      interactionId: "DI-BLOCK",
      operatorMessage: "WWMD requires escalation before implementation starts.",
      evaluation: {
        outcomeType: "escalate",
        confidenceScore: 0.42,
        coverageGap: false,
        principleConflict: true,
      },
    });

    const response = await POST(makeReq({ buildId: "FB-123", targetPhase: "build" }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toContain("WWMD requires escalation");
    expect(body.decisionInteraction).toEqual({
      interactionId: "DI-BLOCK",
      outcomeType: "escalate",
      confidenceScore: 0.42,
      coverageGap: false,
      principleConflict: true,
    });
    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalled();
  });
});
