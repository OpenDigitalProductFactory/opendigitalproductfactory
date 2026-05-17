import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockPrisma } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    decisionInteraction: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    escalationCapture: {
      create: vi.fn(),
    },
    deferralCapture: {
      create: vi.fn(),
    },
    buildActivity: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { captureDecisionInteraction } from "./decision-perspective";

function interactionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "decision-row-1",
    interactionId: "DI-ABC123",
    outcomeType: "escalate",
    question: "Start implementation from the reviewed Build Studio plan?",
    domainClass: "plan-readiness",
    buildId: "FB-123",
    build: {
      buildId: "FB-123",
      createdById: "user-1",
    },
    escalationCapture: null,
    deferralCapture: null,
    ...overrides,
  };
}

describe("captureDecisionInteraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        platformRole: "HR-000",
        isSuperuser: true,
      },
    });
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
    mockPrisma.decisionInteraction.update.mockResolvedValue({});
    mockPrisma.escalationCapture.create.mockResolvedValue({ escalationId: "ESC-123" });
    mockPrisma.deferralCapture.create.mockResolvedValue({ deferralId: "DEF-123" });
    mockPrisma.buildActivity.create.mockResolvedValue({});
  });

  it("persists human escalation direction as a single durable capture row", async () => {
    mockPrisma.decisionInteraction.findUnique.mockResolvedValue(interactionRow());

    await expect(
      captureDecisionInteraction({
        buildId: "FB-123",
        interactionId: "DI-ABC123",
        outcomeType: "escalate",
        answer: "Proceed after the owner confirms the implementation scope.",
        criteriaText: "Owner accepted scope\nNo unresolved objections",
        rationale: "The escalation resolved the ambiguity and preserved the decision criteria.",
        objectionsResolvedText: "Timing concern resolved",
        candidateMaterial: true,
      }),
    ).resolves.toMatchObject({
      status: "captured",
      captureType: "escalation",
    });

    expect(mockPrisma.escalationCapture.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        escalationId: expect.stringMatching(/^ESC-[A-F0-9]{12}$/),
        interactionId: "decision-row-1",
        resolverUserId: "user-1",
        prompt: "Start implementation from the reviewed Build Studio plan?",
        answer: "Proceed after the owner confirms the implementation scope.",
        criteria: ["Owner accepted scope", "No unresolved objections"],
        rationale: "The escalation resolved the ambiguity and preserved the decision criteria.",
        objectionsResolved: ["Timing concern resolved"],
        domainClass: "plan-readiness",
        candidateMaterial: true,
      }),
    });
    expect(mockPrisma.decisionInteraction.update).toHaveBeenCalledWith({
      where: { id: "decision-row-1" },
      data: {
        humanOutcome: expect.objectContaining({
          type: "escalation",
          clearsGate: true,
          resolverUserId: "user-1",
          criteria: ["Owner accepted scope", "No unresolved objections"],
        }),
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/build");
  });

  it("persists deferral gap details without clearing the gate", async () => {
    mockPrisma.decisionInteraction.findUnique.mockResolvedValue(
      interactionRow({
        outcomeType: "defer",
        question: "Start implementation from a sparse decision profile?",
      }),
    );

    await expect(
      captureDecisionInteraction({
        buildId: "FB-123",
        interactionId: "DI-ABC123",
        outcomeType: "defer",
        answer: "No approved material covers this decision class yet.",
        suggestedSourceTypesText: "principle\narticle",
        candidateMaterial: true,
      }),
    ).resolves.toMatchObject({
      status: "captured",
      captureType: "deferral",
    });

    expect(mockPrisma.deferralCapture.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deferralId: expect.stringMatching(/^DEF-[A-F0-9]{12}$/),
        interactionId: "decision-row-1",
        domain: "plan-readiness",
        gapReason: "No approved material covers this decision class yet.",
        suggestedSourceTypes: ["principle", "article"],
        candidateMaterial: true,
      }),
    });
    expect(mockPrisma.decisionInteraction.update).toHaveBeenCalledWith({
      where: { id: "decision-row-1" },
      data: {
        humanOutcome: expect.objectContaining({
          type: "deferral",
          clearsGate: false,
          suggestedSourceTypes: ["principle", "article"],
        }),
      },
    });
  });

  it("returns the existing capture without writing a duplicate row", async () => {
    mockPrisma.decisionInteraction.findUnique.mockResolvedValue(
      interactionRow({
        escalationCapture: { escalationId: "ESC-EXISTING" },
      }),
    );

    await expect(
      captureDecisionInteraction({
        buildId: "FB-123",
        interactionId: "DI-ABC123",
        outcomeType: "escalate",
        answer: "Already resolved.",
      }),
    ).resolves.toEqual({
      status: "already-captured",
      captureType: "escalation",
      captureId: "ESC-EXISTING",
    });

    expect(mockPrisma.escalationCapture.create).not.toHaveBeenCalled();
    expect(mockPrisma.decisionInteraction.update).not.toHaveBeenCalled();
  });

  it("rejects capture attempts for builds owned by another user", async () => {
    mockPrisma.decisionInteraction.findUnique.mockResolvedValue(
      interactionRow({
        build: {
          buildId: "FB-123",
          createdById: "user-2",
        },
      }),
    );

    await expect(
      captureDecisionInteraction({
        buildId: "FB-123",
        interactionId: "DI-ABC123",
        outcomeType: "escalate",
        answer: "Proceed.",
      }),
    ).rejects.toThrow("Forbidden");

    expect(mockPrisma.escalationCapture.create).not.toHaveBeenCalled();
  });
});
