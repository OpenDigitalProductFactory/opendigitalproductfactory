import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockRequireCapability, mockRevalidatePath } = vi.hoisted(() => ({
  mockPrisma: {
    coworkerCapabilityNeed: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    decisionInteraction: {
      create: vi.fn(),
    },
    trustState: {
      update: vi.fn(),
      create: vi.fn(),
    },
    workCase: {
      update: vi.fn(),
    },
    skillDefinition: {
      update: vi.fn(),
    },
    promptTemplate: {
      update: vi.fn(),
    },
    backlogItem: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockRequireCapability: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/actions/shared/guards", () => ({
  requireCapability: mockRequireCapability,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

import { recordWorkPatternReview } from "./work-pattern-review";

function shadowTrials(count = 20) {
  return Array.from({ length: count }, (_, index) => ({
    trialId: `S-${index + 1}`,
    riskClass: "internal-reversible",
    candidateDecision: "file grant need",
    actualDecision: index === count - 1 && count >= 20 ? "defer" : "file grant need",
    outcome: index === count - 1 && count >= 20 ? "missed" : "accepted",
    agreement: !(index === count - 1 && count >= 20),
    toolCallDelta: -2,
    failureDelta: -1,
    manualTouchDelta: 0,
    contextTokenDelta: -900,
    reviewFailureDelta: 0,
    observedAt: "2026-06-28T10:30:00.000Z",
  }));
}

function needRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "need-row-1",
    needId: "NEED-1",
    agentId: "build-specialist",
    kind: "grant",
    severity: "important",
    status: "submitted",
    need: "Missing sandbox lease grant",
    blocks: "Repeated grant denials block verification.",
    evidenceJson: {
      patternKey: "grant-denial|build-specialist|/build",
      decisionScope: "platform-wwmd",
      riskClass: "internal-reversible",
      currentAutonomyLevel: "shadow",
      shadowTrials: shadowTrials(),
      taskRunId: "TR-1",
      toolExecutionId: "TE-1",
    },
    readinessJson: {
      readyForReview: true,
      readyForCaseActivation: false,
      blockers: ["pattern-status-not-approved-or-active"],
    },
    linkedBacklogItemId: "BI-1",
    assessment: {
      routeContext: "/build",
    },
    ...overrides,
  };
}

function form(action: string) {
  const data = new FormData();
  data.set("needId", "NEED-1");
  data.set("agentId", "build-specialist");
  data.set("action", action);
  data.set("note", "Approve only for sandbox lease filing.");
  return data;
}

describe("reviewWorkPatternAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCapability.mockResolvedValue({ userId: "user-1" });
    mockPrisma.coworkerCapabilityNeed.findUnique.mockResolvedValue(needRow());
    mockPrisma.coworkerCapabilityNeed.update.mockResolvedValue({});
    mockPrisma.decisionInteraction.create.mockImplementation(async ({ data }) => ({
      id: "decision-row-1",
      ...data,
    }));
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  });

  it("records approval as a DecisionInteraction and scoped activation candidate", async () => {
    await expect(recordWorkPatternReview(form("approve"))).resolves.toMatchObject({
      status: "recorded",
      action: "approve",
      needId: "NEED-1",
    });

    expect(mockRequireCapability).toHaveBeenCalledWith("manage_platform");
    expect(mockPrisma.decisionInteraction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        domainClass: "risk-assessment",
        routeContext: "/platform/ai/agent/build-specialist",
        outcomeType: "recommend",
        riskTier: "medium",
        humanOutcome: expect.objectContaining({
          type: "work-pattern-review",
          action: "approve",
          clearsGate: false,
          resolverUserId: "user-1",
        }),
      }),
    });
    expect(mockPrisma.coworkerCapabilityNeed.update).toHaveBeenCalledWith({
      where: { needId: "NEED-1" },
      data: expect.objectContaining({
        status: "accepted",
        reviewerNote: "Approve only for sandbox lease filing.",
        readinessJson: expect.objectContaining({
          activationProposed: true,
          workPatternReview: expect.objectContaining({
            action: "approve",
            status: "approved-candidate",
            activationCandidate: expect.objectContaining({
              activationAllowed: false,
              proposedAutonomyLevel: "propose",
            }),
          }),
        }),
        evidenceJson: expect.objectContaining({
          decisionInteractionId: expect.stringMatching(/^DI-[A-F0-9]{12}$/),
        }),
      }),
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/ai/agent/build-specialist");
  });

  it("records rejection without creating an activation candidate", async () => {
    await expect(recordWorkPatternReview(form("reject"))).resolves.toMatchObject({
      status: "recorded",
      action: "reject",
    });

    const update = mockPrisma.coworkerCapabilityNeed.update.mock.calls[0]![0];
    expect(update.data.status).toBe("discarded");
    expect(update.data.readinessJson.workPatternReview).toMatchObject({
      action: "reject",
      status: "rejected",
      activationCandidate: null,
    });
    expect(update.data.readinessJson.activationProposed).toBe(false);
  });

  it("records deferral as a deferred decision", async () => {
    await expect(recordWorkPatternReview(form("defer"))).resolves.toMatchObject({
      status: "recorded",
      action: "defer",
    });

    expect(mockPrisma.decisionInteraction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        outcomeType: "defer",
        humanOutcome: expect.objectContaining({
          action: "defer",
          clearsGate: false,
        }),
      }),
    });
    expect(mockPrisma.coworkerCapabilityNeed.update.mock.calls[0]![0].data.status).toBe("deferred");
  });

  it("fails approval before writes when shadow evidence is not promotable", async () => {
    mockPrisma.coworkerCapabilityNeed.findUnique.mockResolvedValue(
      needRow({
        evidenceJson: {
          patternKey: "grant-denial|build-specialist|/build",
          decisionScope: "platform-wwmd",
          riskClass: "internal-reversible",
          currentAutonomyLevel: "shadow",
          shadowTrials: shadowTrials(5),
        },
      }),
    );

    await expect(recordWorkPatternReview(form("approve"))).rejects.toThrow(
      "approval_requires_promotable_shadow_evidence",
    );

    expect(mockPrisma.decisionInteraction.create).not.toHaveBeenCalled();
    expect(mockPrisma.coworkerCapabilityNeed.update).not.toHaveBeenCalled();
  });

  it("does not write when authorization fails", async () => {
    mockRequireCapability.mockRejectedValue(new Error("Unauthorized"));

    await expect(recordWorkPatternReview(form("approve"))).rejects.toThrow("Unauthorized");

    expect(mockPrisma.coworkerCapabilityNeed.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.decisionInteraction.create).not.toHaveBeenCalled();
  });

  it("does not mutate live autonomy, Work Cases, skills, prompts, or backlog", async () => {
    await recordWorkPatternReview(form("approve"));

    expect(mockPrisma.trustState.update).not.toHaveBeenCalled();
    expect(mockPrisma.trustState.create).not.toHaveBeenCalled();
    expect(mockPrisma.workCase.update).not.toHaveBeenCalled();
    expect(mockPrisma.skillDefinition.update).not.toHaveBeenCalled();
    expect(mockPrisma.promptTemplate.update).not.toHaveBeenCalled();
    expect(mockPrisma.backlogItem.update).not.toHaveBeenCalled();
  });
});
