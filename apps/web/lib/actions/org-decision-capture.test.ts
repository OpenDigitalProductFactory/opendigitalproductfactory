import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-6DCF772F: the org-business capture action's server-side option-id
// validation + chosenOptionId persistence. (No prior test existed for this
// action; the pure helpers are covered in lib/wiki/org-decision-capture.test.ts.)

const { mockPrisma, mockRequireCapability } = vi.hoisted(() => ({
  mockRequireCapability: vi.fn(),
  mockPrisma: {
    decisionInteraction: { findUnique: vi.fn(), update: vi.fn() },
    organization: { findFirst: vi.fn() },
    escalationCapture: { create: vi.fn() },
    deferralCapture: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@dpf/db/wiki-store", () => ({ upsertWikiPage: vi.fn(), appendRevision: vi.fn() }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: mockRequireCapability }));
vi.mock("@/lib/decision-perspective/stance-promotion", () => ({ promoteStanceMaterial: vi.fn() }));
vi.mock("@/lib/wiki/embeddings", () => ({ storeWikiPage: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { captureOrgDecisionOutcome } from "./org-decision-capture";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    interactionId: "DI-ORG-1",
    outcomeType: "escalate",
    question: "Refund this customer?",
    domainClass: "risk-assessment",
    buildId: null,
    humanOutcome: null,
    escalationCapture: null,
    deferralCapture: null,
    scoredOptions: [
      { id: "full-refund", description: "Full refund", features: {} },
      { id: "store-credit", description: "Store credit", features: {} },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireCapability.mockResolvedValue({ userId: "user-1" });
  mockPrisma.organization.findFirst.mockResolvedValue({ id: "org-1" });
  mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
  mockPrisma.escalationCapture.create.mockResolvedValue({});
  mockPrisma.decisionInteraction.update.mockResolvedValue({});
});

describe("captureOrgDecisionOutcome — chosenOptionId (BI-6DCF772F)", () => {
  it("rejects a chosen option that isn't one of the row's scored options, writing nothing", async () => {
    mockPrisma.decisionInteraction.findUnique.mockResolvedValue(row());

    const res = await captureOrgDecisionOutcome({
      interactionId: "DI-ORG-1",
      answer: "Give them a partial refund instead.",
      makeStanding: false,
      chosenOptionId: "not-an-option",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not one of this decision's options/);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.decisionInteraction.update).not.toHaveBeenCalled();
  });

  it("persists a valid chosen option on the column and in humanOutcome", async () => {
    mockPrisma.decisionInteraction.findUnique.mockResolvedValue(row());

    const res = await captureOrgDecisionOutcome({
      interactionId: "DI-ORG-1",
      answer: "Issue store credit per policy.",
      makeStanding: false,
      chosenOptionId: "store-credit",
    });

    expect(res.ok).toBe(true);
    expect(mockPrisma.decisionInteraction.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: expect.objectContaining({
        chosenOptionId: "store-credit",
        humanOutcome: expect.objectContaining({ chosenOptionId: "store-credit" }),
      }),
    });
  });

  it("leaves chosenOptionId null when the owner picks nothing (free-text only)", async () => {
    mockPrisma.decisionInteraction.findUnique.mockResolvedValue(row({ scoredOptions: null }));

    const res = await captureOrgDecisionOutcome({
      interactionId: "DI-ORG-1",
      answer: "Handle this case-by-case for now.",
      makeStanding: false,
    });

    expect(res.ok).toBe(true);
    const call = mockPrisma.decisionInteraction.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.chosenOptionId).toBeNull();
  });
});
