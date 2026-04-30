import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    userFact: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    agentMessage: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/inference/utility-inference", () => ({
  utilityInfer: vi.fn(),
}));

import { prisma } from "@dpf/db";

describe("loadGovernedUserFacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revalidates stale facts against source evidence when a consequential agent fingerprint changes", async () => {
    vi.mocked(prisma.userFact.findMany).mockResolvedValue([
      {
        id: "fact-1",
        category: "preference",
        key: "database",
        value: "Postgres",
        confidence: 0.9,
        sourceRoute: "/build",
        sourceMessageId: "msg-1",
        sourceAgentId: "build-specialist",
        sourceOperatingProfileFingerprint: "fp-old",
        validatedAgainstFingerprint: "fp-old",
        lastValidatedAt: new Date("2026-04-20T00:00:00Z"),
        createdAt: new Date("2026-04-20T00:00:00Z"),
      },
    ] as never);
    vi.mocked(prisma.agentMessage.findUnique).mockResolvedValue({
      id: "msg-1",
      content: "We should standardize on Postgres for this work.",
    } as never);

    const { utilityInfer } = await import("@/lib/inference/utility-inference");
    vi.mocked(utilityInfer).mockResolvedValue({
      output: JSON.stringify([
        {
          category: "preference",
          key: "database",
          value: "Postgres",
          status: "confirmed",
        },
      ]),
    } as never);

    const { loadGovernedUserFacts } = await import("./user-facts");
    const result = await loadGovernedUserFacts({
      userId: "user-1",
      routeDomain: "build",
      currentOperatingProfileFingerprint: "fp-new",
      actionRisk: "consequential",
    });

    expect(result.includedFacts).toHaveLength(1);
    expect(result.includedFacts[0]?.freshnessState).toBe("current");
    expect(prisma.userFact.update).toHaveBeenCalledWith({
      where: { id: "fact-1" },
      data: {
        lastValidatedAt: expect.any(Date),
        validatedAgainstFingerprint: "fp-new",
      },
    });
  });

  it("withholds unsupported facts when consequential use requires revalidation", async () => {
    vi.mocked(prisma.userFact.findMany).mockResolvedValue([
      {
        id: "fact-2",
        category: "constraint",
        key: "deadline",
        value: "Friday",
        confidence: 0.8,
        sourceRoute: "/build",
        sourceMessageId: "msg-2",
        sourceAgentId: "build-specialist",
        sourceOperatingProfileFingerprint: "fp-old",
        validatedAgainstFingerprint: "fp-old",
        lastValidatedAt: new Date("2026-04-20T00:00:00Z"),
        createdAt: new Date("2026-04-20T00:00:00Z"),
      },
    ] as never);
    vi.mocked(prisma.agentMessage.findUnique).mockResolvedValue({
      id: "msg-2",
      content: "Let's look at options next week.",
    } as never);

    const { utilityInfer } = await import("@/lib/inference/utility-inference");
    vi.mocked(utilityInfer).mockResolvedValue({
      output: JSON.stringify([
        {
          category: "constraint",
          key: "deadline",
          value: "Friday",
          status: "unsupported",
        },
      ]),
    } as never);

    const { loadGovernedUserFacts } = await import("./user-facts");
    const result = await loadGovernedUserFacts({
      userId: "user-1",
      routeDomain: "build",
      currentOperatingProfileFingerprint: "fp-new",
      actionRisk: "consequential",
    });

    expect(result.includedFacts).toHaveLength(0);
    expect(result.excludedFacts).toHaveLength(1);
    expect(result.excludedFacts[0]?.freshnessState).toBe("pending-revalidation");
    expect(prisma.userFact.update).not.toHaveBeenCalled();
  });
});
